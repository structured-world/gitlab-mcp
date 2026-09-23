import {
  analyzeQuery,
  transliterateText,
  hasNonLatin,
  smartUserSearch,
  fetchUsers,
  type QueryPattern,
} from '../../../src/utils/smart-user-search';
import { enhancedFetch } from '../../../src/utils/fetch';

// Mock enhancedFetch to avoid actual API calls
jest.mock('../../../src/utils/fetch', () => ({
  enhancedFetch: jest.fn(),
}));

// Whether the simulated instance has the native user-type filters (GitLab 17.3).
// A plain variable, not a jest.fn, so resetAllMocks below cannot clear it.
let nativeUserFilters = true;
jest.mock('../../../src/entities/instance-version', () => ({
  instanceAtLeast: () => nativeUserFilters,
}));

const mockEnhancedFetch = enhancedFetch as jest.MockedFunction<typeof enhancedFetch>;

// Mock environment variables
const originalEnv = process.env;

beforeAll(() => {
  process.env = {
    ...originalEnv,
    GITLAB_API_URL: 'https://gitlab.example.com',
    GITLAB_TOKEN: 'test-token-12345',
  };
});

afterAll(() => {
  process.env = originalEnv;
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.resetAllMocks();
  mockEnhancedFetch.mockReset();
  nativeUserFilters = true;
});

describe('fetchUsers user-type filters', () => {
  const users = [
    { id: 1, username: 'alice', state: 'active', bot: false },
    { id: 2, username: 'alert-bot', state: 'active', bot: true },
    { id: 3, username: 'bob', state: 'blocked', bot: false },
  ];
  const respond = (body: unknown) =>
    mockEnhancedFetch.mockResolvedValueOnce({
      ok: true,
      json: jest.fn().mockResolvedValue(body),
    } as unknown as Response);
  const sentUrl = () => new URL(mockEnhancedFetch.mock.calls[0][0]);

  it('passes the filters to GitLab when it supports them (17.3+)', async () => {
    respond([users[0]]);
    await fetchUsers({ humans: true, exclude_active: false });
    expect(sentUrl().searchParams.get('humans')).toBe('true');
  });

  it('does not send parameters left undefined', async () => {
    respond([users[0]]);
    await fetchUsers({ username: 'alice', search: undefined });
    expect(sentUrl().searchParams.has('search')).toBe(false);
    expect(sentUrl().searchParams.get('username')).toBe('alice');
  });

  it('rejects a body that is not a user list instead of reporting no users', async () => {
    // A proxy page or error object answered with 200 must not read as "no match".
    respond({ message: 'unexpected' });
    await expect(fetchUsers({ humans: true })).rejects.toThrow(
      'GitLab API error: unexpected users response',
    );
  });

  const ids = (result: { users: unknown[] }) =>
    (result.users as Array<{ id: number }>).map((u) => u.id);

  it('emulates humans on older instances: project bots server-side, other bots client-side', async () => {
    nativeUserFilters = false;
    respond(users);

    const result = await fetchUsers({ humans: true });

    expect(sentUrl().searchParams.get('humans')).toBeNull();
    expect(sentUrl().searchParams.get('without_project_bots')).toBe('true');
    expect(ids(result)).toEqual([1, 3]);
    expect(result.warning).toBeUndefined();
  });

  it('warns that other bots may remain when humans is emulated without the bot flag', async () => {
    // Non-admin tokens on older GitLab do not see the bot flag: only project
    // bots can be excluded, so the result must not claim to be humans only.
    nativeUserFilters = false;
    respond([{ id: 1, username: 'alice', state: 'active' }]);

    const result = await fetchUsers({ humans: true });

    expect(ids(result)).toEqual([1]);
    expect(result.warning).toContain('bot accounts other than project bots may be included');
  });

  it('filters before paginating, walking GitLab pages past excluded users', async () => {
    // A full first page of active users must not hide inactive ones on the next
    // page, and the requested page is cut from the filtered list.
    nativeUserFilters = false;
    respond(Array.from({ length: 100 }, (_, i) => ({ id: 100 + i, state: 'active', bot: false })));
    respond([
      { id: 1, state: 'blocked', bot: false },
      { id: 2, state: 'blocked', bot: false },
      { id: 3, state: 'blocked', bot: false },
    ]);

    const result = await fetchUsers({ exclude_active: true, per_page: 2, page: 2 });

    expect(ids(result)).toEqual([3]);
    const sent = mockEnhancedFetch.mock.calls.map(([url]) => new URL(String(url)).searchParams);
    expect(sent.map((q) => [q.get('page'), q.get('per_page')])).toEqual([
      ['1', '100'],
      ['2', '100'],
    ]);
  });

  it('stops after a bounded number of pages and says the result may be incomplete', async () => {
    // A filter matching few users must not walk every /users page of a large
    // instance in one tool call.
    nativeUserFilters = false;
    const fullPage = Array.from({ length: 100 }, (_, i) => ({
      id: i,
      state: 'active',
      bot: false,
    }));
    for (let i = 0; i < 25; i++) respond(fullPage);

    const result = await fetchUsers({ exclude_active: true });

    expect(mockEnhancedFetch).toHaveBeenCalledTimes(20);
    expect(result.users).toEqual([]);
    expect(result.warning).toContain('only the first 2000 users were scanned');
  });

  it('emulates exclude_active on each user state', async () => {
    nativeUserFilters = false;
    respond(users);
    expect(ids(await fetchUsers({ exclude_active: true }))).toEqual([3]);
  });

  it('emulates exclude_humans when the response carries the bot flag', async () => {
    nativeUserFilters = false;
    respond(users);
    expect(ids(await fetchUsers({ exclude_humans: true }))).toEqual([2]);
  });

  it('refuses exclude_humans when the response lacks the bot flag (non-admin, older GitLab)', async () => {
    // Without the flag, bots and humans are indistinguishable; returning either
    // set would be a guess.
    nativeUserFilters = false;
    respond([{ id: 1, username: 'alice', state: 'active' }]);
    await expect(fetchUsers({ exclude_humans: true })).rejects.toThrow(
      'Filtering to bot users needs GitLab 17.3+',
    );
  });
});

