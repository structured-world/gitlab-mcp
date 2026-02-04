import * as z from "zod";
import picomatch from "picomatch";
import {
  BrowseMergeRequestsSchema,
  BrowseMrDiscussionsSchema,
  LOCKFILE_PATTERNS,
  GENERATED_PATTERNS,
} from "./schema-readonly";
import {
  ManageMergeRequestSchema,
  ManageMrDiscussionSchema,
  ManageDraftNotesSchema,
} from "./schema";
import { gitlab, toQuery } from "../../utils/gitlab-api";
import { normalizeProjectId } from "../../utils/projectIdentifier";
import { ToolRegistry, EnhancedToolDefinition } from "../../types";
import { isActionDenied } from "../../config";

/**
 * Response shape for MR status check before merge.
 * Contains fields needed to determine mergeability.
 */
interface MergeRequestStatusResponse {
  detailed_merge_status: string;
  merge_status: string;
  has_conflicts: boolean;
  blocking_discussions_resolved: boolean;
  state: string;
  draft: boolean;
}

/**
 * Structured response when MR cannot be merged.
 * Provides actionable information for AI agents.
 */
export interface MergeBlockedResponse {
  error: true;
  message: string;
  detailed_merge_status: string;
  merge_status: string;
  has_conflicts: boolean;
  blocking_discussions_resolved: boolean;
  hint: string;
  is_retryable: boolean;
  can_auto_merge: boolean;
  suggested_action: string;
}

/**
 * Statuses that are transient and may resolve on their own.
 * Agent should wait and retry for these statuses.
 */
export const RETRYABLE_MERGE_STATUSES = [
  "checking",
  "unchecked",
  "ci_still_running",
  "ci_must_pass",
  "approvals_syncing",
] as const;

/**
 * Statuses where auto-merge (merge_when_pipeline_succeeds) is applicable.
 * Agent can suggest using auto-merge for these statuses.
 */
export const AUTO_MERGE_ELIGIBLE_STATUSES = ["ci_still_running", "ci_must_pass"] as const;

/**
 * Returns actionable hint for a given merge status.
 * Helps agents understand why merge failed and what action to take.
 *
 * @see https://docs.gitlab.com/ee/api/merge_requests.html#merge-status
 * @see https://gitlab.com/gitlab-org/gitlab/-/issues/364102
 */
export function getMergeStatusHint(status: string): string {
  const hints: Record<string, string> = {
    // Async check in progress - agent should wait and retry
    checking: "Wait a moment and retry - GitLab is calculating mergeability",
    unchecked: "Wait a moment and retry - GitLab has not checked mergeability yet",

    // CI/Pipeline related - suggest auto-merge
    ci_must_pass:
      "Pipeline must pass. Use merge_when_pipeline_succeeds: true for auto-merge, or wait for pipeline",
    ci_still_running:
      "Pipeline is running. Use merge_when_pipeline_succeeds: true for auto-merge, or wait for completion",

    // Approval related
    not_approved: "MR requires approval before merging",
    approvals_syncing: "Approvals are being synchronized - wait and retry",

    // Conflict related
    conflict: "Resolve merge conflicts before merging",
    need_rebase: "Rebase the source branch before merging",

    // Status related
    draft_status:
      "Remove draft status before merging by updating the title to remove any 'Draft:' or 'WIP:' prefix",
    discussions_not_resolved: "Resolve all blocking discussions before merging",
    blocked_status: "MR is blocked by another MR or issue",

    // External checks
    external_status_checks: "External status checks are pending",
    jira_association_missing: "Jira issue association is required",

    // Other statuses
    not_open: "MR is not in open state - cannot merge closed or already merged MRs",
    mergeable: "MR is ready to merge",
  };

  return hints[status] || `Check MR detailed status: ${status}`;
}

/**
 * Build suggested action message based on merge status.
 */
export function getSuggestedAction(isRetryable: boolean, canAutoMerge: boolean): string {
  if (canAutoMerge) {
    return "Consider using merge_when_pipeline_succeeds: true to auto-merge when pipeline passes";
  }
  if (isRetryable) {
    return "Wait a moment and retry the merge";
  }
  return "Resolve the blocking condition before merging";
}

