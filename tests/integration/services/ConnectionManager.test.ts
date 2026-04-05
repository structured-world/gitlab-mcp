/**
 * Integration tests for ConnectionManager service
 * Tests real environment integration and initialization with GitLab
 */

import { ConnectionManager } from '../../../src/services/ConnectionManager';
import { SchemaIntrospector } from '../../../src/services/SchemaIntrospector';

describe('ConnectionManager Integration', () => {
  let manager: ConnectionManager;

  beforeEach(() => {
    // Reset singleton instance for each test
    (ConnectionManager as any).instance = null;
    manager = ConnectionManager.getInstance();
  });

  it('should initialize successfully with real environment', async () => {
    // This test uses real environment variables from .env.test
    await expect(manager.initialize()).resolves.not.toThrow();

    // Verify services are available
    expect(manager.getClient()).toBeDefined();
    expect(manager.getVersionDetector()).toBeDefined();
    expect(manager.getSchemaIntrospector()).toBeDefined();
    expect(manager.getInstanceInfo()).toBeDefined();
    expect(manager.getSchemaInfo()).toBeDefined();
  });

  it('should detect real GitLab instance information', async () => {
    await manager.initialize();

    const instanceInfo = manager.getInstanceInfo();
    expect(instanceInfo.version).toMatch(/^\d+\.\d+\.\d+/); // Valid version format
    expect(['free', 'premium', 'ultimate']).toContain(instanceInfo.tier);
    expect(instanceInfo.features).toBeDefined();
    expect(instanceInfo.detectedAt).toBeInstanceOf(Date);
  });

  it('should introspect real GitLab schema', async () => {
    await manager.initialize();

    const schemaInfo = manager.getSchemaInfo();
    expect(Array.isArray(schemaInfo.workItemWidgetTypes)).toBe(true);
    expect(schemaInfo.workItemWidgetTypes.length).toBeGreaterThan(0);
    expect(schemaInfo.typeDefinitions).toBeInstanceOf(Map);
    expect(schemaInfo.availableFeatures).toBeInstanceOf(Set);
  });

  // Regression: #374 — after a cache-hit init, SchemaIntrospector must have
  // its internal cache populated so that direct callers (DynamicWorkItemsQuery)
  // can call isWidgetTypeAvailable() / getFieldsForType() without errors.
  it('should rehydrate SchemaIntrospector on cache-hit re-initialization', async () => {
    // First init: populates introspection cache via live GraphQL
    await manager.initialize();
    const widgetTypes = manager.getSchemaInfo().workItemWidgetTypes;
    expect(widgetTypes.length).toBeGreaterThan(0);

    // Clear per-URL state but keep static introspection cache
    const internals = manager as unknown as {
      instances: Map<string, unknown>;
      currentInstanceUrl: string | null;
    };
    internals.instances.clear();
    internals.currentInstanceUrl = null;

    // Spy on prototype BEFORE second init to prove cache-hit path was taken
    // (introspectSchema must NOT be called — rehydrate() populates the cache instead)
    const introspectSpy = jest.spyOn(SchemaIntrospector.prototype, 'introspectSchema');

    // Second init: hits the static cache (no GraphQL call)
    await manager.initialize();

    // Cache-hit proof: introspectSchema was never called on the new instance
    expect(introspectSpy).not.toHaveBeenCalled();
    introspectSpy.mockRestore();

    // SchemaIntrospector must be rehydrated — getCachedSchema() should not be null
    const introspector = manager.getSchemaIntrospector();
    const cached = introspector.getCachedSchema();
    expect(cached).not.toBeNull();
    expect(cached!.workItemWidgetTypes).toEqual(widgetTypes);

    // Direct method calls must work (these would throw before #374 fix)
    expect(introspector.isWidgetTypeAvailable(widgetTypes[0])).toBe(true);
    expect(introspector.getAvailableWidgetTypes().length).toBeGreaterThan(0);
  });
});
