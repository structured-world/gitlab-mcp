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

  it('treats a non-list body as no users when emulating filters', async () => {
    nativeUserFilters = false;
    respond({ message: 'unexpected' });
    expect(await fetchUsers({ humans: true })).toEqual([]);
  });

  it('emulates humans on older instances: project bots server-side, other bots client-side', async () => {
    nativeUserFilters = false;
    respond(users);

    const result = (await fetchUsers({ humans: true })) as Array<{ id: number }>;

    expect(sentUrl().searchParams.get('humans')).toBeNull();
    expect(sentUrl().searchParams.get('without_project_bots')).toBe('true');
    expect(result.map((u) => u.id)).toEqual([1, 3]);
  });

  it('emulates exclude_active on each user state', async () => {
    nativeUserFilters = false;
    respond(users);
    const result = (await fetchUsers({ exclude_active: true })) as Array<{ id: number }>;
    expect(result.map((u) => u.id)).toEqual([3]);
  });

  it('emulates exclude_humans when the response carries the bot flag', async () => {
    nativeUserFilters = false;
    respond(users);
    const result = (await fetchUsers({ exclude_humans: true })) as Array<{ id: number }>;
    expect(result.map((u) => u.id)).toEqual([2]);
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

    it('should handle API errors gracefully', async () => {
      mockEnhancedFetch.mockRejectedValueOnce(new Error('Network error'));

      const result = await smartUserSearch('ivan');

      expect(result.users).toEqual([]);
      expect(result.searchMetadata.totalApiCalls).toBe(0);
      expect(result.searchMetadata.searchPhases).toHaveLength(0);
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
