import {
  vulnerabilitiesToolRegistry,
  getVulnerabilitiesReadOnlyToolNames,
} from '../../../../src/entities/vulnerabilities/registry';
import {
  LIST_PROJECT_VULNS,
  LIST_GROUP_VULNS,
  LIST_INSTANCE_VULNS,
  GET_VULN,
  DISMISS_VULN,
  CONFIRM_VULN,
  RESOLVE_VULN,
  REVERT_VULN,
} from '../../../../src/graphql/vulnerabilities';

const mockClient = { request: jest.fn() };

jest.mock('../../../../src/services/ConnectionManager', () => ({
  ConnectionManager: {
    getInstance: jest.fn(() => ({ getClient: jest.fn(() => mockClient) })),
  },
}));

const browse = () => vulnerabilitiesToolRegistry.get('browse_vulnerabilities')!;
const manage = () => vulnerabilitiesToolRegistry.get('manage_vulnerability')!;
const VULN_GID = 'gid://gitlab/Vulnerability/5';

beforeEach(() => {
  mockClient.request.mockReset();
});

describe('vulnerabilities registry', () => {
  it('registers the CQRS pair with browse read-only, both Ultimate + gated', () => {
    expect(vulnerabilitiesToolRegistry.has('browse_vulnerabilities')).toBe(true);
    expect(vulnerabilitiesToolRegistry.has('manage_vulnerability')).toBe(true);
    expect(getVulnerabilitiesReadOnlyToolNames()).toEqual(['browse_vulnerabilities']);
    expect(browse().requirements?.default).toMatchObject({ tier: 'ultimate' });
    expect(manage().requirements?.default).toMatchObject({ tier: 'ultimate' });
    expect(browse().gate).toEqual({ envVar: 'USE_VULNERABILITIES', defaultValue: true });
    expect(manage().gate).toEqual({ envVar: 'USE_VULNERABILITIES', defaultValue: true });
  });

  describe('browse_vulnerabilities', () => {
    it('list with project_id queries the project connection with filters', async () => {
      mockClient.request.mockResolvedValueOnce({ project: { vulnerabilities: { nodes: [] } } });
      await browse().handler({
        action: 'list',
        project_id: 'g/p',
        state: ['DETECTED'],
        severity: ['CRITICAL'],
        report_type: ['SAST'],
      });
      const [doc, vars] = mockClient.request.mock.calls[0];
      expect(doc).toBe(LIST_PROJECT_VULNS);
      expect(vars).toMatchObject({
        fullPath: 'g/p',
        state: ['DETECTED'],
        severity: ['CRITICAL'],
        reportType: ['SAST'],
        first: 20,
      });
    });

    it('list with project_id throws when the project is missing', async () => {
      mockClient.request.mockResolvedValueOnce({ project: null });
      await expect(browse().handler({ action: 'list', project_id: 'missing' })).rejects.toThrow(
        'not found or not accessible',
      );
    });

    it('list with group_id queries the group connection', async () => {
      mockClient.request.mockResolvedValueOnce({ group: { vulnerabilities: { nodes: [] } } });
      await browse().handler({ action: 'list', group_id: 'g' });
      const [doc, vars] = mockClient.request.mock.calls[0];
      expect(doc).toBe(LIST_GROUP_VULNS);
      expect(vars).toMatchObject({ fullPath: 'g' });
    });

    it('list with group_id throws when the group is missing', async () => {
      mockClient.request.mockResolvedValueOnce({ group: null });
      await expect(browse().handler({ action: 'list', group_id: 'missing' })).rejects.toThrow(
        'not found or not accessible',
      );
    });

    it('list without a scope queries the instance-wide connection', async () => {
      mockClient.request.mockResolvedValueOnce({ vulnerabilities: { nodes: [] } });
      await browse().handler({ action: 'list', sort: 'detected_desc' });
      const [doc, vars] = mockClient.request.mock.calls[0];
      expect(doc).toBe(LIST_INSTANCE_VULNS);
      expect(vars).toMatchObject({ projectId: null, sort: 'detected_desc' });
    });

    it('get expands the numeric id to a global ID', async () => {
      mockClient.request.mockResolvedValueOnce({ vulnerability: { id: VULN_GID } });
      await browse().handler({ action: 'get', vulnerability_id: 5 });
      const [doc, vars] = mockClient.request.mock.calls[0];
      expect(doc).toBe(GET_VULN);
      expect(vars).toEqual({ id: VULN_GID });
    });

    it('get throws when the vulnerability is missing', async () => {
      mockClient.request.mockResolvedValueOnce({ vulnerability: null });
      await expect(browse().handler({ action: 'get', vulnerability_id: 5 })).rejects.toThrow(
        'Vulnerability 5 not found',
      );
    });

    it('rejects list with both project_id and group_id', async () => {
      await expect(
        browse().handler({ action: 'list', project_id: 'g/p', group_id: 'g' }),
      ).rejects.toThrow();
      expect(mockClient.request).not.toHaveBeenCalled();
    });
  });

  describe('manage_vulnerability', () => {
    it('dismiss passes comment and dismissalReason', async () => {
      mockClient.request.mockResolvedValueOnce({
        vulnerabilityDismiss: { vulnerability: { id: VULN_GID }, errors: [] },
      });
      await manage().handler({
        action: 'dismiss',
        vulnerability_id: 5,
        comment: 'noise',
        dismissal_reason: 'FALSE_POSITIVE',
      });
      const [doc, vars] = mockClient.request.mock.calls[0];
      expect(doc).toBe(DISMISS_VULN);
      expect(vars).toEqual({ id: VULN_GID, comment: 'noise', dismissalReason: 'FALSE_POSITIVE' });
    });

    it('dismiss surfaces GraphQL payload errors', async () => {
      mockClient.request.mockResolvedValueOnce({
        vulnerabilityDismiss: { vulnerability: null, errors: ['not allowed'] },
      });
      await expect(manage().handler({ action: 'dismiss', vulnerability_id: 5 })).rejects.toThrow(
        'GitLab API error: not allowed',
      );
    });

    it('confirm runs vulnerabilityConfirm with the gid', async () => {
      mockClient.request.mockResolvedValueOnce({
        vulnerabilityConfirm: { vulnerability: { id: VULN_GID }, errors: [] },
      });
      await manage().handler({ action: 'confirm', vulnerability_id: 5 });
      const [doc, vars] = mockClient.request.mock.calls[0];
      expect(doc).toBe(CONFIRM_VULN);
      expect(vars).toEqual({ id: VULN_GID });
    });

    it('resolve runs vulnerabilityResolve', async () => {
      mockClient.request.mockResolvedValueOnce({
        vulnerabilityResolve: { vulnerability: {}, errors: [] },
      });
      await manage().handler({ action: 'resolve', vulnerability_id: 5 });
      expect(mockClient.request.mock.calls[0][0]).toBe(RESOLVE_VULN);
    });

    it('revert runs vulnerabilityRevertToDetected', async () => {
      mockClient.request.mockResolvedValueOnce({
        vulnerabilityRevertToDetected: { vulnerability: {}, errors: [] },
      });
      await manage().handler({ action: 'revert', vulnerability_id: 5 });
      expect(mockClient.request.mock.calls[0][0]).toBe(REVERT_VULN);
    });

    it('revert surfaces GraphQL payload errors', async () => {
      mockClient.request.mockResolvedValueOnce({
        vulnerabilityRevertToDetected: { vulnerability: null, errors: ['bad state'] },
      });
      await expect(manage().handler({ action: 'revert', vulnerability_id: 5 })).rejects.toThrow(
        'GitLab API error: bad state',
      );
    });

    it('throws when the mutation returns a null payload (silent-success guard)', async () => {
      mockClient.request.mockResolvedValueOnce({ vulnerabilityConfirm: null });
      await expect(manage().handler({ action: 'confirm', vulnerability_id: 5 })).rejects.toThrow(
        'GitLab API error',
      );
    });

    it('coerces a string vulnerability_id to a number gid', async () => {
      mockClient.request.mockResolvedValueOnce({
        vulnerabilityConfirm: { vulnerability: {}, errors: [] },
      });
      await manage().handler({ action: 'confirm', vulnerability_id: '5' });
      expect(mockClient.request.mock.calls[0][1]).toEqual({ id: VULN_GID });
    });

    it('rejects an invalid dismissal_reason', async () => {
      await expect(
        manage().handler({ action: 'dismiss', vulnerability_id: 5, dismissal_reason: 'NOPE' }),
      ).rejects.toThrow();
      expect(mockClient.request).not.toHaveBeenCalled();
    });
  });
});
