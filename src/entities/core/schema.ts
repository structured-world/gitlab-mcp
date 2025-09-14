import { z } from "zod";
import { flexibleBoolean } from "../utils.js";
import { ProjectParamsSchema } from "../shared.js";

// WRITE-ONLY OPERATION SCHEMAS

// Missing schemas for file operations
export const PushFilesSchema = ProjectParamsSchema.extend({
  branch: z.string().describe("Target branch name"),
  commit_message: z.string().describe("Commit message"),
  files: z
    .array(
      z.object({
        file_path: z.string(),
        content: z.string(),
        encoding: z.enum(["text", "base64"]).optional(),
        execute_filemode: flexibleBoolean.optional(),
      })
    )
    .describe("Array of files to push"),
  start_branch: z.string().optional().describe("Start branch name"),
  author_email: z.string().optional().describe("Author email"),
  author_name: z.string().optional().describe("Author name"),
});

// File operations (write)
export const CreateOrUpdateFileSchema = ProjectParamsSchema.extend({
  file_path: z.string().describe("URL-encoded full path to the file"),
  branch: z.string().describe("Name of the new branch to create"),
  start_branch: z.string().optional().describe("Name of the base branch to start from"),
  encoding: z.enum(["text", "base64"]).optional().describe("Change encoding"),
  author_email: z.string().optional().describe("Author email for the commit"),
  author_name: z.string().optional().describe("Author name for the commit"),
  content: z.string().describe("File content"),
  commit_message: z.string().describe("Commit message"),
  last_commit_id: z.string().optional().describe("Last known file commit id"),
  execute_filemode: flexibleBoolean.optional().describe("Execute file mode"),
});

// Repository operations (write)
export const CreateRepositorySchema = z.object({
  name: z.string().describe("The name of the new project"),
  path: z.string().optional().describe("Repository name for the new project"),
  namespace_id: z.coerce.string().optional().describe("Namespace ID for the new project"),
  description: z.string().optional().describe("Short project description"),
  issues_enabled: flexibleBoolean.optional().describe("Enable issues for this project"),
  merge_requests_enabled: flexibleBoolean
    .optional()
    .describe("Enable merge requests for this project"),
  jobs_enabled: flexibleBoolean.optional().describe("Enable jobs for this project"),
  wiki_enabled: flexibleBoolean.optional().describe("Enable wiki for this project"),
  snippets_enabled: flexibleBoolean.optional().describe("Enable snippets for this project"),
  resolve_outdated_diff_discussions: flexibleBoolean
    .optional()
    .describe("Automatically resolve merge request diffs discussions on lines changed with a push"),
  container_registry_enabled: flexibleBoolean
    .optional()
    .describe("Enable container registry for this project"),
  container_registry_access_level: z
    .enum(["disabled", "private", "enabled"])
    .optional()
    .describe("Set the container registry access level"),
  shared_runners_enabled: flexibleBoolean
    .optional()
    .describe("Enable shared runners for this project"),
  visibility: z
    .enum(["private", "internal", "public"])
    .optional()
    .describe("Project visibility level"),
  import_url: z.string().optional().describe("URL to import repository from"),
  public_jobs: flexibleBoolean
    .optional()
    .describe("If true, jobs can be viewed by non-project members"),
  only_allow_merge_if_pipeline_succeeds: flexibleBoolean
    .optional()
    .describe("Set whether merge requests can only be merged with successful jobs"),
  allow_merge_on_skipped_pipeline: flexibleBoolean
    .optional()
    .describe("Set whether or not merges can be requested with skipped jobs"),
  only_allow_merge_if_all_discussions_are_resolved: flexibleBoolean
    .optional()
    .describe(
      "Set whether merge requests can only be merged when all the discussions are resolved"
    ),
  merge_method: z
    .enum(["merge", "rebase_merge", "ff"])
    .optional()
    .describe("Set the merge method used"),
  remove_source_branch_after_merge: flexibleBoolean
    .optional()
    .describe("Enable Delete source branch option by default for all new merge requests"),
  lfs_enabled: flexibleBoolean.optional().describe("Enable LFS"),
  request_access_enabled: flexibleBoolean
    .optional()
    .describe("Allow users to request member access"),
  tag_list: z
    .array(z.string())
    .optional()
    .describe(
      "The list of tags for the project; put array of tags, that should be finally assigned to a project"
    ),
  avatar: z.string().optional().describe("Image file for avatar of the project"),
  printing_merge_request_link_enabled: flexibleBoolean
    .optional()
    .describe("Show link to create/view merge request when pushing from the command line"),
  build_git_strategy: z
    .enum(["fetch", "clone"])
    .optional()
    .describe("The Git strategy. Defaults to fetch"),
  build_timeout: z
    .number()
    .optional()
    .describe("The maximum amount of time, in seconds, that a job can run"),
  auto_cancel_pending_pipelines: z
    .enum(["disabled", "enabled"])
    .optional()
    .describe("Auto-cancel pending pipelines"),
  build_coverage_regex: z.string().optional().describe("Test coverage parsing"),
  ci_config_path: z.string().optional().describe("The path to CI config file"),
  auto_devops_enabled: flexibleBoolean.optional().describe("Enable Auto DevOps for this project"),
  auto_devops_deploy_strategy: z
    .enum(["continuous", "manual", "timed_incremental"])
    .optional()
    .describe("Auto Deploy strategy"),
  autoclose_referenced_issues: flexibleBoolean
    .optional()
    .describe("Set whether auto-closing referenced issues on default branch"),
  suggestion_commit_message: z
    .string()
    .optional()
    .describe("The commit message used to apply merge request suggestions"),
  squash_option: z
    .enum(["never", "always", "default_on", "default_off"])
    .optional()
    .describe("Squash commits when merging"),
});

