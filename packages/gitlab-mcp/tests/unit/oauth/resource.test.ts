/**
 * The `resource` request parameter (RFC 8707 section 2): it may repeat, and a token here has
 * one audience, so only values naming one resource of this server are accepted.
 */

import { resourceParameter } from '../../../src/oauth/resource';

const ISSUER = 'https://mcp.example.com';

describe('resourceParameter', () => {
  it('is undefined when the parameter is absent', () => {
    expect(resourceParameter(ISSUER, undefined)).toBeUndefined();
  });

  it.each([
    ['the root', ISSUER, ISSUER],
    ['the root with a trailing slash', `${ISSUER}/`, ISSUER],
    ['the /mcp endpoint', `${ISSUER}/mcp`, `${ISSUER}/mcp`],
    ['one target repeated', [`${ISSUER}/mcp`, `${ISSUER}/mcp`], `${ISSUER}/mcp`],
    ['one target in equivalent spellings', [ISSUER, `${ISSUER}/`], ISSUER],
  ])('names %s', (_case, value, expected) => {
    expect(resourceParameter(ISSUER, value)).toBe(expected);
  });

  it.each([
    ['another server', 'https://other.example.com/mcp'],
    ['two targets of this server', [ISSUER, `${ISSUER}/mcp`]],
    ['a foreign value among ours', [`${ISSUER}/mcp`, 'https://other.example.com/mcp']],
    // A form body parsed with nested syntax can carry objects instead of strings.
    ['a value that is not a string', [{ url: ISSUER }]],
    ['an empty list', []],
  ])('refuses %s', (_case, value) => {
    expect(resourceParameter(ISSUER, value)).toBeNull();
  });
});
