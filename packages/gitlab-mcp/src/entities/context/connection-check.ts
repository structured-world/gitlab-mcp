/**
 * Connection check for the settings page: the account, whether GitLab answers, the
 * restrictions in effect, and what to do about problems. It reports no token and no
 * other user's data.
 */

import { GITLAB_BASE_URL } from '../../config';
import { currentCaller, getConfigurationService, resolveCaller } from '../../configuration';
import { toolRestriction } from '../../configuration/policy';
import { getTokenContext } from '../../oauth/token-context';
import { isToolAvailableForScopes } from '../../services/TokenScopeDetector';
import { executeWhoami } from './whoami';

export interface ConnectionCheck {
  account: string;
  instance: string;
  gitlabVersion: string;
  tier: string;
  /** Whether GitLab identified the account with the current credentials. */
  authenticated: boolean;
  readOnly: boolean;
  preset: string | null;
  scope: string | null;
  availableTools: number;
  warnings: string[];
  recommendations: string[];
}

export const CONNECTION_CHECK_OUTPUT_SCHEMA = {
  type: 'object' as const,
  properties: {
    account: { type: 'string' },
    instance: { type: 'string' },
    gitlabVersion: { type: 'string' },
    tier: { type: 'string' },
    authenticated: { type: 'boolean' },
    readOnly: { type: 'boolean' },
    preset: { type: ['string', 'null'] },
    scope: { type: ['string', 'null'] },
    availableTools: { type: 'number' },
    warnings: { type: 'array', items: { type: 'string' } },
    recommendations: { type: 'array', items: { type: 'string' } },
  },
  required: [
    'account',
    'instance',
    'gitlabVersion',
    'tier',
    'authenticated',
    'readOnly',
    'preset',
    'scope',
    'availableTools',
    'warnings',
    'recommendations',
  ],
  additionalProperties: false,
};

export async function checkConnection(): Promise<ConnectionCheck> {
  const caller = currentCaller() ?? resolveCaller(undefined, GITLAB_BASE_URL);
  const [whoami, resolved] = await Promise.all([
    executeWhoami(),
    getConfigurationService().resolve(caller),
  ]);
  const scope = resolved.policy.scope;
  // What this caller can call, as tools/list shows it: the instance's tools narrowed by
  // the OAuth token's scopes and by the caller's own settings.
  const { RegistryManager } = await import('../../registry-manager');
  const registry = RegistryManager.getInstance();
  const tokenScopes = getTokenContext()?.gitlabScopes;
  const availableTools = registry
    .getAvailableToolNames(caller.instanceUrl)
    .filter(
      (name) =>
        (tokenScopes === undefined || isToolAvailableForScopes(name, tokenScopes)) &&
        toolRestriction(resolved.policy, registry.getToolFacts(name)) === null,
    ).length;
  const warnings = [...whoami.warnings];
  const recommendations = whoami.recommendations.map((r) => r.message);
  if (resolved.presetUnavailable) {
    warnings.push(
      `The saved preset '${resolved.presetUnavailable}' no longer exists on this server; tools that change GitLab are off until another preset is chosen.`,
    );
    recommendations.push('Choose another preset in the GitLab settings, or with update_settings.');
  }
  return {
    account: whoami.user?.username ?? caller.accountLabel,
    instance: whoami.server.apiUrl,
    gitlabVersion: whoami.server.version,
    tier: whoami.server.tier,
    authenticated: whoami.user !== null,
    readOnly: whoami.server.readOnlyMode || resolved.policy.readOnly,
    preset: resolved.policy.presetName ?? null,
    scope: scope?.project ?? scope?.group ?? scope?.namespace ?? null,
    availableTools,
    warnings,
    recommendations,
  };
}
