/**
 * Instance capability probes used by handlers to choose a native or fallback
 * path. graphqlSupports reads the introspected schema; it must fail open (native
 * path) only when the schema is unknown, never when a type or field is absent.
 */

import {
  assertInstanceAtLeast,
  graphqlSupports,
  instanceAtLeast,
} from '../../../src/entities/instance-version';
import type { IndexedField, SchemaFieldIndex } from '../../../src/services/SchemaIntrospector';

const field = (args: string[] = []): IndexedField => ({ type: 'String', args: new Set(args) });

let schema: { fieldIndex?: SchemaFieldIndex } | Error = {};
let instance: { version: string; tier: string } | Error = { version: '17.0.0', tier: 'free' };

jest.mock('../../../src/oauth/token-context', () => ({
  getGitLabApiUrlFromContext: () => 'https://gitlab.example.com',
}));
jest.mock('../../../src/services/ConnectionManager', () => ({
  ConnectionManager: {
    getInstance: () => ({
      getSchemaInfo: () => {
        if (schema instanceof Error) throw schema;
        return schema;
      },
      getInstanceInfo: () => {
        if (instance instanceof Error) throw instance;
        return instance;
      },
    }),
  },
}));

beforeEach(() => {
  schema = {
    fieldIndex: new Map([['Namespace', new Map([['workItems', field(['types'])]])]]),
  };
  instance = { version: '17.0.0', tier: 'free' };
});

describe('graphqlSupports', () => {
  it('answers from the schema for type, field and argument', () => {
    expect(graphqlSupports('Namespace')).toBe(true);
    expect(graphqlSupports('Namespace', 'workItems')).toBe(true);
    expect(graphqlSupports('Namespace', 'workItems', 'types')).toBe(true);

    expect(graphqlSupports('Group')).toBe(false);
    expect(graphqlSupports('Namespace', 'workItemTypes')).toBe(false);
    expect(graphqlSupports('Namespace', 'workItems', 'sort')).toBe(false);
  });

  it('fails open when introspection produced no index', () => {
    schema = {};
    expect(graphqlSupports('Group', 'workItems')).toBe(true);
  });

  it('fails open when the connection is not initialised', () => {
    schema = new Error('not initialised');
    expect(graphqlSupports('Group', 'workItems')).toBe(true);
  });
});

describe('instanceAtLeast / assertInstanceAtLeast', () => {
  it('compares the detected version', () => {
    expect(instanceAtLeast('16.5')).toBe(true);
    expect(instanceAtLeast('17.1')).toBe(false);
    expect(() => assertInstanceAtLeast('17.1', 'Testing a group webhook')).toThrow(
      'Testing a group webhook requires GitLab 17.1+',
    );
  });

  it('fails open when the version is unknown', () => {
    instance = new Error('not initialised');
    expect(instanceAtLeast('99.0')).toBe(true);
    expect(() => assertInstanceAtLeast('99.0', 'X')).not.toThrow();
  });
});
