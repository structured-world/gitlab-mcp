import * as z from 'zod';
import { enhancedFetch } from './fetch';
import { transliterate } from 'transliteration';
import { instanceAtLeast } from '../entities/instance-version';
import { GITLAB_DEFAULT_PER_PAGE, GITLAB_MAX_PER_PAGE } from '../entities/utils';

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
    /** Set when the returned users may not fully match the requested filters. */
    warning?: string;
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

/** Users from GET /users, and why they may not fully match the requested filters. */
export interface FetchedUsers {
  users: unknown[];
  warning?: string;
}

const PARTIAL_HUMANS_WARNING =
  'Filtered to humans without the bot flag (GitLab before 17.3 shows it only to administrators): bot accounts other than project bots may be included';

/** Pages of /users one call may scan while emulating filters, bounding its requests. */
const MAX_EMULATED_PAGES = 20;
const TRUNCATED_WARNING = `Filtered client-side (GitLab before 17.3) and only the first ${MAX_EMULATED_PAGES * GITLAB_MAX_PER_PAGE} users were scanned: later matches may be missing; narrow the search to reach them`;

/** One validated GET /users page. */
async function fetchUsersPage(query: Record<string, unknown>) {
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
  return parsed.data;
}

/**
 * GET /users with the user-type filters GitLab added in 17.3 (humans,
 * exclude_humans, exclude_active). Older instances ignore them, so there they
 * are emulated before pagination: GitLab's pages are walked until the requested
 * filtered page is complete. exclude_active checks each user's state; humans
 * excludes project bots server-side and any user flagged as a bot, but the bot
 * flag reaches administrators only, so without it the result carries a warning.
 * exclude_humans cannot work without the flag and is refused. The walk stops
 * after MAX_EMULATED_PAGES, with a warning that later matches may be missing.
 */
export async function fetchUsers(params: Record<string, unknown>): Promise<FetchedUsers> {
  const { humans, exclude_humans, exclude_active, page, per_page, ...filters } = params;
  if (instanceAtLeast('17.3') || !(humans || exclude_humans || exclude_active)) {
    return { users: await fetchUsersPage(params) };
  }

  const perPage = typeof per_page === 'number' ? per_page : GITLAB_DEFAULT_PER_PAGE;
  const wanted = (typeof page === 'number' ? page : 1) * perPage;
  const serverQuery = { ...filters, ...(humans ? { without_project_bots: true } : {}) };
  const matches: unknown[] = [];
  let botFlagMissing = false;
  let truncated = false;
  for (let serverPage = 1; matches.length < wanted; serverPage++) {
    if (serverPage > MAX_EMULATED_PAGES) {
      truncated = true;
      break;
    }
    const batch = await fetchUsersPage({
      ...serverQuery,
      per_page: GITLAB_MAX_PER_PAGE,
      page: serverPage,
    });
    if (batch.some((user) => user.bot === undefined)) {
      if (exclude_humans) {
        throw new Error(
          'Filtering to bot users needs GitLab 17.3+, or an administrator token on older instances',
        );
      }
      botFlagMissing = true;
    }
    for (const user of batch) {
      if (
        !(humans && user.bot === true) &&
        !(exclude_humans && user.bot === false) &&
        !(exclude_active && user.state === 'active')
      ) {
        matches.push(user);
      }
    }
    if (batch.length < GITLAB_MAX_PER_PAGE) break;
  }
  const users = matches.slice(wanted - perPage, wanted);
  const warnings = [
    ...(humans && botFlagMissing ? [PARTIAL_HUMANS_WARNING] : []),
    ...(truncated ? [TRUNCATED_WARNING] : []),
  ];
  return warnings.length > 0 ? { users, warning: warnings.join('; ') } : { users };
}

/**
 * Make GitLab Users API call with given parameters
 */
async function callUsersAPI(params: UserSearchParams): Promise<FetchedUsers> {
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
  const runPhase = async (phase: string, params: UserSearchParams): Promise<FetchedUsers> => {
    const fetched = await callUsersAPI(params);
    totalApiCalls++;
    searchPhases.push({ phase, params, resultCount: fetched.users.length });
    return fetched;
  };
  // The returned users come from the last phase run, and so does its warning.
  const finish = ({ users, warning }: FetchedUsers): SmartSearchResult => ({
    users,
    searchMetadata: {
      query,
      pattern,
      searchPhases,
      totalApiCalls,
      ...(warning ? { warning } : {}),
    },
  });

  let fetched = await runPhase(`targeted-${pattern.type}`, targetParams);
  if (fetched.users.length > 0) return finish(fetched);

  // Phase 2: Broad search fallback if targeted search returned empty
  if (pattern.type !== 'name') {
    fetched = await runPhase('broad-search', {
      search: pattern.originalQuery,
      ...additionalParams,
    });
    if (fetched.users.length > 0) return finish(fetched);
  }

  // Phase 3: Transliteration search if query has Cyrillic and no results yet
  if (pattern.hasTransliteration && pattern.transliteratedQuery) {
    fetched = await runPhase('transliteration', {
      search: pattern.transliteratedQuery,
      ...additionalParams,
    });
  }

  return finish(fetched);
}
