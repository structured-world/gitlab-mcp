/**
 * Mock implementation of enhancedFetch for unit tests only
 * This file is ONLY used by unit tests and should NOT affect integration tests
 */

export const mockEnhancedFetch = jest.fn();

// Default implementation that can be overridden in tests
mockEnhancedFetch.mockImplementation(async (url: string, options?: any) => {
  // Default successful response
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: jest.fn().mockResolvedValue({}),
    text: jest.fn().mockResolvedValue('{}'),
    headers: new Map([['content-type', 'application/json']])
  };
});

export { mockEnhancedFetch as enhancedFetch };