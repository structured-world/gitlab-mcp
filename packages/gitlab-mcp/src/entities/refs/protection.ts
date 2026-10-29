/** Verify protection settings against the entity GitLab actually returned. */

type AccessRule = {
  user_id?: number;
  group_id?: number;
  access_level?: number;
};

interface ProtectionRequest {
  unprotect_access_level?: number;
  allowed_to_create?: AccessRule[];
  allowed_to_push?: AccessRule[];
  allowed_to_merge?: AccessRule[];
  allowed_to_unprotect?: AccessRule[];
  code_owner_approval_required?: boolean;
}

interface UnappliedProtection {
  setting: string;
  requested: unknown;
  requires: string;
}

const ACCESS_FIELDS = [
  ['allowed_to_create', 'create_access_levels'],
  ['allowed_to_push', 'push_access_levels'],
  ['allowed_to_merge', 'merge_access_levels'],
  ['allowed_to_unprotect', 'unprotect_access_levels'],
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRoleGrant(rule: Record<string, unknown>): boolean {
  return (
    rule.user_id == null &&
    rule.group_id == null &&
    rule.deploy_key_id == null &&
    rule.member_role_id == null
  );
}

function containsRole(level: number, actual: unknown): boolean {
  if (!Array.isArray(actual)) return false;
  for (const entry of actual) {
    if (isRecord(entry) && entry.access_level === level && isRoleGrant(entry)) return true;
  }
  return false;
}

const SELECTORS = ['user_id', 'group_id', 'access_level'] as const;
const ROLE_MASK = 1 << 2;

function selectorMask(rule: AccessRule): number {
  let mask = 0;
  for (let field = 0; field < SELECTORS.length; field++) {
    if (rule[SELECTORS[field]] !== undefined) mask |= 1 << field;
  }
  return mask;
}

function ruleKey(rule: Record<string, unknown>, mask: number): string | undefined {
  if (mask === 0) return undefined;
  // An access-level-only request means a role-wide grant, not a named identity's role.
  if (mask === ROLE_MASK && !isRoleGrant(rule)) return undefined;
  let key = String(mask);
  for (let field = 0; field < SELECTORS.length; field++) {
    if ((mask & (1 << field)) === 0) continue;
    const value = rule[SELECTORS[field]];
    if (typeof value !== 'number') return undefined;
    key += `:${value}`;
  }
  return key;
}

function indexRules(rules: AccessRule[], actual: unknown): Set<string> | undefined {
  if (rules.length === 0 || !Array.isArray(actual)) return undefined;
  const masks = new Set<number>();
  for (const rule of rules) masks.add(selectorMask(rule));
  const keys = new Set<string>();
  // Three optional selectors give at most seven nonempty shapes, so verification is
  // O(requested + returned), including duplicate grants or mixed selector objects.
  for (const entry of actual) {
    if (!isRecord(entry)) continue;
    for (const mask of masks) {
      const key = ruleKey(entry, mask);
      if (key !== undefined) keys.add(key);
    }
  }
  return keys;
}

function collectUnappliedRules(
  setting: string,
  rules: AccessRule[],
  actual: unknown,
  notApplied: UnappliedProtection[] | undefined,
): UnappliedProtection[] | undefined {
  const applied = indexRules(rules, actual);
  for (let index = 0; index < rules.length; index++) {
    const rule = rules[index];
    const key = ruleKey(rule, selectorMask(rule));
    if (key !== undefined && applied?.has(key)) continue;
    notApplied ??= [];
    notApplied.push({
      setting: `${setting}[${index}]`,
      requested: rule,
      requires:
        'GitLab EE for access lists; Premium or Ultimate for user/group grants, and project membership for each grant',
    });
  }
  return notApplied;
}

/**
 * CE ignores EE access lists; EE permits role entries but licenses user/group grants.
 * GitLab 16.0: app/services/protected_refs/access_level_params.rb and
 * ee/app/models/concerns/ee/protected_ref_access.rb (role exception to license checks).
 * https://gitlab.com/gitlab-org/gitlab/-/blob/v16.0.0-ee/ee/app/models/concerns/ee/protected_ref_access.rb
 */
export function withUnappliedProtection(requested: ProtectionRequest, response: unknown): unknown {
  const returned = isRecord(response) ? response : undefined;
  let notApplied: UnappliedProtection[] | undefined;
  for (const [setting, responseField] of ACCESS_FIELDS) {
    const rules = requested[setting];
    if (rules === undefined) continue;
    const actual = returned?.[responseField];
    notApplied = collectUnappliedRules(setting, rules, actual, notApplied);
  }
  if (
    requested.unprotect_access_level !== undefined &&
    !containsRole(requested.unprotect_access_level, returned?.unprotect_access_levels)
  ) {
    notApplied ??= [];
    notApplied.push({
      setting: 'unprotect_access_level',
      requested: requested.unprotect_access_level,
      requires: 'GitLab EE with role-based branch-unprotection settings',
    });
  }
  if (
    requested.code_owner_approval_required !== undefined &&
    returned?.code_owner_approval_required !== requested.code_owner_approval_required
  ) {
    notApplied ??= [];
    notApplied.push({
      setting: 'code_owner_approval_required',
      requested: requested.code_owner_approval_required,
      requires: 'GitLab Premium or Ultimate with code owner approval available for this project',
    });
  }
  if (!notApplied) return response;
  // The handler owns this freshly parsed response; attaching diagnostics needs no entity copy.
  if (returned) {
    returned.not_applied = notApplied;
    return returned;
  }
  return { result: response, not_applied: notApplied };
}
