/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        isolatedModules: true,
        tsconfig: {
          ignoreDeprecations: '6.0',
          module: 'commonjs',
          moduleResolution: 'node',
          esModuleInterop: true,
          allowSyntheticDefaultImports: true,
          types: ['jest', 'node'],
        },
      },
    ],
  },
  moduleNameMapper: {
    // The contract is type-only; resolve it to core's source for ts-jest.
    '^@structured-world/gitlab-mcp/storage-contract$': '<rootDir>/../gitlab-mcp/src/contracts/storage.ts',
  },
};
