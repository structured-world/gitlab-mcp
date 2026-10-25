import {
  assertSafeApiPath,
  assertSafeApiUrl,
  canonicalProjectPath,
  encodeApiSegment,
} from '../../../src/utils/api-path';
import { numericId } from '../../../src/entities/utils';
import { BrowseUsersSchema } from '../../../src/entities/core/schema-readonly';

// Percent decoding, policy comparisons and URL serialization must agree on one identity.
it.each(['team/app', 'team%2Fapp', ' team%2fapp '])('canonicalizes %s exactly once', (value) => {
  expect(canonicalProjectPath(value)).toBe('team/app');
});

// Neither raw nor mixed-encoded syntax may escape the selected REST route.
it.each([
  '.',
  '..',
  'team/../other',
  'team%2F%2e%2e%2Fother',
  'team\\..\\other',
  '%',
  '%252e%252e',
  'team?x',
  'team#x',
  'team\napp',
  '',
])('rejects invalid project syntax %j', (value) => {
  expect(() => canonicalProjectPath(value)).toThrow();
});

// Filenames and refs remain valid opaque segments, including punctuation and embedded slashes.
it('encodes opaque non-project segments without URL reinterpretation', () => {
  expect(encodeApiSegment('feature/topic?x#y%2f')).toBe('feature%2Ftopic%3Fx%23y%252f');
  expect(encodeApiSegment(17)).toBe('17');
  expect(() => assertSafeApiPath('projects/team%2Fapp/repository/files/a%3Fb%23c')).not.toThrow();
  expect(() =>
    assertSafeApiUrl('https://gitlab.example.com/api/v4/projects/17?per_page=20'),
  ).not.toThrow();
  expect(() => assertSafeApiUrl('https://gitlab.example.com/oauth/token')).not.toThrow();
});

// Both JSON and byte-response routes reject URL normalization before authenticated I/O.
it.each([
  '/projects/17',
  'projects/17#fragment',
  'projects/17?query',
  'projects/17/..',
  'projects/17/%2E%2E',
  'projects/17\\user',
  'projects/17\n',
])('refuses unsafe REST paths %j', (value) => {
  expect(() => assertSafeApiPath(value)).toThrow();
});

// Numeric IDs preserve arbitrarily large decimal strings, but reject lossy JS numbers.
it('accepts only positive integer IDs', () => {
  for (const value of [1, '17', '9007199254740993'])
    expect(numericId.safeParse(value).success).toBe(true);
  for (const value of [
    undefined,
    null,
    '',
    0,
    -1,
    1.5,
    Number.MAX_SAFE_INTEGER + 1,
    '1e3',
    '01',
    '../17',
    {},
    true,
  ])
    expect(numericId.safeParse(value).success).toBe(false);
});

// A user lookup uses a numeric REST ID; malformed IDs must fail in its actual schema.
it.each([0, -1, 1.5, '../17'])('rejects invalid user ID %s', (user_id) => {
  expect(BrowseUsersSchema.safeParse({ action: 'get', user_id }).success).toBe(false);
});