// Issue operations (write)
export const CreateIssueSchema = ProjectParamsSchema.extend({
  title: z.string().describe("Issue title"),
  description: z.string().optional().describe("Issue description"),
  confidential: flexibleBoolean.optional().describe("Set to private issue"),
  assignee_ids: z.array(z.number()).optional().describe("Array of user IDs to assign issue"),
  assignee_id: z
    .number()
    .optional()
    .describe("User ID to assign issue (deprecated, use assignee_ids)"),
  milestone_id: z.number().optional().describe("Milestone ID to assign issue"),
  labels: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .describe("Labels for the issue"),
  created_at: z.string().optional().describe("Date time string, ISO 8601 formatted"),
  due_date: z.string().optional().describe("Date string in the format YYYY-MM-DD"),
  merge_request_to_resolve_discussions_of: z.coerce
    .string()
    .optional()
    .describe("IID of a merge request in which to resolve all issues"),
  discussion_to_resolve: z.string().optional().describe("ID of a discussion to resolve"),
  weight: z.number().optional().describe("The weight of the issue"),
  epic_id: z.number().optional().describe("ID of the epic to add the issue to"),
  epic_iid: z.number().optional().describe("IID of the epic to add the issue to"),
  issue_type: z
    .enum(["issue", "incident", "test_case", "task"])
    .optional()
    .describe("The type of issue"),
});