/**
 * Flattens a position object into form-encoded fields with bracket notation.
 * GitLab API expects: position[base_sha]=xxx, position[head_sha]=xxx, etc.
 * NOT: position={"base_sha":"xxx","head_sha":"xxx"}
 *
 * @see https://docs.gitlab.com/ee/api/discussions.html#create-a-new-thread-in-the-merge-request-diff
 */
export function flattenPositionToFormFields(
  body: Record<string, unknown>,
  position: Record<string, unknown>
): void {
  for (const [key, value] of Object.entries(position)) {
    if (value === undefined || value === null) continue;

    if (typeof value === "object" && !Array.isArray(value)) {
      // Handle nested objects like line_range.start, line_range.end
      for (const [nestedKey, nestedValue] of Object.entries(value as Record<string, unknown>)) {
        if (nestedValue === undefined || nestedValue === null) continue;

        if (typeof nestedValue === "object" && !Array.isArray(nestedValue)) {
          // Handle deeply nested (line_range.start.line_code, etc.)
          for (const [deepKey, deepValue] of Object.entries(
            nestedValue as Record<string, unknown>
          )) {
            if (deepValue !== undefined && deepValue !== null) {
              body[`position[${key}][${nestedKey}][${deepKey}]`] = deepValue;
            }
          }
        } else {
          body[`position[${key}][${nestedKey}]`] = nestedValue;
        }
      }
    } else {
      body[`position[${key}]`] = value;
    }
  }
}

/**
 * MRS (Merge Requests) tools registry - 5 CQRS tools replacing 20 individual tools
 *
 * browse_merge_requests (Query): list, get, diffs, compare
 * browse_mr_discussions (Query): list, drafts, draft
 * manage_merge_request (Command): create, update, merge
 * manage_mr_discussion (Command): comment, thread, reply, update, apply_suggestion, apply_suggestions
 * manage_draft_notes (Command): create, update, publish, publish_all, delete
 */
