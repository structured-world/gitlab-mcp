/**
 * GitLab Duo settings that GitLab drops from an update without an error when the
 * add-on, licensed feature or feature flag behind them is missing
 * (EE::API::Helpers::ProjectsHelpers#filter_attributes_using_license!,
 * EE::Groups::UpdateService). An add-on purchase is invisible to tier gating, so
 * the update handlers compare what was requested with the entity GitLab returns.
 * Values are the condition GitLab checks, reported back when a setting is dropped.
 */
export const PROJECT_DUO_SETTINGS: Readonly<Record<string, string>> = {
  auto_duo_code_review_enabled:
    'GitLab Duo turned on for the project and either the Duo Enterprise add-on or Duo Agent Platform code review',
  duo_remote_flows_enabled: 'the Duo Agent Platform (ai_workflows) licensed feature',
  duo_sast_fp_detection_enabled: 'the GitLab Duo AI features (Ultimate) licensed feature',
  duo_sast_vr_workflow_enabled: 'the GitLab Duo AI features (Ultimate) licensed feature',
  duo_secret_detection_fp_enabled:
    'the GitLab Duo AI features (Ultimate) licensed feature and the duo_secret_detection_false_positive feature flag',
  duo_dependency_bump_breaking_changes_enabled:
    'the GitLab Duo AI features (Ultimate) licensed feature',
};

export const GROUP_DUO_SETTINGS: Readonly<Record<string, string>> = {
  auto_duo_code_review_enabled:
    'GitLab Duo turned on for the group and either the Duo Enterprise add-on or Duo Agent Platform code review',
};

/** A requested setting that the returned entity does not reflect. */
export interface UnappliedSetting {
  setting: string;
  requested: unknown;
  /** Value GitLab returned; absent when GitLab does not expose the setting at all. */
  current?: unknown;
  requires: string;
}

/**
 * Attach `not_applied` to an update response for every tracked setting whose
 * requested value the returned entity does not carry. The response is returned
 * unchanged when everything was applied or it is not a JSON object.
 */
export function withUnappliedSettings(
  requested: Readonly<Record<string, unknown>>,
  response: unknown,
  tracked: Readonly<Record<string, string>>,
): unknown {
  if (typeof response !== 'object' || response === null || Array.isArray(response)) {
    return response;
  }
  const returned = response as Record<string, unknown>;

  const notApplied: UnappliedSetting[] = [];
  for (const [setting, requires] of Object.entries(tracked)) {
    const value = requested[setting];
    if (value === undefined || returned[setting] === value) continue;
    notApplied.push(
      setting in returned
        ? { setting, requested: value, current: returned[setting], requires }
        : { setting, requested: value, requires },
    );
  }

  return notApplied.length === 0 ? response : { ...returned, not_applied: notApplied };
}
