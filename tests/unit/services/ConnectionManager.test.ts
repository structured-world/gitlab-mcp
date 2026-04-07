/**
 * Unit tests for ConnectionManager service
 * Tests singleton pattern and error handling without external dependencies
 */

import { ConnectionManager, type InstanceState } from '../../../src/services/ConnectionManager';

// Mock isOAuthEnabled and getGitLabApiUrlFromContext
const mockIsOAuthEnabled = jest.fn();
const mockGetGitLabApiUrlFromContext = jest.fn();
jest.mock('../../../src/oauth/index.js', () => ({
  isOAuthEnabled: () => mockIsOAuthEnabled(),
  getGitLabApiUrlFromContext: () => mockGetGitLabApiUrlFromContext(),
}));

// Mock detectTokenScopes for testing scope refresh
const mockDetectTokenScopes = jest.fn();
jest.mock('../../../src/services/TokenScopeDetector', () => ({
  detectTokenScopes: (...args: unknown[]) => mockDetectTokenScopes(...args),
  getTokenCreationUrl: jest.fn(
    () => 'https://gitlab.example.com/-/user_settings/personal_access_tokens',
  ),
}));

/** Type-safe access to ConnectionManager private fields in tests */
type CMInternals = {
  instances: Map<string, InstanceState>;
  currentInstanceUrl: string | null;
  introspectionPromises: Map<string, Promise<void>>;
  initializePromises: Map<string, Promise<void>>;
  instanceAccessTimes: Map<string, number>;
  doIntrospection: (url: string) => Promise<void>;
  evictExpired: () => void;
  evictLRUIfOverCapacity: () => void;
  touchInstance: (url: string) => void;
};
function internals(manager: ConnectionManager): CMInternals {
  return manager as unknown as CMInternals;
}

/** Type-safe access to ConnectionManager static fields in tests */
type CMStatics = {
  MAX_INSTANCES: number;
  INSTANCE_TTL_MS: number;
};
function statics(): CMStatics {
  return ConnectionManager as unknown as CMStatics;
}

/** Helper: inject per-URL InstanceState into the ConnectionManager's internal Map */
function injectInstanceState(
  manager: ConnectionManager,
  url: string,
  overrides: Partial<InstanceState> = {},
): void {
  const state: InstanceState = {
    client: {} as unknown as InstanceState['client'],
    versionDetector: {} as unknown as InstanceState['versionDetector'],
    schemaIntrospector: {} as unknown as InstanceState['schemaIntrospector'],
    instanceInfo: null,
    schemaInfo: null,
    tokenScopeInfo: null,
    isInitialized: false,
    introspectedInstanceUrl: null,
    ...overrides,
  };
  internals(manager).instances.set(url, state);
  internals(manager).currentInstanceUrl = url;
}

