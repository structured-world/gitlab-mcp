/* eslint-disable no-unused-vars */
/**
 * Handler dispatcher that maps tool names to their actual implementation functions
 */

// Import all handler modules
import {
  handleListProjects,
  handleSearchRepositories,
  handleListNamespaces,
  handleGetUsers,
  handleGetProject,
  handleGetFileContents,
  handleGetMergeRequest,
  handleListMergeRequests,
  handleListLabels,
  handleGetLabel,
  handleGetNamespace,
  handleVerifyNamespace,
  handleListProjectMembers,
  handleGetRepositoryTree,
  handleListCommits,
  handleGetCommit,
  handleGetMergeRequestDiffs,
  handleListMergeRequestDiffs,
  handleGetBranchDiffs,
  handleMrDiscussions,
  handleGetDraftNote,
  handleListDraftNotes,
  handleListGroupProjects,
  handleGetCommitDiff,
  handleListEvents,
  handleGetProjectEvents,
  handleListGroupIterations,
  handleDownloadAttachment,
  handleMergeMergeRequest,
  handleCreateOrUpdateFile,
  handleCreateRepository,
  handlePushFiles,
  handleCreateMergeRequest,
  handleForkRepository,
  handleCreateBranch,
  handleUpdateMergeRequest,
  handleCreateNote,
  handleCreateMergeRequestThread,
  handleUpdateMergeRequestNote,
  handleCreateMergeRequestNote,
  handleCreateDraftNote,
  handleUpdateDraftNote,
  handleDeleteDraftNote,
  handlePublishDraftNote,
  handleBulkPublishDraftNotes,
  handleCreateLabel,
  handleUpdateLabel,
  handleDeleteLabel,
  handleUploadMarkdown,
} from './core/handlers';

import {
  handleListWorkItems,
  handleGetWorkItem,
  handleGetWorkItemTypes,
  handleCreateWorkItem,
  handleUpdateWorkItem,
  handleDeleteWorkItem,
} from './workitems/handlers';

import {
  handleListWikiPages,
  handleGetWikiPage,
  handleCreateWikiPage,
  handleUpdateWikiPage,
  handleDeleteWikiPage,
} from './wiki/handlers';

import {
  handleListMilestones,
  handleGetMilestone,
  handleGetMilestoneIssue,
  handleGetMilestoneMergeRequests,
  handleGetMilestoneBurndownEvents,
  handleCreateMilestone,
  handleEditMilestone,
  handleDeleteMilestone,
  handlePromoteMilestone,
} from './milestones/handlers';

import {
  handleListPipelines,
  handleGetPipeline,
  handleListPipelineJobs,
  handleListPipelineTriggerJobs,
  handleGetPipelineJob,
  handleGetPipelineJobOutput,
  handleCreatePipeline,
  handleRetryPipeline,
  handleCancelPipeline,
  handlePlayPipelineJob,
  handleRetryPipelineJob,
  handleCancelPipelineJob,
} from './pipelines/handlers';

// Define handler mapping type
type HandlerFunction = (args: unknown) => Promise<unknown>;