export const UpdateIssueSchema = z.object({
  project_id: z.coerce.string().describe("Project ID or URL-encoded path"),
  issue_iid: z.coerce.string().describe("The internal ID of the project issue"),
  title: z.string().optional().describe("The title of an issue"),
  description: z.string().optional().describe("The description of an issue"),
  confidential: flexibleBoolean.optional().describe("Updates an issue to be confidential"),
  assignee_ids: z.array(z.number()).optional().describe("Array of user IDs to assign issue"),
  assignee_id: z.number().optional().describe("User ID to assign issue"),
  milestone_id: z.number().optional().describe("Milestone ID to assign issue"),
  labels: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .describe("Labels for the issue"),
  add_labels: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .describe("Labels to add to the issue"),
  remove_labels: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .describe("Labels to remove from the issue"),
  state_event: z.enum(["close", "reopen"]).optional().describe("The state event of an issue"),
  updated_at: z.string().optional().describe("Date time string, ISO 8601 formatted"),
  due_date: z.string().optional().describe("Date string in the format YYYY-MM-DD"),
  weight: z.number().optional().describe("The weight of the issue"),
  discussion_locked: flexibleBoolean
    .optional()
    .describe("Flag indicating if the issue's discussion is locked"),
  epic_id: z.number().optional().describe("ID of the epic to add the issue to"),
  epic_iid: z.number().optional().describe("IID of the epic to add the issue to"),
  issue_type: z
    .enum(["issue", "incident", "test_case", "task"])
    .optional()
    .describe("Updates the type of issue"),
});

export const DeleteIssueSchema = z.object({
  project_id: z.coerce.string().describe("Project ID or URL-encoded path"),
  issue_iid: z.coerce.string().describe("The internal ID of the project issue"),
});

// Issue link operations (write)
export const CreateIssueLinkSchema = z.object({
  project_id: z.coerce.string().describe("Project ID or URL-encoded path"),
  issue_iid: z.coerce.string().describe("The internal ID of the project issue"),
  target_project_id: z.coerce.string().describe("Project ID or URL-encoded path"),
  target_issue_iid: z.coerce.string().describe("The internal ID of the target project issue"),
  link_type: z
    .enum(["relates_to", "blocks", "is_blocked_by"])
    .optional()
    .describe("The type of the relation"),
});

export const DeleteIssueLinkSchema = z.object({
  project_id: z.coerce.string().describe("Project ID or URL-encoded path"),
  issue_iid: z.coerce.string().describe("The internal ID of the project issue"),
  issue_link_id: z.coerce.string().describe("The ID of the issue link"),
});

// Branch operations (write)
export const CreateBranchSchema = ProjectParamsSchema.extend({
  branch: z.string().describe("Name of the branch"),
  ref: z.string().describe("Branch name or commit SHA to create branch from"),
});

// Merge request operations (write)
const MergeRequestOptionsSchema = {
  source_branch: z.string().describe("Source branch"),
  target_branch: z.string().describe("Target branch"),
  title: z.string().describe("Title of MR"),
  assignee_id: z.number().optional().describe("Assignee user ID"),
  assignee_ids: z.array(z.number()).optional().describe("Array of assignee user IDs"),
  reviewer_ids: z.array(z.number()).optional().describe("Array of reviewer user IDs"),
  description: z.string().optional().describe("Description of MR"),
  target_project_id: z.coerce.string().optional().describe("Target project ID"),
  labels: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .describe("Labels for MR"),
  milestone_id: z.number().optional().describe("Milestone ID"),
  remove_source_branch: flexibleBoolean
    .optional()
    .describe("Remove source branch when MR is merged"),
  allow_collaboration: flexibleBoolean
    .optional()
    .describe("Allow commits from members who can merge to the target branch"),
  allow_maintainer_to_push: flexibleBoolean
    .optional()
    .describe("Allow maintainer to push to the source branch"),
  squash: flexibleBoolean.optional().describe("Squash commits into a single commit when merging"),
};

export const CreateMergeRequestOptionsSchema = z.object(MergeRequestOptionsSchema);
export const CreateMergeRequestSchema = ProjectParamsSchema.extend(MergeRequestOptionsSchema);

