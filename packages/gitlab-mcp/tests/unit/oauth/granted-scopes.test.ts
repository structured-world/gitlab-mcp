import { grantedGitlabScopes } from '../../../src/oauth/granted-scopes';

it('distinguishes omitted scope, explicit restriction, and unknown persisted grants', () => {
  // OAuth §5.1 omission means unchanged scope; an explicit empty grant must never expand.
  const requested = ['api', 'read_user'];
  expect(grantedGitlabScopes(undefined, requested)).toBe(requested);
  expect(grantedGitlabScopes('read_api  read_user', requested)).toEqual(['read_api', 'read_user']);
  expect(grantedGitlabScopes('', requested)).toEqual([]);
  expect(grantedGitlabScopes(undefined, undefined)).toBeUndefined();
});