// Create mapping of tool names to handler functions
const handlerMap: Record<string, HandlerFunction> = {
  // Core read-only handlers
  list_projects: handleListProjects,
  search_repositories: handleSearchRepositories,
  list_namespaces: handleListNamespaces,
  get_users: handleGetUsers,
  get_project: handleGetProject,
  get_file_contents: handleGetFileContents,
  get_merge_request: handleGetMergeRequest,
  list_merge_requests: handleListMergeRequests,
  list_labels: handleListLabels,
  get_label: handleGetLabel,
  get_namespace: handleGetNamespace,
  verify_namespace: handleVerifyNamespace,
  list_project_members: handleListProjectMembers,
  get_repository_tree: handleGetRepositoryTree,
  list_commits: handleListCommits,
  get_commit: handleGetCommit,
  get_merge_request_diffs: handleGetMergeRequestDiffs,
  list_merge_request_diffs: handleListMergeRequestDiffs,
  get_branch_diffs: handleGetBranchDiffs,
  mr_discussions: handleMrDiscussions,
  get_draft_note: handleGetDraftNote,
  list_draft_notes: handleListDraftNotes,
  list_group_projects: handleListGroupProjects,
  get_commit_diff: handleGetCommitDiff,
  list_events: handleListEvents,
  get_project_events: handleGetProjectEvents,
  list_group_iterations: handleListGroupIterations,
  download_attachment: handleDownloadAttachment,

  // Work items handlers (GraphQL)
  list_work_items: handleListWorkItems,
  get_work_item: handleGetWorkItem,
  get_work_item_types: handleGetWorkItemTypes,
  create_work_item: handleCreateWorkItem,
  update_work_item: handleUpdateWorkItem,
  delete_work_item: handleDeleteWorkItem,

  // Wiki handlers
  list_wiki_pages: handleListWikiPages,
  get_wiki_page: handleGetWikiPage,
  create_wiki_page: handleCreateWikiPage,
  update_wiki_page: handleUpdateWikiPage,
  delete_wiki_page: handleDeleteWikiPage,

  // Milestone handlers
  list_milestones: handleListMilestones,
  get_milestone: handleGetMilestone,
  get_milestone_issue: handleGetMilestoneIssue,
  get_milestone_merge_requests: handleGetMilestoneMergeRequests,
  get_milestone_burndown_events: handleGetMilestoneBurndownEvents,
  create_milestone: handleCreateMilestone,
  edit_milestone: handleEditMilestone,
  delete_milestone: handleDeleteMilestone,
  promote_milestone: handlePromoteMilestone,

  // Pipeline handlers
  list_pipelines: handleListPipelines,
  get_pipeline: handleGetPipeline,
  list_pipeline_jobs: handleListPipelineJobs,
  list_pipeline_trigger_jobs: handleListPipelineTriggerJobs,
  get_pipeline_job: handleGetPipelineJob,
  get_pipeline_job_output: handleGetPipelineJobOutput,
  create_pipeline: handleCreatePipeline,
  retry_pipeline: handleRetryPipeline,
  cancel_pipeline: handleCancelPipeline,
  play_pipeline_job: handlePlayPipelineJob,
  retry_pipeline_job: handleRetryPipelineJob,
  cancel_pipeline_job: handleCancelPipelineJob,

  // Core write handlers
  merge_merge_request: handleMergeMergeRequest,
  create_or_update_file: handleCreateOrUpdateFile,
  create_repository: handleCreateRepository,
  push_files: handlePushFiles,
  create_merge_request: handleCreateMergeRequest,
  fork_repository: handleForkRepository,
  create_branch: handleCreateBranch,
  update_merge_request: handleUpdateMergeRequest,
  create_note: handleCreateNote,
  create_merge_request_thread: handleCreateMergeRequestThread,
  update_merge_request_note: handleUpdateMergeRequestNote,
  create_merge_request_note: handleCreateMergeRequestNote,
  create_draft_note: handleCreateDraftNote,
  update_draft_note: handleUpdateDraftNote,
  delete_draft_note: handleDeleteDraftNote,
  publish_draft_note: handlePublishDraftNote,
  bulk_publish_draft_notes: handleBulkPublishDraftNotes,
  create_label: handleCreateLabel,
  update_label: handleUpdateLabel,
  delete_label: handleDeleteLabel,
  upload_markdown: handleUploadMarkdown,

  // TODO: Add more handlers as they are implemented
};

/**
 * Get the handler function for a given tool name
 */
export async function getHandlerForTool(toolName: string): Promise<HandlerFunction | null> {
  const handler = handlerMap[toolName];

  if (handler) {
    console.log(`Found handler for tool: ${toolName}`);
    return handler;
  }

  console.log(`No handler found for tool: ${toolName}`);
  return null;
}

/**
 * Get list of all available handlers
 */
export function getAvailableHandlers(): string[] {
  return Object.keys(handlerMap);
}
