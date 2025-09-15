import { z } from 'zod';
import { flexibleBoolean } from '../utils';

// WRITE-ONLY OPERATION SCHEMAS

// Repository operations (write)
export const CreateRepositorySchema = z.object({
  name: z.string().describe('The name of the new project'),
  path: z.string().optional().describe('Repository name for the new project'),
  namespace_id: z.coerce.string().optional().describe('Namespace ID for the new project'),
  description: z.string().optional().describe('Short project description'),
  issues_enabled: flexibleBoolean.optional().describe('Enable issues for this project'),
  merge_requests_enabled: flexibleBoolean
    .optional()
    .describe('Enable merge requests for this project'),
  jobs_enabled: flexibleBoolean.optional().describe('Enable jobs for this project'),
  wiki_enabled: flexibleBoolean.optional().describe('Enable wiki for this project'),
  snippets_enabled: flexibleBoolean.optional().describe('Enable snippets for this project'),
  resolve_outdated_diff_discussions: flexibleBoolean
    .optional()
    .describe('Automatically resolve merge request diffs discussions on lines changed with a push'),
  container_registry_enabled: flexibleBoolean
    .optional()
    .describe('Enable container registry for this project'),
  container_registry_access_level: z
    .enum(['disabled', 'private', 'enabled'])
    .optional()
    .describe('Set visibility of container registry'),
  shared_runners_enabled: flexibleBoolean
    .optional()
    .describe('Enable shared runners for this project'),
  visibility: z
    .enum(['private', 'internal', 'public'])
    .optional()
    .describe('Set project visibility level'),
  import_url: z.string().optional().describe('URL to import repository from'),
  public_jobs: flexibleBoolean.optional().describe('Set to true to allow public access to jobs'),
  only_allow_merge_if_pipeline_succeeds: flexibleBoolean
    .optional()
    .describe('Set whether merge requests can only be merged with successful jobs'),
  allow_merge_on_skipped_pipeline: flexibleBoolean
    .optional()
    .describe('Set whether or not skipped pipelines are considered as successful'),
  only_allow_merge_if_all_discussions_are_resolved: flexibleBoolean
    .optional()
    .describe(
      'Set whether merge requests can only be merged when all the discussions are resolved',
    ),
  merge_method: z
    .enum(['merge', 'rebase_merge', 'ff'])
    .optional()
    .describe('Set the merge method used'),
  autoclose_referenced_issues: flexibleBoolean
    .optional()
    .describe('Set whether auto-closing referenced issues on default branch'),
  suggestion_commit_message: z
    .string()
    .optional()
    .describe('The commit message used to apply merge request suggestions'),
  remove_source_branch_after_merge: flexibleBoolean
    .optional()
    .describe('Enable Delete source branch option by default for all new merge requests'),
  lfs_enabled: flexibleBoolean.optional().describe('Enable LFS'),
  request_access_enabled: flexibleBoolean
    .optional()
    .describe('Allow users to request member access'),
  tag_list: z.array(z.string()).optional().describe('The list of tags for a project'),
  printing_merge_request_link_enabled: flexibleBoolean
    .optional()
    .describe('Show link to create/view merge request when pushing from the command line'),
  build_git_strategy: z
    .enum(['fetch', 'clone'])
    .optional()
    .describe('The Git strategy. Defaults to fetch'),
  build_timeout: z
    .number()
    .optional()
    .describe('The maximum amount of time, in seconds, that a job can run'),
  auto_cancel_pending_pipelines: z
    .enum(['disabled', 'enabled'])
    .optional()
    .describe('Auto-cancel pending pipelines'),
  build_coverage_regex: z.string().optional().describe('Test coverage parsing'),
  ci_config_path: z.string().optional().describe('The path to CI config file'),
  auto_devops_enabled: flexibleBoolean.optional().describe('Enable Auto DevOps for this project'),
  auto_devops_deploy_strategy: z
    .enum(['continuous', 'manual', 'timed_incremental'])
    .optional()
    .describe('Auto Deploy strategy'),
  repository_storage: z.string().optional().describe('Which storage shard the repository is on'),
  approvals_before_merge: z
    .number()
    .optional()
    .describe('How many approvers should approve merge requests by default'),
  external_authorization_classification_label: z
    .string()
    .optional()
    .describe('The classification label for the project'),
  mirror: flexibleBoolean.optional().describe('Enables pull mirroring in a project'),
  mirror_trigger_builds: flexibleBoolean.optional().describe('Pull mirroring triggers builds'),
  initialize_with_readme: flexibleBoolean.optional().describe('Initialize project with README.md'),
  template_name: z
    .string()
    .optional()
    .describe('When used with use_custom_template, ID of the custom project template'),
  template_project_id: z
    .number()
    .optional()
    .describe('When used with use_custom_template, project ID of the custom project template'),
  use_custom_template: flexibleBoolean
    .optional()
    .describe(
      'Use either custom instance or group (with group_with_project_templates_id) project template',
    ),
  group_with_project_templates_id: z
    .number()
    .optional()
    .describe('For group-level custom templates, specifies ID of group to use'),
  packages_enabled: flexibleBoolean
    .optional()
    .describe('Enable or disable packages repository feature'),
  service_desk_enabled: flexibleBoolean
    .optional()
    .describe('Enable or disable Service Desk feature'),
  compliance_frameworks: z
    .array(z.string())
    .optional()
    .describe('Compliance frameworks associated with the project'),
});

export const ForkRepositorySchema = z.object({
  project_id: z.coerce.string().describe('Project ID or URL-encoded path'),
  namespace: z
    .string()
    .optional()
    .describe('The ID or path of the namespace that the project will be forked to'),
  namespace_path: z
    .string()
    .optional()
    .describe('The path of the namespace that the project will be forked to'),
  name: z.string().optional().describe('The name of the forked project'),
  path: z.string().optional().describe('The path of the forked project'),
});

export const CreateBranchSchema = z.object({
  project_id: z.coerce.string().describe('Project ID or URL-encoded path'),
  branch: z.string().describe('Name of the branch'),
  ref: z.string().describe('Branch name or commit SHA to create branch from'),
});

// Export type definitions
export type CreateRepositoryOptions = z.infer<typeof CreateRepositorySchema>;
export type ForkRepositoryOptions = z.infer<typeof ForkRepositorySchema>;
export type CreateBranchOptions = z.infer<typeof CreateBranchSchema>;
