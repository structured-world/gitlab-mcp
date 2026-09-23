import * as z from 'zod';
import { enhancedFetch } from './fetch';
import { transliterate } from 'transliteration';
import { instanceAtLeast } from '../entities/instance-version';

/**
 * User query type detected by pattern analysis
 */
export type QueryType = 'email' | 'username' | 'name';

/**
 * Pattern detection result
 */
export interface QueryPattern {
  type: QueryType;
  hasTransliteration: boolean;
  originalQuery: string;
  transliteratedQuery?: string;
}

/**
 * Parameters for GitLab Users API
 */
export interface UserSearchParams {
  username?: string;
  public_email?: string;
  search?: string;
  active?: boolean;
  humans?: boolean;
  without_project_bots?: boolean;
  [key: string]: unknown;
}

/**
 * Search result with metadata
 */
export interface SmartSearchResult {
  users: unknown[];
  searchMetadata: {
    query: string;
    pattern: QueryPattern;
    searchPhases: Array<{
      phase: string;
      params: UserSearchParams;
      resultCount: number;
    }>;
    totalApiCalls: number;
  };
}

/**
 * Transliterate non-Latin text to Latin characters
 */
export function transliterateText(text: string): string {
  return transliterate(text);
}

/**
 * Detect if text contains non-Latin characters that would benefit from transliteration
 */
export function hasNonLatin(text: string): boolean {
  // Check for any non-Latin characters (excluding common punctuation and numbers)
  // eslint-disable-next-line no-control-regex
  return /[^\u0000-\u007F\u0080-\u00FF]/.test(text);
}

/**
 * Analyze query pattern to determine optimal search strategy
 */
export function analyzeQuery(query: string): QueryPattern {
  const trimmedQuery = query.trim();

  // Email pattern: basic validation for @domain format
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedQuery)) {
    return {
      type: 'email',
      hasTransliteration: false,
      originalQuery: trimmedQuery,
    };
  }

  // Username pattern: 3-30 chars, basic chars with ._- (no spaces)
  // Allow international characters but detect them for transliteration
  if (trimmedQuery.length >= 3 && trimmedQuery.length <= 30 && !/\s/.test(trimmedQuery)) {
    const hasTransliterationNeeded = hasNonLatin(trimmedQuery);
    return {
      type: 'username',
      hasTransliteration: hasTransliterationNeeded,
      originalQuery: trimmedQuery,
      transliteratedQuery: hasTransliterationNeeded ? transliterateText(trimmedQuery) : undefined,
    };
  }

  // Name pattern: everything else (contains spaces, long text, or anything not matching username)
  const hasTransliterationNeeded = hasNonLatin(trimmedQuery);
  return {
    type: 'name',
    hasTransliteration: hasTransliterationNeeded,
    originalQuery: trimmedQuery,
    transliteratedQuery: hasTransliterationNeeded ? transliterateText(trimmedQuery) : undefined,
  };
}

const ListedUsersSchema = z.array(
  z.looseObject({
    state: z.string().optional(),
    /** Exposed only in the full user entity (administrators); absent otherwise. */
    bot: z.boolean().optional(),
  }),
);

/**
 * GET /users with the user-type filters GitLab added in 17.3 (humans,
 * exclude_humans, exclude_active). Older instances ignore them, so there they
 * are emulated: exclude_active on each user's state, humans by excluding project
 * bots server-side and any user flagged as a bot. exclude_humans needs the bot
 * flag, which only the full entity carries.
 */
export async function fetchUsers(params: Record<string, unknown>): Promise<unknown[]> {
  const { humans, exclude_humans, exclude_active, ...rest } = params;
  const native = instanceAtLeast('17.3');
  const query: Record<string, unknown> = native
    ? params
    : { ...rest, ...(humans ? { without_project_bots: true } : {}) };

  const queryParams = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined) queryParams.set(key, String(value));
  });
  const response = await enhancedFetch(`${process.env.GITLAB_API_URL}/api/v4/users?${queryParams}`);
  if (!response.ok) {
    throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
  }
  const parsed = ListedUsersSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new Error(
      `GitLab API error: unexpected users response (${parsed.error.issues[0]?.message ?? 'invalid'})`,
    );
  }
  const users = parsed.data;
  if (native) return users;

  if (exclude_humans && users.some((user) => user.bot === undefined)) {
    throw new Error(
      'Filtering to bot users needs GitLab 17.3+, or an administrator token on older instances',
    );
  }
  return users.filter(
    (user) =>
      !(humans && user.bot === true) &&
      !(exclude_humans && user.bot === false) &&
      !(exclude_active && user.state === 'active'),
  );
}

/**
 * Make GitLab Users API call with given parameters
 */
async function callUsersAPI(params: UserSearchParams): Promise<unknown[]> {
  // Default to active humans, unless the caller excludes exactly those: the
  // default and the exclusion together can only return nothing.
  return fetchUsers({
    ...(params.exclude_active ? {} : { active: true }),
    ...(params.exclude_humans ? {} : { humans: true }),
    ...params,
  });
}

/**
 * Smart user search with pattern detection and fallback strategies
 */
export async function smartUserSearch(
  query: string,
  additionalParams: Partial<UserSearchParams> = {},
): Promise<SmartSearchResult> {
  const pattern = analyzeQuery(query);
  const searchPhases: Array<{ phase: string; params: UserSearchParams; resultCount: number }> = [];
  let totalApiCalls = 0;

  // Phase 1: Targeted search based on detected pattern
  let targetParams: UserSearchParams;
  switch (pattern.type) {
    case 'email':
      targetParams = { public_email: pattern.originalQuery, ...additionalParams };
      break;
    case 'username':
      targetParams = { username: pattern.originalQuery, ...additionalParams };
      break;
    case 'name':
      targetParams = { search: pattern.originalQuery, ...additionalParams };
      break;
  }

  // A failed call propagates: an empty result would claim nobody matched.
  let users = await callUsersAPI(targetParams);
  totalApiCalls++;
  searchPhases.push({
    phase: `targeted-${pattern.type}`,
    params: targetParams,
    resultCount: users.length,
  });

  // If we found users, return early
  if (users.length > 0) {
    return {
      users,
      searchMetadata: {
        query,
        pattern,
        searchPhases,
        totalApiCalls,
      },
    };
  }

  // Phase 2: Broad search fallback if targeted search returned empty
  if (pattern.type !== 'name') {
    const broadParams = { search: pattern.originalQuery, ...additionalParams };
    users = await callUsersAPI(broadParams);
    totalApiCalls++;
    searchPhases.push({
      phase: 'broad-search',
      params: broadParams,
      resultCount: users.length,
    });

    if (users.length > 0) {
      return {
        users,
        searchMetadata: {
          query,
          pattern,
          searchPhases,
          totalApiCalls,
        },
      };
    }
  }

  // Phase 3: Transliteration search if query has Cyrillic and no results yet
  if (pattern.hasTransliteration && pattern.transliteratedQuery) {
    const translitParams = { search: pattern.transliteratedQuery, ...additionalParams };
    users = await callUsersAPI(translitParams);
    totalApiCalls++;
    searchPhases.push({
      phase: 'transliteration',
      params: translitParams,
      resultCount: users.length,
    });
  }

  return {
    users,
    searchMetadata: {
      query,
      pattern,
      searchPhases,
      totalApiCalls,
    },
  };
}
