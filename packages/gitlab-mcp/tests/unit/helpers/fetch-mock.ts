import { enhancedFetch } from '../../../src/utils/fetch';

/**
 * Shared fetch-mock utilities for entity registry unit tests.
 *
 * Mock ISOLATION is preserved: every test file still declares its own
 * `jest.mock('.../utils/fetch', () => ({ enhancedFetch: jest.fn() }))`, so each
 * file gets a fresh mock in its own module registry. These helpers only remove
 * the identical lifecycle/response boilerplate that would otherwise be copied
 * verbatim into every entity test file.
 */
export const mockEnhancedFetch = enhancedFetch as jest.MockedFunction<typeof enhancedFetch>;

/**
 * Register the per-file lifecycle: a test GitLab environment for the suite and a
 * clean mock before each test. Call once at the top level of a test file that has
 * already declared its own `jest.mock('.../utils/fetch')`.
 */
export function installFetchMock(): void {
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
  });
}

/** Resolve the next enhancedFetch call into an ok JSON response. */
export function mockOk(payload: unknown): void {
  mockEnhancedFetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: jest.fn().mockResolvedValue(payload),
  } as unknown as Response);
}

/** Resolve the next enhancedFetch call into a 204 No Content response (delete). */
export function mockNoContent(): void {
  mockEnhancedFetch.mockResolvedValueOnce({
    ok: true,
    status: 204,
    statusText: 'No Content',
  } as unknown as Response);
}

/** Last enhancedFetch call as [url, init?]. */
export function lastFetchCall(): [string, RequestInit | undefined] {
  const call = mockEnhancedFetch.mock.calls.at(-1)!;
  return [call[0], call[1]];
}
