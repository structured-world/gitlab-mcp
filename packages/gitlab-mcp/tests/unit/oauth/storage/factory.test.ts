/**
 * Storage backend selection: OAUTH_STORAGE_TYPE picks memory, file or PostgreSQL, and the
 * PostgreSQL backend comes from the optional database package with an explicit URL.
 */

jest.mock('../../../../src/logger', () => ({
  logInfo: jest.fn(),
  logDebug: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

const savedEnv = { ...process.env };

afterEach(() => {
  process.env = { ...savedEnv };
  jest.resetModules();
});

function storageEnv(values: Record<string, string | undefined>): void {
  delete process.env.OAUTH_STORAGE_TYPE;
  delete process.env.OAUTH_STORAGE_FILE_PATH;
  delete process.env.OAUTH_STORAGE_POSTGRESQL_URL;
  delete process.env.DATABASE_URL;
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) process.env[key] = value;
  }
}

describe('createStorageBackend', () => {
  it('keeps sessions in memory by default', async () => {
    storageEnv({});
    const { createStorageBackend } = await import('../../../../src/oauth/storage/factory');

    expect(createStorageBackend().type).toBe('memory');
  });

  it('uses the file backend when configured', async () => {
    storageEnv({ OAUTH_STORAGE_TYPE: 'file', OAUTH_STORAGE_FILE_PATH: '/tmp/sessions.json' });
    const { createStorageBackend } = await import('../../../../src/oauth/storage/factory');

    expect(createStorageBackend().type).toBe('file');
  });

  it('refuses PostgreSQL without a connection string', async () => {
    storageEnv({ OAUTH_STORAGE_TYPE: 'postgresql' });
    const { createStorageBackend } = await import('../../../../src/oauth/storage/factory');

    expect(() => createStorageBackend()).toThrow('PostgreSQL storage requires a connection string');
  });

  // The URL is passed explicitly, so the backend never reads a different variable.
  it('builds the PostgreSQL backend of the database package with the configured URL', async () => {
    storageEnv({
      OAUTH_STORAGE_TYPE: 'postgresql',
      OAUTH_STORAGE_POSTGRESQL_URL: 'postgresql://db.example/mcp',
    });
    const constructed: unknown[] = [];
    // Virtual: the optional package is not built in every checkout (CI runs core alone).
    jest.doMock(
      '@structured-world/gitlab-mcp-db',
      () => ({
        PostgreSQLStorageBackend: class {
          readonly type = 'postgresql';
          constructor(options: unknown) {
            constructed.push(options);
          }
        },
      }),
      { virtual: true },
    );
    const { createStorageBackend } = await import('../../../../src/oauth/storage/factory');

    expect(createStorageBackend().type).toBe('postgresql');
    expect(constructed).toEqual([{ connectionString: 'postgresql://db.example/mcp' }]);
  });

  it('explains how to install the database package when it is missing', async () => {
    storageEnv({ OAUTH_STORAGE_TYPE: 'postgresql', DATABASE_URL: 'postgresql://db.example/mcp' });
    jest.doMock(
      '@structured-world/gitlab-mcp-db',
      () => {
        throw new Error("Cannot find module '@structured-world/gitlab-mcp-db'");
      },
      { virtual: true },
    );
    const { createStorageBackend } = await import('../../../../src/oauth/storage/factory');

    expect(() => createStorageBackend()).toThrow(
      "PostgreSQL storage requires the optional '@structured-world/gitlab-mcp-db' package",
    );
  });
});

describe('validateStorageConfig', () => {
  it('reports a PostgreSQL backend without a connection string', async () => {
    storageEnv({ OAUTH_STORAGE_TYPE: 'postgresql' });
    const { validateStorageConfig } = await import('../../../../src/oauth/storage/factory');

    expect(validateStorageConfig()).toEqual([
      'PostgreSQL storage requires OAUTH_STORAGE_POSTGRESQL_URL or DATABASE_URL environment variable',
    ]);
  });

  it("rejects a file path that climbs with '..'", async () => {
    storageEnv({ OAUTH_STORAGE_TYPE: 'file', OAUTH_STORAGE_FILE_PATH: '../sessions.json' });
    const { validateStorageConfig } = await import('../../../../src/oauth/storage/factory');

    expect(validateStorageConfig()).toEqual(["File storage path must not contain '..'"]);
  });

  it('accepts a complete configuration', async () => {
    storageEnv({ OAUTH_STORAGE_TYPE: 'file', OAUTH_STORAGE_FILE_PATH: '/data/sessions.json' });
    const { validateStorageConfig, getStorageType } =
      await import('../../../../src/oauth/storage/factory');

    expect(validateStorageConfig()).toEqual([]);
    expect(getStorageType()).toBe('file');
  });
});