export const UpdateMergeRequestSchema = z.object({
  project_id: z.coerce.string().describe("Project ID or URL-encoded path"),
  merge_request_iid: z.coerce.string().describe("The internal ID of the merge request"),
  target_branch: z.string().optional().describe("Target branch"),
  title: z.string().optional().describe("Title of MR"),
  assignee_id: z.number().optional().describe("Assignee user ID"),
  assignee_ids: z.array(z.number()).optional().describe("Array of assignee user IDs"),
  reviewer_ids: z.array(z.number()).optional().describe("Array of reviewer user IDs"),
  description: z.string().optional().describe("Description of MR"),
  labels: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .describe("Labels for MR"),
  add_labels: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .describe("Labels to add to MR"),
  remove_labels: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .describe("Labels to remove from MR"),
  milestone_id: z.number().optional().describe("Milestone ID"),
  state_event: z
    .enum(["close", "reopen", "merge"])
    .optional()
    .describe("New state (close/reopen/merge)"),
  remove_source_branch: flexibleBoolean
    .optional()
    .describe("Remove source branch when MR is merged"),
  squash: flexibleBoolean.optional().describe("Squash commits into a single commit when merging"),
  discussion_locked: flexibleBoolean
    .optional()
    .describe("Flag indicating if the merge request discussion is locked"),
  allow_collaboration: flexibleBoolean
    .optional()
    .describe("Allow commits from members who can merge to the target branch"),
  allow_maintainer_to_push: flexibleBoolean
    .optional()
    .describe("Allow maintainer to push to the source branch"),
});

// Note operations (write)
export const CreateNoteSchema = z.object({
  id: z.coerce.string().describe("The ID of a project"),
  issue_iid: z.coerce.string().optional().describe("The internal ID of the issue"),
  merge_request_iid: z.coerce.string().optional().describe("The internal ID of the merge request"),
  body: z.string().describe("The content of a note"),
  created_at: z.string().optional().describe("Date time string, ISO 8601 formatted"),
  confidential: flexibleBoolean.optional().describe("Confidential note flag"),
});

// Merge request thread position schema - used for diff notes
export const MergeRequestThreadPositionCreateSchema = z.object({
  base_sha: z.string().describe("Base commit SHA in the source branch").optional(),
  start_sha: z.string().describe("SHA referencing commit in target branch").optional(),
  head_sha: z.string().describe("SHA referencing HEAD of this merge request").optional(),
  position_type: z.enum(["text", "image"]).optional().describe("Type of the position reference"),
  old_path: z.string().optional().describe("Old path of the file"),
  new_path: z.string().optional().describe("New path of the file"),
  old_line: z.number().optional().describe("Old line number"),
  new_line: z.number().optional().describe("New line number"),
  line_range: z
    .object({
      start: z.object({
        line_code: z.string(),
        type: z.enum(["new", "old"]).optional(),
        old_line: z.number().optional(),
        new_line: z.number().optional(),
      }),
      end: z.object({
        line_code: z.string(),
        type: z.enum(["new", "old"]).optional(),
        old_line: z.number().optional(),
        new_line: z.number().optional(),
      }),
    })
    .optional()
    .describe("Line range for a multi-line comment"),
  width: z.number().optional().describe("Width of the image (for image type)"),
  height: z.number().optional().describe("Height of the image (for image type)"),
  x: z.number().optional().describe("X coordinate (for image type)"),
  y: z.number().optional().describe("Y coordinate (for image type)"),
});

// Merge request thread operations (write)
export const CreateMergeRequestThreadSchema = ProjectParamsSchema.extend({
  merge_request_iid: z.coerce.string().describe("The internal ID of the merge request"),
  body: z.string().describe("The content of the thread"),
  position: MergeRequestThreadPositionCreateSchema.optional().describe(
    "Position when creating a diff note"
  ),
  commit_id: z.string().optional().describe("SHA referencing commit to start discussion on"),
});

// Merge request note operations (write)
export const UpdateMergeRequestNoteSchema = ProjectParamsSchema.extend({
  merge_request_iid: z.coerce.string().describe("The internal ID of the merge request"),
  note_id: z.coerce.string().describe("The ID of the note"),
  body: z.string().describe("The content of a note"),
});