describe('ConnectionManager Unit', () => {
  beforeEach(() => {
    // Reset singleton instance for each test
    (ConnectionManager as unknown as { instance: null }).instance = null;
  });

  describe('singleton pattern', () => {
    it('should return the same instance on multiple calls', () => {
      const instance1 = ConnectionManager.getInstance();
      const instance2 = ConnectionManager.getInstance();

      expect(instance1).toBe(instance2);
    });

    it('should maintain singleton across different call patterns', () => {
      const instances: ConnectionManager[] = [];
      for (let i = 0; i < 5; i++) {
        instances.push(ConnectionManager.getInstance());
      }

      // All instances should be the same object
      instances.forEach((instance) => {
        expect(instance).toBe(instances[0]);
      });
    });
  });

  describe('error handling before initialization', () => {
    let manager: ConnectionManager;

    beforeEach(() => {
      manager = ConnectionManager.getInstance();
    });

    const errorMessage = 'Connection not initialized. Call initialize() first.';

    it('should throw error when getting client before initialization', () => {
      expect(() => manager.getClient()).toThrow(errorMessage);
    });

    it('should throw error when getting version detector before initialization', () => {
      expect(() => manager.getVersionDetector()).toThrow(errorMessage);
    });

    it('should throw error when getting schema introspector before initialization', () => {
      expect(() => manager.getSchemaIntrospector()).toThrow(errorMessage);
    });

    it('should throw error when getting instance info before initialization', () => {
      expect(() => manager.getInstanceInfo()).toThrow(errorMessage);
    });

    it('should throw error when getting schema info before initialization', () => {
      expect(() => manager.getSchemaInfo()).toThrow(errorMessage);
    });

    it('should return false from isConnected before initialization', () => {
      expect(manager.isConnected()).toBe(false);
    });
  });

  describe('refreshTokenScopes', () => {
    let manager: ConnectionManager;
    const TEST_URL = 'https://test-gitlab.com';

    beforeEach(() => {
      manager = ConnectionManager.getInstance();
      mockIsOAuthEnabled.mockReturnValue(false);
      mockDetectTokenScopes.mockReset();
    });

    it('should return false in OAuth mode', async () => {
      mockIsOAuthEnabled.mockReturnValue(true);

      const result = await manager.refreshTokenScopes();
      expect(result).toBe(false);
    });

    it('should return false when token detection fails (returns null)', async () => {
      injectInstanceState(manager, TEST_URL);
      mockDetectTokenScopes.mockResolvedValue(null);

      const result = await manager.refreshTokenScopes();
      expect(result).toBe(false);
      expect(mockDetectTokenScopes).toHaveBeenCalledWith(TEST_URL);
    });

    it('should return false when scopes have not changed', async () => {
      const initialScopes = {
        active: true,
        scopes: ['read_api', 'read_user'],
        hasGraphQLAccess: true,
        hasWriteAccess: false,
        tokenType: 'personal_access_token',
        name: 'test-token',
        expiresAt: null,
        daysUntilExpiry: null,
      };

      injectInstanceState(manager, TEST_URL, {
        tokenScopeInfo: initialScopes as unknown as InstanceState['tokenScopeInfo'],
      });
      mockDetectTokenScopes.mockResolvedValue(initialScopes);

      const result = await manager.refreshTokenScopes();
      expect(result).toBe(false);
    });

    it('should return true when scopes change (new scopes added)', async () => {
      const initialScopes = {
        active: true,
        scopes: ['read_api'],
        hasGraphQLAccess: true,
        hasWriteAccess: false,
        tokenType: 'personal_access_token',
        name: 'test-token',
        expiresAt: null,
        daysUntilExpiry: null,
      };

      injectInstanceState(manager, TEST_URL, {
        tokenScopeInfo: initialScopes as unknown as InstanceState['tokenScopeInfo'],
      });

      mockDetectTokenScopes.mockResolvedValue({
        ...initialScopes,
        scopes: ['api', 'read_api'],
        hasWriteAccess: true,
      });

      const result = await manager.refreshTokenScopes();
      expect(result).toBe(true);
    });

    it('should return true when GraphQL access changes', async () => {
      const initialScopes = {
        active: true,
        scopes: ['read_user'],
        hasGraphQLAccess: false,
        hasWriteAccess: false,
        tokenType: 'personal_access_token',
        name: 'test-token',
        expiresAt: null,
        daysUntilExpiry: null,
      };

      injectInstanceState(manager, TEST_URL, {
        tokenScopeInfo: initialScopes as unknown as InstanceState['tokenScopeInfo'],
      });

      mockDetectTokenScopes.mockResolvedValue({
        ...initialScopes,
        scopes: ['api'],
        hasGraphQLAccess: true,
      });

      const result = await manager.refreshTokenScopes();
      expect(result).toBe(true);
    });

    it('should return true when write access changes', async () => {
      const initialScopes = {
        active: true,
        scopes: ['read_api'],
        hasGraphQLAccess: true,
        hasWriteAccess: false,
        tokenType: 'personal_access_token',
        name: 'test-token',
        expiresAt: null,
        daysUntilExpiry: null,
      };

      injectInstanceState(manager, TEST_URL, {
        tokenScopeInfo: initialScopes as unknown as InstanceState['tokenScopeInfo'],
      });

      mockDetectTokenScopes.mockResolvedValue({
        ...initialScopes,
        scopes: ['api'],
        hasWriteAccess: true,
      });

      const result = await manager.refreshTokenScopes();
      expect(result).toBe(true);
    });

    it('should update tokenScopeInfo when scopes change', async () => {
      const initialScopes = {
        active: true,
        scopes: ['read_api'],
        hasGraphQLAccess: true,
        hasWriteAccess: false,
        tokenType: 'personal_access_token',
        name: 'test-token',
        expiresAt: null,
        daysUntilExpiry: null,
      };

      injectInstanceState(manager, TEST_URL, {
        tokenScopeInfo: initialScopes as unknown as InstanceState['tokenScopeInfo'],
      });

      const newScopes = {
        ...initialScopes,
        scopes: ['api'],
        hasWriteAccess: true,
      };
      mockDetectTokenScopes.mockResolvedValue(newScopes);

      await manager.refreshTokenScopes();

      const updatedInfo = manager.getTokenScopeInfo();
      expect(updatedInfo?.scopes).toEqual(['api']);
      expect(updatedInfo?.hasWriteAccess).toBe(true);
    });
  });

  describe('ensureIntrospected', () => {
    let manager: ConnectionManager;

    beforeEach(() => {
      manager = ConnectionManager.getInstance();
      mockIsOAuthEnabled.mockReturnValue(false);
    });

    it('should throw error when called before initialization', async () => {
      await expect(manager.ensureIntrospected()).rejects.toThrow(
        'Connection not initialized. Call initialize() first.',
      );
    });

    it('should return early if already introspected for same instance', async () => {
      // Mock context to return specific instance URL
      mockGetGitLabApiUrlFromContext.mockReturnValue('https://gitlab.example.com');

      // Simulate introspected state for the same instance
      injectInstanceState(manager, 'https://gitlab.example.com', {
        instanceInfo: {
          version: '16.0.0',
          tier: 'premium',
        } as unknown as InstanceState['instanceInfo'],
        schemaInfo: { workItemWidgetTypes: [] } as unknown as InstanceState['schemaInfo'],
        introspectedInstanceUrl: 'https://gitlab.example.com',
      });

      // Should not throw and return quickly (same instance)
      await expect(manager.ensureIntrospected()).resolves.toBeUndefined();
    });

    it('should deduplicate concurrent introspection calls for the same instance', async () => {
      // Set up manager with minimal initialized state so ensureIntrospected() proceeds
      mockGetGitLabApiUrlFromContext.mockReturnValue('https://gitlab.dedup.com');

      // Inject per-URL state with no cached introspection
      injectInstanceState(manager, 'https://gitlab.dedup.com', {
        client: {
          endpoint: 'https://gitlab.dedup.com/api/graphql',
        } as unknown as InstanceState['client'],
      });

      // Track how many times doIntrospection actually executes
      let introspectionCallCount = 0;

      // Mock doIntrospection to simulate async work with observable side effects
      jest
        .spyOn(
          internals(manager) as { doIntrospection: (...args: unknown[]) => Promise<void> },
          'doIntrospection',
        )
        .mockImplementation(async (...args: unknown[]) => {
          // Enforce doIntrospection(url: string) contract despite variadic mock signature
          expect(args).toHaveLength(1);
          expect(typeof args[0]).toBe('string');
          const url = args[0] as string;
          introspectionCallCount++;
          // Simulate async introspection delay
          await new Promise((resolve) => setTimeout(resolve, 50));
          // Set the results in per-URL state
          const state = internals(manager).instances.get(url)!;
          state.instanceInfo = {
            version: '17.0.0',
            tier: 'free',
          } as unknown as InstanceState['instanceInfo'];
          state.schemaInfo = { workItemWidgetTypes: [] } as unknown as InstanceState['schemaInfo'];
          state.introspectedInstanceUrl = url;
        });

      // Fire 5 concurrent calls — should all share the same promise
      await Promise.all([
        manager.ensureIntrospected(),
        manager.ensureIntrospected(),
        manager.ensureIntrospected(),
        manager.ensureIntrospected(),
        manager.ensureIntrospected(),
      ]);

      // doIntrospection should have been called exactly once due to deduplication
      expect(introspectionCallCount).toBe(1);
    });

    it('should clear introspection promise after completion', async () => {
      mockGetGitLabApiUrlFromContext.mockReturnValue('https://gitlab.clear.com');

      injectInstanceState(manager, 'https://gitlab.clear.com', {
        client: {
          endpoint: 'https://gitlab.clear.com/api/graphql',
        } as unknown as InstanceState['client'],
      });

      jest
        .spyOn(
          internals(manager) as { doIntrospection: (...args: unknown[]) => Promise<void> },
          'doIntrospection',
        )
        .mockImplementation(async (...args: unknown[]) => {
          // Enforce doIntrospection(url: string) contract despite variadic mock signature
          expect(args).toHaveLength(1);
          expect(typeof args[0]).toBe('string');
          const url = args[0] as string;
          const state = internals(manager).instances.get(url)!;
          state.instanceInfo = {
            version: '17.0.0',
            tier: 'free',
          } as unknown as InstanceState['instanceInfo'];
          state.schemaInfo = { workItemWidgetTypes: [] } as unknown as InstanceState['schemaInfo'];
          state.introspectedInstanceUrl = url;
        });

      await manager.ensureIntrospected();

      // Promise should be cleaned up from the map
      const promisesMap = internals(manager).introspectionPromises;
      expect(promisesMap.has('https://gitlab.clear.com')).toBe(false);
    });

    it('should clear introspection promise even when doIntrospection fails', async () => {
      mockGetGitLabApiUrlFromContext.mockReturnValue('https://gitlab.fail.com');

      injectInstanceState(manager, 'https://gitlab.fail.com', {
        client: {
          endpoint: 'https://gitlab.fail.com/api/graphql',
        } as unknown as InstanceState['client'],
      });

      jest
        .spyOn(
          internals(manager) as { doIntrospection: (...args: unknown[]) => Promise<void> },
          'doIntrospection',
        )
        .mockRejectedValue(new Error('Introspection network error'));

      await expect(manager.ensureIntrospected()).rejects.toThrow('Introspection network error');

      // Promise should still be cleaned up (finally block)
      const promisesMap = internals(manager).introspectionPromises;
      expect(promisesMap.has('https://gitlab.fail.com')).toBe(false);
    });
  });

  describe('instance cache eviction (TTL + LRU)', () => {
    let manager: ConnectionManager;

    /**
     * Injects an InstanceState with a specific access timestamp.
     * Preserves the `currentInstanceUrl` established by `beforeEach` so eviction
     * tests consistently exercise the unprotected TTL/LRU path — `injectInstanceState`
     * unconditionally overwrites `currentInstanceUrl` and would otherwise silently
     * protect the last-injected entry from eviction.
     */
    function injectWithTime(
      url: string,
      accessedAt: number,
      overrides: Partial<InstanceState> = {},
    ): void {
      const preservedCurrent = internals(manager).currentInstanceUrl;
      injectInstanceState(manager, url, { isInitialized: true, ...overrides });
      internals(manager).instanceAccessTimes.set(url, accessedAt);
      internals(manager).currentInstanceUrl = preservedCurrent;
    }

    beforeEach(() => {
      manager = ConnectionManager.getInstance();
      // Drive currentInstanceUrl to a "third-party" URL so that the injected
      // test URLs are not protected by the currentInstanceUrl guard.
      internals(manager).currentInstanceUrl = 'https://current.gitlab.com';
    });

    afterEach(() => {
      // Restore static defaults that individual tests may have mutated.
      statics().MAX_INSTANCES = 100;
      statics().INSTANCE_TTL_MS = 60 * 60 * 1000;
    });

    describe('evictExpired', () => {
      it('removes an entry whose access time is older than INSTANCE_TTL_MS', () => {
        const staleUrl = 'https://stale.gitlab.com';
        const freshUrl = 'https://fresh.gitlab.com';
        const now = Date.now();

        injectWithTime(staleUrl, 0); // epoch → always expired
        injectWithTime(freshUrl, now);

        internals(manager).evictExpired();

        expect(internals(manager).instances.has(staleUrl)).toBe(false);
        expect(internals(manager).instanceAccessTimes.has(staleUrl)).toBe(false);
        expect(internals(manager).instances.has(freshUrl)).toBe(true);
      });

      it('does not remove a fresh entry', () => {
        const freshUrl = 'https://nodrop.gitlab.com';
        injectWithTime(freshUrl, Date.now());

        internals(manager).evictExpired();

        expect(internals(manager).instances.has(freshUrl)).toBe(true);
      });

      it('does not evict currentInstanceUrl even if expired', () => {
        const currentUrl = 'https://current.gitlab.com';
        // Make currentUrl the active instance and inject with epoch timestamp
        injectInstanceState(manager, currentUrl, { isInitialized: true });
        internals(manager).instanceAccessTimes.set(currentUrl, 0);
        internals(manager).currentInstanceUrl = currentUrl;

        internals(manager).evictExpired();

        expect(internals(manager).instances.has(currentUrl)).toBe(true);
      });

      it('does not evict an entry with an in-flight initialize promise', () => {
        const inflightUrl = 'https://inflight.gitlab.com';
        injectWithTime(inflightUrl, 0);
        // Register an in-flight initialize promise
        const neverResolving = new Promise<void>(() => {});
        internals(manager).initializePromises.set(inflightUrl, neverResolving);

        internals(manager).evictExpired();

        expect(internals(manager).instances.has(inflightUrl)).toBe(true);

        internals(manager).initializePromises.delete(inflightUrl);
      });

      it('does not evict an entry with an in-flight introspection promise', () => {
        const introspectingUrl = 'https://introspecting.gitlab.com';
        injectWithTime(introspectingUrl, 0);
        const neverResolving = new Promise<void>(() => {});
        internals(manager).introspectionPromises.set(introspectingUrl, neverResolving);

        internals(manager).evictExpired();

        expect(internals(manager).instances.has(introspectingUrl)).toBe(true);

        internals(manager).introspectionPromises.delete(introspectingUrl);
      });
    });

    describe('evictLRUIfOverCapacity', () => {
      it('evicts the least-recently-used entry when over capacity', () => {
        statics().MAX_INSTANCES = 2;
        const now = Date.now();

        injectWithTime('https://a.gitlab.com', now - 3000); // oldest → LRU
        injectWithTime('https://b.gitlab.com', now - 2000);
        injectWithTime('https://c.gitlab.com', now - 1000);

        internals(manager).evictLRUIfOverCapacity();

        // Only 2 entries should remain; the LRU one is evicted
        expect(internals(manager).instances.size).toBe(2);
        expect(internals(manager).instances.has('https://a.gitlab.com')).toBe(false);
        expect(internals(manager).instances.has('https://b.gitlab.com')).toBe(true);
        expect(internals(manager).instances.has('https://c.gitlab.com')).toBe(true);
      });

      it('evicts multiple entries when significantly over capacity', () => {
        statics().MAX_INSTANCES = 1;
        const now = Date.now();

        injectWithTime('https://x1.gitlab.com', now - 5000);
        injectWithTime('https://x2.gitlab.com', now - 4000);
        injectWithTime('https://x3.gitlab.com', now - 3000);

        internals(manager).evictLRUIfOverCapacity();

        expect(internals(manager).instances.size).toBe(1);
        // Only the most recently accessed entry survives
        expect(internals(manager).instances.has('https://x3.gitlab.com')).toBe(true);
      });

      it('does not evict currentInstanceUrl even when it is LRU', () => {
        statics().MAX_INSTANCES = 1;
        const now = Date.now();

        const currentUrl = 'https://current-lru.gitlab.com';
        injectWithTime(currentUrl, now - 9999); // oldest → would be LRU
        injectWithTime('https://newer-lru.gitlab.com', now - 1000);
        // Point currentInstanceUrl at the LRU entry to verify it is protected.
        internals(manager).currentInstanceUrl = currentUrl;

        internals(manager).evictLRUIfOverCapacity();

        // currentInstanceUrl must survive even though it is the LRU entry
        expect(internals(manager).instances.has(currentUrl)).toBe(true);
      });

      it('does not evict entries with in-flight promises when all are protected', () => {
        statics().MAX_INSTANCES = 1;
        const now = Date.now();

        const urlA = 'https://prot-a.gitlab.com';
        const urlB = 'https://prot-b.gitlab.com';
        injectWithTime(urlA, now - 5000);
        injectWithTime(urlB, now - 4000);

        const neverResolving = new Promise<void>(() => {});
        internals(manager).initializePromises.set(urlA, neverResolving);
        internals(manager).initializePromises.set(urlB, neverResolving);

        internals(manager).evictLRUIfOverCapacity();

        // Both protected — neither should be evicted even though over capacity
        expect(internals(manager).instances.has(urlA)).toBe(true);
        expect(internals(manager).instances.has(urlB)).toBe(true);

        internals(manager).initializePromises.delete(urlA);
        internals(manager).initializePromises.delete(urlB);
      });

      it('does not evict when already at or below capacity', () => {
        statics().MAX_INSTANCES = 5;
        const now = Date.now();

        injectWithTime('https://ok1.gitlab.com', now - 1000);
        injectWithTime('https://ok2.gitlab.com', now - 2000);

        internals(manager).evictLRUIfOverCapacity();

        expect(internals(manager).instances.size).toBe(2);
      });
    });

    describe('touchInstance', () => {
      it('updates access time on resolveState (read path)', () => {
        const url = 'https://touch.gitlab.com';
        injectInstanceState(manager, url, { isInitialized: true });
        internals(manager).currentInstanceUrl = url;

        const before = Date.now();
        // Accessing the instance via getClient() triggers resolveState → touchInstance
        manager.getClient(url);
        const after = Date.now();

        const recorded = internals(manager).instanceAccessTimes.get(url)!;
        expect(recorded).toBeGreaterThanOrEqual(before);
        expect(recorded).toBeLessThanOrEqual(after);
      });
    });

    describe('reset clears instanceAccessTimes', () => {
      it('clears instanceAccessTimes on reset', () => {
        injectWithTime('https://willreset.gitlab.com', Date.now());
        expect(internals(manager).instanceAccessTimes.size).toBeGreaterThan(0);

        manager.reset();

        expect(internals(manager).instanceAccessTimes.size).toBe(0);
      });
    });
  });

  describe('reinitialize', () => {
    let manager: ConnectionManager;

    beforeEach(() => {
      manager = ConnectionManager.getInstance();
      mockIsOAuthEnabled.mockReturnValue(false);
    });

    it('should restore saved state on failed reinitialize', async () => {
      // Set up initial state for the URL
      injectInstanceState(manager, 'https://new-gitlab.com', {
        instanceInfo: {
          version: '15.0.0',
          tier: 'free',
        } as unknown as InstanceState['instanceInfo'],
        schemaInfo: { workItemWidgetTypes: ['OLD'] } as unknown as InstanceState['schemaInfo'],
        isInitialized: true,
      });

      // Force initialize to reject so the rollback path is always exercised,
      // regardless of ambient config (tokens, GITLAB_BASE_URL)
      const initSpy = jest
        .spyOn(manager, 'initialize')
        .mockRejectedValue(new Error('forced test failure'));

      await expect(manager.reinitialize('https://new-gitlab.com')).rejects.toThrow(
        'forced test failure',
      );

      expect(initSpy).toHaveBeenCalledWith('https://new-gitlab.com');

      // On failure, saved state is restored so the URL remains usable
      expect(internals(manager).instances.has('https://new-gitlab.com')).toBe(true);
      expect(internals(manager).instances.get('https://new-gitlab.com')!.isInitialized).toBe(true);
      // currentInstanceUrl must also be restored so zero-arg accessors
      // (getInstanceInfo(), getClient()) point at the correct instance
      expect(internals(manager).currentInstanceUrl).toBe('https://new-gitlab.com');

      initSpy.mockRestore();
    });
  });
});
