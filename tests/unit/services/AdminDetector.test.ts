/**
 * Unit tests for AdminDetector.
 *
 * Verifies the role/elevation matrix: non-admin, admin-without-elevation,
 * admin-elevated, and the fail-open path when /user cannot be read.
 */

import { detectAdminStatus } from '../../../src/services/AdminDetector';

jest.mock('../../../src/config', () => ({
  GITLAB_BASE_URL: 'https://gitlab.example.com',
  GITLAB_TOKEN: 'glpat-test-token-123',
}));

jest.mock('../../../src/logger', () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
  logDebug: jest.fn(),
}));

const mockEnhancedFetch = jest.fn();
jest.mock('../../../src/utils/fetch', () => ({
  enhancedFetch: (...args: unknown[]) => mockEnhancedFetch(...args),
}));

function userResponse(isAdmin: boolean | undefined): unknown {
  return {
    ok: true,
    status: 200,
    json: jest.fn().mockResolvedValue(isAdmin === undefined ? {} : { is_admin: isAdmin }),
  };
}

function probeResponse(ok: boolean): unknown {
  return { ok, status: ok ? 200 : 403, json: jest.fn().mockResolvedValue([]) };
}

describe('detectAdminStatus', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns non-admin without probing when is_admin is false', async () => {
    mockEnhancedFetch.mockResolvedValueOnce(userResponse(false));

    const result = await detectAdminStatus();

    expect(result).toEqual({ isAdmin: false, adminModeActive: false });
    // No admin probe for a non-admin user.
    expect(mockEnhancedFetch).toHaveBeenCalledTimes(1);
    expect(mockEnhancedFetch.mock.calls[0][0]).toContain('/api/v4/user');
  });

  it('returns admin without elevation when the probe is forbidden', async () => {
    mockEnhancedFetch.mockResolvedValueOnce(userResponse(true));
    mockEnhancedFetch.mockResolvedValueOnce(probeResponse(false)); // 403

    const result = await detectAdminStatus();

    expect(result).toEqual({ isAdmin: true, adminModeActive: false });
    expect(mockEnhancedFetch).toHaveBeenCalledTimes(2);
    expect(mockEnhancedFetch.mock.calls[1][0]).toContain('include_pending_delete=true');
  });

  it('returns admin with active elevation when the probe succeeds', async () => {
    mockEnhancedFetch.mockResolvedValueOnce(userResponse(true));
    mockEnhancedFetch.mockResolvedValueOnce(probeResponse(true)); // 200

    const result = await detectAdminStatus();

    expect(result).toEqual({ isAdmin: true, adminModeActive: true });
  });

  it('returns null (fail-open) when /user fails', async () => {
    mockEnhancedFetch.mockResolvedValueOnce({ ok: false, status: 401, json: jest.fn() });

    const result = await detectAdminStatus();

    expect(result).toBeNull();
    expect(mockEnhancedFetch).toHaveBeenCalledTimes(1);
  });

  it('treats a missing is_admin field as non-admin', async () => {
    mockEnhancedFetch.mockResolvedValueOnce(userResponse(undefined));

    const result = await detectAdminStatus();

    expect(result).toEqual({ isAdmin: false, adminModeActive: false });
  });

  it('returns null when the request throws', async () => {
    mockEnhancedFetch.mockRejectedValueOnce(new Error('network down'));

    const result = await detectAdminStatus();

    expect(result).toBeNull();
  });

  it('returns null (fail-open) when /user returns an unexpected JSON shape', async () => {
    // e.g. a proxy returns a JSON array/string instead of the user object.
    mockEnhancedFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue(['not', 'a', 'user']),
    });

    const result = await detectAdminStatus();

    // Must NOT gate admin off on a parse failure - stay fail-open.
    expect(result).toBeNull();
  });

  it('returns null (fail-open) on an indeterminate probe status (5xx)', async () => {
    mockEnhancedFetch.mockResolvedValueOnce(userResponse(true));
    mockEnhancedFetch.mockResolvedValueOnce({ ok: false, status: 502, json: jest.fn() });

    const result = await detectAdminStatus();

    // A transient 502 is not the same as a 403 elevation failure.
    expect(result).toBeNull();
  });

  it('treats only a 403 probe as role-without-elevation', async () => {
    mockEnhancedFetch.mockResolvedValueOnce(userResponse(true));
    mockEnhancedFetch.mockResolvedValueOnce({ ok: false, status: 403, json: jest.fn() });

    const result = await detectAdminStatus();

    expect(result).toEqual({ isAdmin: true, adminModeActive: false });
  });
});