export const CreateMergeRequestNoteSchema = ProjectParamsSchema.extend({
  merge_request_iid: z.coerce.string().describe("The internal ID of the merge request"),
  body: z.string().describe("The content of a note"),
  created_at: z.string().optional().describe("Date time string, ISO 8601 formatted"),
});

// Draft note operations (write)
export const CreateDraftNoteSchema = ProjectParamsSchema.extend({
  merge_request_iid: z.coerce.string().describe("The internal ID of the merge request"),
  note: z.string().describe("The content of a note"),
  position: MergeRequestThreadPositionCreateSchema.optional().describe(
    "Position when creating a diff note"
  ),
  in_reply_to_discussion_id: z.string().optional().describe("The ID of a discussion to reply to"),
  commit_id: z.string().optional().describe("SHA referencing commit to start discussion on"),
});

export const UpdateDraftNoteSchema = ProjectParamsSchema.extend({
  merge_request_iid: z.coerce.string().describe("The internal ID of the merge request"),
  draft_note_id: z.coerce.string().describe("The ID of the draft note"),
  note: z.string().describe("The content of a note"),
  position: MergeRequestThreadPositionCreateSchema.optional().describe(
    "Position when creating a diff note"
  ),
});

export const DeleteDraftNoteSchema = ProjectParamsSchema.extend({
  merge_request_iid: z.coerce.string().describe("The internal ID of the merge request"),
  draft_note_id: z.coerce.string().describe("The ID of the draft note"),
});

// Issue note operations (write)
export const UpdateIssueNoteSchema = ProjectParamsSchema.extend({
  issue_iid: z.coerce.string().describe("The internal ID of the issue"),
  note_id: z.coerce.string().describe("The ID of the note"),
  body: z.string().describe("The content of a note"),
});

export const CreateIssueNoteSchema = ProjectParamsSchema.extend({
  issue_iid: z.coerce.string().describe("The internal ID of the issue"),
  body: z.string().describe("The content of a note"),
  created_at: z.string().optional().describe("Date time string, ISO 8601 formatted"),
});

// Label operations (write)
export const CreateLabelSchema = z.object({
  project_id: z.coerce.string().describe("Project ID or URL-encoded path"),
  name: z.string().describe("The name of the label"),
  color: z
    .string()
    .describe(
      "The color of the label given in 6-digit hex notation with leading '#' sign (e.g. #FFAABB) or one of the CSS color names"
    ),
  description: z.string().optional().describe("The description of the label"),
  priority: z
    .number()
    .optional()
    .describe(
      "The priority of the label. Must be greater or equal than zero or null to remove the priority"
    ),
});

export const UpdateLabelSchema = z.object({
  project_id: z.coerce.string().describe("Project ID or URL-encoded path"),
  label_id: z.union([z.coerce.string(), z.string()]).describe("The ID or title of a group label"),
  new_name: z.string().optional().describe("The new name of the label"),
  color: z
    .string()
    .optional()
    .describe(
      "The color of the label given in 6-digit hex notation with leading '#' sign (e.g. #FFAABB) or one of the CSS color names"
    ),
  description: z.string().optional().describe("The description of the label"),
  priority: z
    .number()
    .optional()
    .describe(
      "The priority of the label. Must be greater or equal than zero or null to remove the priority"
    ),
});

export const DeleteLabelSchema = z.object({
  project_id: z.coerce.string().describe("Project ID or URL-encoded path"),
  label_id: z.union([z.coerce.string(), z.string()]).describe("The ID or title of a group label"),
});

// Repository operations (write)
export const ForkRepositorySchema = z.object({
  project_id: z.coerce.string().describe("Project ID or URL-encoded path"),
  namespace: z
    .string()
    .optional()
    .describe("The ID or path of the namespace to fork the project to"),
  namespace_id: z.number().optional().describe("The ID of the namespace to fork the project to"),
  namespace_path: z
    .string()
    .optional()
    .describe("The path of the namespace to fork the project to"),
  name: z.string().optional().describe("The name of the forked project"),
  path: z.string().optional().describe("The path of the forked project"),
});