describe('smart-user-search utilities', () => {
  describe('hasNonLatin', () => {
    it('should detect non-Latin characters', () => {
      expect(hasNonLatin('Иван')).toBe(true); // Cyrillic
      expect(hasNonLatin('ivan')).toBe(false); // Latin
      expect(hasNonLatin('张三')).toBe(true); // Chinese
      expect(hasNonLatin('John')).toBe(false); // Latin
      expect(hasNonLatin('José')).toBe(false); // Latin with accents (extended Latin)
      expect(hasNonLatin('مرحبا')).toBe(true); // Arabic
      expect(hasNonLatin('Иван Petrov')).toBe(true); // Mixed
    });
  });

  describe('transliterateText', () => {
    it('should transliterate Cyrillic names', () => {
      expect(transliterateText('Иван')).toBe('Ivan');
      expect(transliterateText('Петров')).toBe('Petrov');
      expect(transliterateText('Александр')).toBe('Aleksandr');
    });

    it('should transliterate Chinese characters', () => {
      expect(transliterateText('张三')).toBe('Zhang San');
      expect(transliterateText('你好')).toBe('Ni Hao');
    });

    it('should preserve Latin characters', () => {
      expect(transliterateText('ivan')).toBe('ivan');
      expect(transliterateText('John123')).toBe('John123');
      expect(transliterateText('test@example.com')).toBe('test@example.com');
    });

    it('should handle mixed text', () => {
      expect(transliterateText('Иван Smith')).toBe('Ivan Smith');
      expect(transliterateText('user_张三')).toBe('user_Zhang San');
    });

    it('should handle edge cases', () => {
      expect(transliterateText('')).toBe('');
      expect(transliterateText('José')).toBe('Jose'); // Extended Latin is transliterated
    });
  });

  describe('analyzeQuery', () => {
    it('should detect email patterns', () => {
      const result: QueryPattern = analyzeQuery('user@example.com');
      expect(result.type).toBe('email');
      expect(result.hasTransliteration).toBe(false);
      expect(result.originalQuery).toBe('user@example.com');
    });

    it('should detect username patterns', () => {
      const result: QueryPattern = analyzeQuery('ivan123');
      expect(result.type).toBe('username');
      expect(result.hasTransliteration).toBe(false);
      expect(result.originalQuery).toBe('ivan123');
    });

    it('should detect username patterns with special chars', () => {
      const result: QueryPattern = analyzeQuery('user.name_123');
      expect(result.type).toBe('username');
      expect(result.hasTransliteration).toBe(false);
    });

    it('should detect name patterns with spaces', () => {
      const result: QueryPattern = analyzeQuery('John Smith');
      expect(result.type).toBe('name');
      expect(result.hasTransliteration).toBe(false);
      expect(result.originalQuery).toBe('John Smith');
    });

    it('should detect non-Latin names and include transliteration', () => {
      const result: QueryPattern = analyzeQuery('Иван Петров');
      expect(result.type).toBe('name');
      expect(result.hasTransliteration).toBe(true);
      expect(result.originalQuery).toBe('Иван Петров');
      expect(result.transliteratedQuery).toBe('Ivan Petrov');
    });

    it('should detect Chinese names and include transliteration', () => {
      const result: QueryPattern = analyzeQuery('张三 李四');
      expect(result.type).toBe('name');
      expect(result.hasTransliteration).toBe(true);
      expect(result.originalQuery).toBe('张三 李四');
      expect(result.transliteratedQuery).toBe('Zhang San Li Si');
    });

    it('should detect non-Latin usernames and include transliteration', () => {
      const result: QueryPattern = analyzeQuery('иван');
      expect(result.type).toBe('username');
      expect(result.hasTransliteration).toBe(true);
      expect(result.transliteratedQuery).toBe('ivan');
    });

    it('should detect Chinese names and include transliteration (short)', () => {
      const result: QueryPattern = analyzeQuery('张三');
      expect(result.type).toBe('name'); // Chinese chars are treated as names
      expect(result.hasTransliteration).toBe(true);
      expect(result.transliteratedQuery).toBe('Zhang San');
    });

    it('should handle edge cases', () => {
      expect(analyzeQuery('a').type).toBe('name'); // too short for username (< 3 chars)
      expect(analyzeQuery('ab').type).toBe('name'); // too short for username (< 3 chars)
      expect(analyzeQuery('verylongusernamethatexceedsthirtychars').type).toBe('name'); // too long (> 30 chars)
      expect(analyzeQuery('user name').type).toBe('name'); // contains space
      expect(analyzeQuery('user@').type).toBe('username'); // 5 chars, no space - valid username pattern
      expect(analyzeQuery('user@domain').type).toBe('username'); // 11 chars, no space - valid username pattern
    });
  });

  describe('smartUserSearch', () => {
    const mockApiResponse = (users: unknown[]) => {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue(users),
      } as any);
    };

    it('should perform email search for email patterns', async () => {
      const mockUsers = [{ id: 1, email: 'test@example.com', username: 'testuser' }];
      mockEnhancedFetch.mockResolvedValueOnce(mockApiResponse(mockUsers));

      const result = await smartUserSearch('test@example.com');

      expect(mockEnhancedFetch).toHaveBeenCalledWith(
        expect.stringContaining('public_email=test%40example.com'),
      );

      expect(result.users).toEqual(mockUsers);
      expect(result.searchMetadata.pattern.type).toBe('email');
      expect(result.searchMetadata.totalApiCalls).toBe(1);
      expect(result.searchMetadata.searchPhases).toHaveLength(1);
      expect(result.searchMetadata.searchPhases[0].phase).toBe('targeted-email');
    });

    it('should perform username search for username patterns', async () => {
      const mockUsers = [{ id: 1, username: 'ivan123' }];
      mockEnhancedFetch.mockResolvedValueOnce(mockApiResponse(mockUsers));

      const result = await smartUserSearch('ivan123');

      expect(mockEnhancedFetch).toHaveBeenCalledWith(expect.stringContaining('username=ivan123'));

      expect(result.users).toEqual(mockUsers);
      expect(result.searchMetadata.pattern.type).toBe('username');
      expect(result.searchMetadata.totalApiCalls).toBe(1);
    });

    it('should perform name search for name patterns', async () => {
      const mockUsers = [{ id: 1, name: 'John Smith' }];
      mockEnhancedFetch.mockResolvedValueOnce(mockApiResponse(mockUsers));

      const result = await smartUserSearch('John Smith');

      expect(mockEnhancedFetch).toHaveBeenCalledWith(expect.stringContaining('search=John+Smith'));

      expect(result.searchMetadata.pattern.type).toBe('name');
    });

    it('should use fallback search when targeted search returns empty', async () => {
      // First call (targeted) returns empty, second call (broad) returns results
      mockEnhancedFetch
        .mockResolvedValueOnce(mockApiResponse([])) // targeted search
        .mockResolvedValueOnce(mockApiResponse([{ id: 1, username: 'ivan' }])); // broad search

      const result = await smartUserSearch('ivan');

      expect(mockEnhancedFetch).toHaveBeenCalledTimes(2);
      expect(result.searchMetadata.totalApiCalls).toBe(2);
      expect(result.searchMetadata.searchPhases).toHaveLength(2);
      expect(result.searchMetadata.searchPhases[0].phase).toBe('targeted-username');
      expect(result.searchMetadata.searchPhases[1].phase).toBe('broad-search');
    });

    it('should use transliteration fallback for non-Latin queries', async () => {
      // For name patterns: First call (targeted) returns empty, then transliteration call returns results
      // No broad search for names since targeted search already uses 'search' parameter
      mockEnhancedFetch
        .mockResolvedValueOnce(mockApiResponse([])) // targeted search with non-Latin
        .mockResolvedValueOnce(mockApiResponse([{ id: 1, name: 'Ivan Petrov' }])); // transliteration search

      const result = await smartUserSearch('Иван Петров');

      expect(mockEnhancedFetch).toHaveBeenCalledTimes(2);
      expect(result.searchMetadata.totalApiCalls).toBe(2);
      expect(result.searchMetadata.searchPhases).toHaveLength(2);
      expect(result.searchMetadata.searchPhases[0].phase).toBe('targeted-name');
      expect(result.searchMetadata.searchPhases[1].phase).toBe('transliteration');

      // Check that the transliterated query was used
      const lastCall = mockEnhancedFetch.mock.calls[1];
      expect(lastCall[0]).toContain('search=Ivan+Petrov');
    });

    it('should use transliteration fallback for Chinese queries', async () => {
      mockEnhancedFetch
        .mockResolvedValueOnce(mockApiResponse([])) // targeted search with Chinese
        .mockResolvedValueOnce(mockApiResponse([{ id: 1, name: 'Zhang San' }])); // transliteration search

      const result = await smartUserSearch('张三');

      expect(mockEnhancedFetch).toHaveBeenCalledTimes(2);
      expect(result.searchMetadata.totalApiCalls).toBe(2);
      expect(result.searchMetadata.searchPhases).toHaveLength(2);
      expect(result.searchMetadata.searchPhases[0].phase).toBe('targeted-name'); // Chinese chars are names
      expect(result.searchMetadata.searchPhases[1].phase).toBe('transliteration');

      // Check that the transliterated query was used
      const lastCall = mockEnhancedFetch.mock.calls[1];
      expect(lastCall[0]).toContain('search=Zhang+San');
    });

    it('should pass through additional parameters', async () => {
      const mockUsers = [{ id: 1, username: 'ivan' }];
      mockEnhancedFetch.mockResolvedValueOnce(mockApiResponse(mockUsers));

      await smartUserSearch('ivan', { active: true, humans: true });

      expect(mockEnhancedFetch).toHaveBeenCalledWith(expect.stringContaining('active=true'));
      expect(mockEnhancedFetch).toHaveBeenCalledWith(expect.stringContaining('humans=true'));
    });

    it('propagates API errors instead of reporting no users', async () => {
      // An empty result would tell the caller nobody matched when the search failed.
      mockEnhancedFetch.mockRejectedValueOnce(new Error('Network error'));

      await expect(smartUserSearch('ivan')).rejects.toThrow('Network error');
    });

    it('propagates the refusal to filter bot users on older instances', async () => {
      nativeUserFilters = false;
      mockEnhancedFetch.mockResolvedValueOnce(
        mockApiResponse([{ id: 1, username: 'ivan', state: 'active' }]),
      );

      await expect(smartUserSearch('ivan', { exclude_humans: true })).rejects.toThrow(
        'Filtering to bot users needs GitLab 17.3+',
      );
    });

    it('carries the partial-humans warning of the phase whose users it returns', async () => {
      // Smart search applies humans by default; on older GitLab without the bot
      // flag the result must not look fully filtered.
      nativeUserFilters = false;
      mockEnhancedFetch.mockResolvedValueOnce(
        mockApiResponse([{ id: 1, username: 'ivan', state: 'active' }]),
      );

      const result = await smartUserSearch('ivan');

      expect(result.users).toHaveLength(1);
      expect(result.searchMetadata.warning).toContain('bot accounts other than project bots');
    });

    it('drops each default that contradicts the requested exclusion', async () => {
      // active=true with exclude_active, or humans=true with exclude_humans,
      // can only ever return nothing.
      mockEnhancedFetch.mockResolvedValueOnce(mockApiResponse([{ id: 1, username: 'ivan' }]));
      await smartUserSearch('ivan', { exclude_active: true, exclude_humans: true });

      const sent = new URL(mockEnhancedFetch.mock.calls[0][0]).searchParams;
      expect(sent.has('active')).toBe(false);
      expect(sent.has('humans')).toBe(false);
      expect(sent.get('exclude_active')).toBe('true');
      expect(sent.get('exclude_humans')).toBe('true');
    });

    it('should include default filters for better results', async () => {
      const mockUsers = [{ id: 1, username: 'ivan' }];
      mockEnhancedFetch.mockResolvedValueOnce(mockApiResponse(mockUsers));

      await smartUserSearch('ivan');

      // Check that default active=true and humans=true are included
      const calledUrl = mockEnhancedFetch.mock.calls[0][0];
      expect(calledUrl).toContain('active=true');
      expect(calledUrl).toContain('humans=true');
    });
  });
});