export const mrsToolRegistry: ToolRegistry = new Map<string, EnhancedToolDefinition>([
  // ============================================================================
  // browse_merge_requests - CQRS Query Tool (discriminated union schema)
  // TypeScript automatically narrows types in each switch case
  // ============================================================================
  [
    "browse_merge_requests",
    {
      name: "browse_merge_requests",
      description:
        "Find and inspect merge requests. Actions: list (filter by state/author/reviewer/labels/branch), get (MR details by IID or source branch), diffs (file-level changes with inline suggestions), compare (diff between any two refs). Related: manage_merge_request to create/update/merge.",
      inputSchema: z.toJSONSchema(BrowseMergeRequestsSchema),
      gate: { envVar: "USE_MRS", defaultValue: true },
      handler: async (args: unknown) => {
        const input = BrowseMergeRequestsSchema.parse(args);

        // Runtime validation: reject denied actions even if they bypass schema filtering
        if (isActionDenied("browse_merge_requests", input.action)) {
          throw new Error(`Action '${input.action}' is not allowed for browse_merge_requests tool`);
        }

        switch (input.action) {
          case "list": {
            // TypeScript knows: input has state, order_by, sort, milestone, etc. (all optional)
            const { action: _action, project_id, ...rest } = input;
            const query = toQuery(rest, []);

            const path = project_id
              ? `projects/${normalizeProjectId(project_id)}/merge_requests`
              : `merge_requests`;

            return gitlab.get(path, { query });
          }

          case "get": {
            // TypeScript knows: input has project_id (required), merge_request_iid (optional), branch_name (optional)
            const { project_id, merge_request_iid, branch_name } = input;

            // Build query params for optional fields
            const query: Record<string, boolean | string | undefined> = {};
            if (input.include_diverged_commits_count !== undefined)
              query.include_diverged_commits_count = input.include_diverged_commits_count;
            if (input.include_rebase_in_progress !== undefined)
              query.include_rebase_in_progress = input.include_rebase_in_progress;

            if (merge_request_iid) {
              return gitlab.get(
                `projects/${normalizeProjectId(project_id)}/merge_requests/${merge_request_iid}`,
                Object.keys(query).length > 0 ? { query } : undefined
              );
            } else if (branch_name) {
              const result = await gitlab.get<unknown[]>(
                `projects/${normalizeProjectId(project_id)}/merge_requests`,
                { query: { source_branch: branch_name, ...query } }
              );

              if (Array.isArray(result) && result.length > 0) {
                return result[0];
              }
              throw new Error("No merge request found for branch");
            }
            /* istanbul ignore next -- unreachable: schema validation ensures merge_request_iid or branch_name */
            throw new Error("Either merge_request_iid or branch_name must be provided");
          }

          case "diffs": {
            // TypeScript knows: input has project_id (required), merge_request_iid (required)
            const {
              project_id,
              merge_request_iid,
              exclude_patterns,
              exclude_lockfiles,
              exclude_generated,
            } = input;

            const query: Record<string, number | boolean | undefined> = {};
            if (input.page !== undefined) query.page = input.page;
            if (input.per_page !== undefined) query.per_page = input.per_page;
            if (input.include_diverged_commits_count !== undefined)
              query.include_diverged_commits_count = input.include_diverged_commits_count;
            if (input.include_rebase_in_progress !== undefined)
              query.include_rebase_in_progress = input.include_rebase_in_progress;

            const response = await gitlab.get<{
              changes?: Array<{ new_path: string; old_path: string }>;
              [key: string]: unknown;
            }>(
              `projects/${normalizeProjectId(project_id)}/merge_requests/${merge_request_iid}/changes`,
              { query }
            );

            // Build exclusion patterns list
            const patterns: string[] = [];
            if (exclude_patterns?.length) {
              patterns.push(...exclude_patterns);
            }
            if (exclude_lockfiles) {
              patterns.push(...LOCKFILE_PATTERNS);
            }
            if (exclude_generated) {
              patterns.push(...GENERATED_PATTERNS);
            }

            // Apply filtering if patterns specified and changes array exists
            if (patterns.length > 0 && Array.isArray(response.changes)) {
              const originalCount = response.changes.length;
              const matcher = picomatch(patterns);

              response.changes = response.changes.filter(
                (diff: { new_path: string; old_path: string }) =>
                  !matcher(diff.new_path) && !matcher(diff.old_path)
              );

              // Add metadata about filtering
              (response as Record<string, unknown>)._filtered = {
                original_count: originalCount,
                filtered_count: response.changes.length,
                excluded_count: originalCount - response.changes.length,
                patterns_applied: patterns,
              };
            }

            return response;
          }

          case "compare": {
            // TypeScript knows: input has project_id (required), from (required), to (required)
            const { project_id, from, to, straight } = input;

            const query: Record<string, string | boolean | undefined> = {
              from,
              to,
            };
            if (straight !== undefined) query.straight = straight;

            return gitlab.get(`projects/${normalizeProjectId(project_id)}/repository/compare`, {
              query,
            });
          }

          /* istanbul ignore next -- unreachable with Zod discriminatedUnion */
          default:
            throw new Error(`Unknown action: ${(input as { action: string }).action}`);
        }
      },
    },
  ],

  // ============================================================================
  // browse_mr_discussions - CQRS Query Tool (discriminated union schema)
  // TypeScript automatically narrows types in each switch case
  // ============================================================================
  [
    "browse_mr_discussions",
    {
      name: "browse_mr_discussions",
      description:
        "Read discussion threads and draft review notes on merge requests. Actions: list (all threads with resolution status), drafts (unpublished draft notes), draft (single draft details). Related: manage_mr_discussion to comment, manage_draft_notes to create drafts.",
      inputSchema: z.toJSONSchema(BrowseMrDiscussionsSchema),
      gate: { envVar: "USE_MRS", defaultValue: true },
      handler: async (args: unknown) => {
        const input = BrowseMrDiscussionsSchema.parse(args);

        // Runtime validation: reject denied actions even if they bypass schema filtering
        if (isActionDenied("browse_mr_discussions", input.action)) {
          throw new Error(`Action '${input.action}' is not allowed for browse_mr_discussions tool`);
        }

        switch (input.action) {
          case "list": {
            // TypeScript knows: input has project_id (required), merge_request_iid (required), per_page, page (optional)
            const { action: _action, project_id, merge_request_iid, ...rest } = input;
            const query = toQuery(rest, []);

            return gitlab.get(
              `projects/${normalizeProjectId(project_id)}/merge_requests/${merge_request_iid}/discussions`,
              { query }
            );
          }

          case "drafts": {
            // TypeScript knows: input has project_id (required), merge_request_iid (required)
            const { project_id, merge_request_iid } = input;
            return gitlab.get(
              `projects/${normalizeProjectId(project_id)}/merge_requests/${merge_request_iid}/draft_notes`
            );
          }

          case "draft": {
            // TypeScript knows: input has project_id (required), merge_request_iid (required), draft_note_id (required)
            const { project_id, merge_request_iid, draft_note_id } = input;
            return gitlab.get(
              `projects/${normalizeProjectId(project_id)}/merge_requests/${merge_request_iid}/draft_notes/${draft_note_id}`
            );
          }

          /* istanbul ignore next -- unreachable with Zod discriminatedUnion */
          default:
            throw new Error(`Unknown action: ${(input as { action: string }).action}`);
        }
      },
    },
  ],

  // ============================================================================
  // manage_merge_request - CQRS Command Tool (discriminated union schema)
  // TypeScript automatically narrows types in each switch case
  // ============================================================================
  [
    "manage_merge_request",
    {
      name: "manage_merge_request",
      description:
        "Create, update, merge, or approve merge requests. Actions: create (new MR from source to target), update (title/description/assignees/reviewers/labels), merge (into target branch), approve/unapprove (review approval), get_approval_state (current approvals). Related: browse_merge_requests for discovery.",
      inputSchema: z.toJSONSchema(ManageMergeRequestSchema),
      gate: { envVar: "USE_MRS", defaultValue: true },
      handler: async (args: unknown) => {
        const input = ManageMergeRequestSchema.parse(args);

        // Runtime validation: reject denied actions even if they bypass schema filtering
        if (isActionDenied("manage_merge_request", input.action)) {
          throw new Error(`Action '${input.action}' is not allowed for manage_merge_request tool`);
        }

        switch (input.action) {
          case "create": {
            // TypeScript knows: input has source_branch (required), target_branch (required), title (required)
            const { action: _action, project_id, ...body } = input;

            // Handle array fields - convert to comma-separated strings for form encoding
            const processedBody: Record<string, unknown> = {};
            for (const [key, value] of Object.entries(body)) {
              if (Array.isArray(value)) {
                processedBody[key] = value.join(",");
              } else {
                processedBody[key] = value;
              }
            }

            return gitlab.post(`projects/${normalizeProjectId(project_id)}/merge_requests`, {
              body: processedBody,
              contentType: "form",
            });
          }

          case "update": {
            // TypeScript knows: input has merge_request_iid (required)
            const { action: _action, project_id, merge_request_iid, ...body } = input;

            // Handle array fields
            const processedBody: Record<string, unknown> = {};
            for (const [key, value] of Object.entries(body)) {
              if (Array.isArray(value)) {
                processedBody[key] = value.join(",");
              } else {
                processedBody[key] = value;
              }
            }

            return gitlab.put(
              `projects/${normalizeProjectId(project_id)}/merge_requests/${merge_request_iid}`,
              { body: processedBody, contentType: "form" }
            );
          }

          case "merge": {
            // TypeScript knows: input has merge_request_iid (required)
            const {
              action: _action,
              project_id,
              merge_request_iid,
              merge_when_pipeline_succeeds,
              ...body
            } = input;
            const projectPath = normalizeProjectId(project_id);
            const mergeEndpoint = `projects/${projectPath}/merge_requests/${merge_request_iid}/merge`;

            // If auto-merge is explicitly requested, try it directly
            // This allows setting auto-merge even when pipeline is running
            if (merge_when_pipeline_succeeds) {
              return gitlab.put(mergeEndpoint, {
                body: { ...body, merge_when_pipeline_succeeds: true },
                contentType: "form",
              });
            }

            // Pre-check mergeability to provide actionable errors instead of 405
            const mrStatus = await gitlab.get<MergeRequestStatusResponse>(
              `projects/${projectPath}/merge_requests/${merge_request_iid}`
            );

            const detailedStatus = mrStatus.detailed_merge_status;

            // If mergeable, proceed with merge
            if (detailedStatus === "mergeable") {
              return gitlab.put(mergeEndpoint, { body, contentType: "form" });
            }

            // Determine if status is retryable or eligible for auto-merge
            const isRetryable = (RETRYABLE_MERGE_STATUSES as readonly string[]).includes(
              detailedStatus
            );
            const canAutoMerge = (AUTO_MERGE_ELIGIBLE_STATUSES as readonly string[]).includes(
              detailedStatus
            );

            // Return structured error with actionable guidance
            const blockedResponse: MergeBlockedResponse = {
              error: true,
              message: `MR cannot be merged: ${detailedStatus}`,
              detailed_merge_status: detailedStatus,
              merge_status: mrStatus.merge_status,
              has_conflicts: mrStatus.has_conflicts,
              blocking_discussions_resolved: mrStatus.blocking_discussions_resolved,
              hint: getMergeStatusHint(detailedStatus),
              is_retryable: isRetryable,
              can_auto_merge: canAutoMerge,
              suggested_action: getSuggestedAction(isRetryable, canAutoMerge),
            };

            return blockedResponse;
          }

          case "approve": {
            // TypeScript knows: input has merge_request_iid (required), sha (optional)
            const { project_id, merge_request_iid, sha } = input;

            const body: Record<string, unknown> = {};
            if (sha) body.sha = sha;

            return gitlab.post(
              `projects/${normalizeProjectId(project_id)}/merge_requests/${merge_request_iid}/approve`,
              { body: Object.keys(body).length > 0 ? body : undefined, contentType: "json" }
            );
          }

          case "unapprove": {
            // TypeScript knows: input has merge_request_iid (required)
            const { project_id, merge_request_iid } = input;

            return gitlab.post(
              `projects/${normalizeProjectId(project_id)}/merge_requests/${merge_request_iid}/unapprove`
            );
          }

          case "get_approval_state": {
            // TypeScript knows: input has merge_request_iid (required)
            const { project_id, merge_request_iid } = input;

            return gitlab.get(
              `projects/${normalizeProjectId(project_id)}/merge_requests/${merge_request_iid}/approval_state`
            );
          }

          /* istanbul ignore next -- unreachable with Zod discriminatedUnion */
          default:
            throw new Error(`Unknown action: ${(input as { action: string }).action}`);
        }
      },
    },
  ],

  // ============================================================================
  // manage_mr_discussion - CQRS Command Tool (discriminated union schema)
  // TypeScript automatically narrows types in each switch case
  // ============================================================================
  [
    "manage_mr_discussion",
    {
      name: "manage_mr_discussion",
      description:
        "Post comments, start threads, and suggest code changes on merge requests. Actions: comment (simple note), thread (line-level discussion), reply (to existing thread), update (edit note text), resolve (toggle thread resolution), suggest (code suggestion block), apply_suggestion/apply_suggestions (accept code suggestions). Related: browse_mr_discussions to read threads.",
      inputSchema: z.toJSONSchema(ManageMrDiscussionSchema),
      gate: { envVar: "USE_MRS", defaultValue: true },
      handler: async (args: unknown) => {
        const input = ManageMrDiscussionSchema.parse(args);

        // Runtime validation: reject denied actions even if they bypass schema filtering
        if (isActionDenied("manage_mr_discussion", input.action)) {
          throw new Error(`Action '${input.action}' is not allowed for manage_mr_discussion tool`);
        }

        switch (input.action) {
          case "comment": {
            // TypeScript knows: input has noteable_type (required), noteable_id (required), body (required)
            const {
              project_id,
              noteable_type,
              noteable_id,
              body: noteBody,
              created_at,
              confidential,
            } = input;

            const body: Record<string, unknown> = { body: noteBody };
            if (created_at) body.created_at = created_at;
            if (confidential !== undefined) body.confidential = confidential;

            const resourceType = noteable_type === "merge_request" ? "merge_requests" : "issues";

            return gitlab.post(
              `projects/${normalizeProjectId(project_id)}/${resourceType}/${noteable_id}/notes`,
              { body, contentType: "form" }
            );
          }

          case "thread": {
            // TypeScript knows: input has merge_request_iid (required), body (required)
            const { project_id, merge_request_iid, body: noteBody, position, commit_id } = input;

            const body: Record<string, unknown> = { body: noteBody };
            if (position) flattenPositionToFormFields(body, position);
            if (commit_id) body.commit_id = commit_id;

            return gitlab.post(
              `projects/${normalizeProjectId(project_id)}/merge_requests/${merge_request_iid}/discussions`,
              { body, contentType: "form" }
            );
          }

          case "reply": {
            // TypeScript knows: input has merge_request_iid (required), discussion_id (required), body (required)
            const {
              project_id,
              merge_request_iid,
              discussion_id,
              body: noteBody,
              created_at,
            } = input;

            const body: Record<string, unknown> = { body: noteBody };
            if (created_at) body.created_at = created_at;

            return gitlab.post(
              `projects/${normalizeProjectId(project_id)}/merge_requests/${merge_request_iid}/discussions/${discussion_id}/notes`,
              { body, contentType: "form" }
            );
          }

          case "update": {
            // TypeScript knows: input has merge_request_iid (required), note_id (required), body (required)
            const { project_id, merge_request_iid, note_id, body: noteBody } = input;

            return gitlab.put(
              `projects/${normalizeProjectId(project_id)}/merge_requests/${merge_request_iid}/notes/${note_id}`,
              { body: { body: noteBody }, contentType: "form" }
            );
          }

          case "apply_suggestion": {
            // TypeScript knows: input has suggestion_id (required), commit_message (optional)
            // Note: project_id and merge_request_iid are in schema for context but not used in API
            // GitLab suggestions API uses global endpoint: PUT /suggestions/:id/apply
            const { suggestion_id, commit_message } = input;

            const body: Record<string, unknown> = {};
            if (commit_message) {
              body.commit_message = commit_message;
            }

            return gitlab.put(`suggestions/${suggestion_id}/apply`, {
              body: Object.keys(body).length > 0 ? body : undefined,
              contentType: "json",
            });
          }

          case "apply_suggestions": {
            // TypeScript knows: input has suggestion_ids (required), commit_message (optional)
            // Note: project_id and merge_request_iid are in schema for context but not used in API
            // GitLab suggestions API uses global endpoint: PUT /suggestions/batch_apply
            const { suggestion_ids, commit_message } = input;

            const body: Record<string, unknown> = {
              ids: suggestion_ids,
            };
            if (commit_message) {
              body.commit_message = commit_message;
            }

            return gitlab.put(`suggestions/batch_apply`, { body, contentType: "json" });
          }

          case "resolve": {
            // TypeScript knows: input has discussion_id (required), resolved (required)
            const { project_id, merge_request_iid, discussion_id, resolved } = input;

            return gitlab.put(
              `projects/${normalizeProjectId(project_id)}/merge_requests/${merge_request_iid}/discussions/${discussion_id}`,
              { body: { resolved }, contentType: "form" }
            );
          }

          case "suggest": {
            // TypeScript knows: input has position (required), suggestion (required)
            const {
              project_id,
              merge_request_iid,
              position,
              suggestion,
              comment,
              lines_above,
              lines_below,
            } = input;

            // Build markdown suggestion block with line range syntax
            // Format: ```suggestion:-N+M where N=lines_above, M=lines_below
            const rangeSpec =
              lines_above || lines_below ? `:-${lines_above || 0}+${lines_below || 0}` : "";
            const suggestionBlock = `\`\`\`suggestion${rangeSpec}\n${suggestion}\n\`\`\``;

            // Prepend optional comment
            const noteBody = comment ? `${comment}\n\n${suggestionBlock}` : suggestionBlock;

            // Create discussion thread with position (same as thread action)
            const body: Record<string, unknown> = {
              body: noteBody,
            };
            flattenPositionToFormFields(body, position);

            return gitlab.post(
              `projects/${normalizeProjectId(project_id)}/merge_requests/${merge_request_iid}/discussions`,
              { body, contentType: "form" }
            );
          }

          /* istanbul ignore next -- unreachable with Zod discriminatedUnion */
          default:
            throw new Error(`Unknown action: ${(input as { action: string }).action}`);
        }
      },
    },
  ],

  // ============================================================================
  // manage_draft_notes - CQRS Command Tool (discriminated union schema)
  // TypeScript automatically narrows types in each switch case
  // ============================================================================
  [
    "manage_draft_notes",
    {
      name: "manage_draft_notes",
      description:
        "Create and manage unpublished review comments on merge requests. Actions: create (new draft), update (modify text), publish (make single draft visible), publish_all (submit entire review), delete (discard draft). Related: browse_mr_discussions action 'drafts' to list existing drafts.",
      inputSchema: z.toJSONSchema(ManageDraftNotesSchema),
      gate: { envVar: "USE_MRS", defaultValue: true },
      handler: async (args: unknown) => {
        const input = ManageDraftNotesSchema.parse(args);

        // Runtime validation: reject denied actions even if they bypass schema filtering
        if (isActionDenied("manage_draft_notes", input.action)) {
          throw new Error(`Action '${input.action}' is not allowed for manage_draft_notes tool`);
        }

        switch (input.action) {
          case "create": {
            // TypeScript knows: input has note (required), position, in_reply_to_discussion_id, commit_id (optional)
            const {
              project_id,
              merge_request_iid,
              note,
              position,
              in_reply_to_discussion_id,
              commit_id,
            } = input;

            const body: Record<string, unknown> = { note };
            if (position) flattenPositionToFormFields(body, position);
            if (in_reply_to_discussion_id)
              body.in_reply_to_discussion_id = in_reply_to_discussion_id;
            if (commit_id) body.commit_id = commit_id;

            return gitlab.post(
              `projects/${normalizeProjectId(project_id)}/merge_requests/${merge_request_iid}/draft_notes`,
              { body, contentType: "form" }
            );
          }

          case "update": {
            // TypeScript knows: input has draft_note_id (required), note (required)
            const { project_id, merge_request_iid, draft_note_id, note, position } = input;

            const body: Record<string, unknown> = { note };
            if (position) flattenPositionToFormFields(body, position);

            return gitlab.put(
              `projects/${normalizeProjectId(project_id)}/merge_requests/${merge_request_iid}/draft_notes/${draft_note_id}`,
              { body, contentType: "form" }
            );
          }

          case "publish": {
            // TypeScript knows: input has draft_note_id (required)
            const { project_id, merge_request_iid, draft_note_id } = input;

            const result = await gitlab.put<void>(
              `projects/${normalizeProjectId(project_id)}/merge_requests/${merge_request_iid}/draft_notes/${draft_note_id}/publish`
            );
            // PUT publish returns 204 No Content (undefined) on success
            return result ?? { published: true };
          }

          case "publish_all": {
            // TypeScript knows: input has project_id (required), merge_request_iid (required)
            const { project_id, merge_request_iid } = input;

            const result = await gitlab.post<void>(
              `projects/${normalizeProjectId(project_id)}/merge_requests/${merge_request_iid}/draft_notes/bulk_publish`
            );
            // POST bulk_publish returns 204 No Content (undefined) on success
            return result ?? { published: true };
          }

          case "delete": {
            // TypeScript knows: input has draft_note_id (required)
            const { project_id, merge_request_iid, draft_note_id } = input;

            await gitlab.delete<void>(
              `projects/${normalizeProjectId(project_id)}/merge_requests/${merge_request_iid}/draft_notes/${draft_note_id}`
            );
            return { success: true, message: "Draft note deleted successfully" };
          }

          /* istanbul ignore next -- unreachable with Zod discriminatedUnion */
          default:
            throw new Error(`Unknown action: ${(input as { action: string }).action}`);
        }
      },
    },
  ],
]);

/**
 * Get read-only tool names from the registry
 */
export function getMrsReadOnlyToolNames(): string[] {
  return ["browse_merge_requests", "browse_mr_discussions"];
}

/**
 * Get all tool definitions from the registry
 */
export function getMrsToolDefinitions(): EnhancedToolDefinition[] {
  return Array.from(mrsToolRegistry.values());
}

/**
 * Get filtered tools based on read-only mode
 */
export function getFilteredMrsTools(readOnlyMode: boolean = false): EnhancedToolDefinition[] {
  if (readOnlyMode) {
    const readOnlyNames = getMrsReadOnlyToolNames();
    return Array.from(mrsToolRegistry.values()).filter(tool => readOnlyNames.includes(tool.name));
  }
  return getMrsToolDefinitions();
}