// Merge operations (write)
export const MergeMergeRequestSchema = z.object({
  project_id: z.coerce.string().describe("Project ID or URL-encoded path"),
  merge_request_iid: z.coerce.string().describe("The internal ID of the merge request"),
  merge_commit_message: z.string().optional().describe("Custom merge commit message"),
  squash_commit_message: z.string().optional().describe("Custom squash commit message"),
  should_remove_source_branch: flexibleBoolean
    .optional()
    .describe("Remove source branch after merge"),
  merge_when_pipeline_succeeds: flexibleBoolean.optional().describe("Merge when pipeline succeeds"),
  sha: z.string().optional().describe("SHA of the head commit"),
  squash: flexibleBoolean.optional().describe("Squash commits when merging"),
});

// Draft note publishing operations (write)
export const PublishDraftNoteSchema = ProjectParamsSchema.extend({
  merge_request_iid: z.coerce.string().describe("The internal ID of the merge request"),
  draft_note_id: z.coerce.string().describe("The ID of the draft note"),
});

export const BulkPublishDraftNotesSchema = ProjectParamsSchema.extend({
  merge_request_iid: z.coerce.string().describe("The internal ID of the merge request"),
});

// File upload operations (write)
export const MarkdownUploadSchema = ProjectParamsSchema.extend({
  file: z.string().describe("Base64 encoded file content or file path"),
  filename: z.string().describe("Name of the file"),
});

// Type exports
export type CreateOrUpdateFileOptions = z.infer<typeof CreateOrUpdateFileSchema>;
export type CreateRepositoryOptions = z.infer<typeof CreateRepositorySchema>;
export type CreateIssueOptions = z.infer<typeof CreateIssueSchema>;
export type UpdateIssueOptions = z.infer<typeof UpdateIssueSchema>;
export type DeleteIssueOptions = z.infer<typeof DeleteIssueSchema>;
export type CreateIssueLinkOptions = z.infer<typeof CreateIssueLinkSchema>;
export type DeleteIssueLinkOptions = z.infer<typeof DeleteIssueLinkSchema>;
export type CreateBranchOptions = z.infer<typeof CreateBranchSchema>;
export type CreateMergeRequestOptions = z.infer<typeof CreateMergeRequestSchema>;
export type UpdateMergeRequestOptions = z.infer<typeof UpdateMergeRequestSchema>;
export type CreateNoteOptions = z.infer<typeof CreateNoteSchema>;
export type MergeRequestThreadPositionCreate = z.infer<
  typeof MergeRequestThreadPositionCreateSchema
>;
export type CreateMergeRequestThreadOptions = z.infer<typeof CreateMergeRequestThreadSchema>;
export type UpdateMergeRequestNoteOptions = z.infer<typeof UpdateMergeRequestNoteSchema>;
export type CreateMergeRequestNoteOptions = z.infer<typeof CreateMergeRequestNoteSchema>;
export type CreateDraftNoteOptions = z.infer<typeof CreateDraftNoteSchema>;
export type UpdateDraftNoteOptions = z.infer<typeof UpdateDraftNoteSchema>;
export type DeleteDraftNoteOptions = z.infer<typeof DeleteDraftNoteSchema>;
export type UpdateIssueNoteOptions = z.infer<typeof UpdateIssueNoteSchema>;
export type CreateIssueNoteOptions = z.infer<typeof CreateIssueNoteSchema>;
export type CreateLabelOptions = z.infer<typeof CreateLabelSchema>;
export type UpdateLabelOptions = z.infer<typeof UpdateLabelSchema>;
export type DeleteLabelOptions = z.infer<typeof DeleteLabelSchema>;
