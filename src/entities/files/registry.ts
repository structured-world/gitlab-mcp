import * as z from "zod";
import { BrowseFilesSchema } from "./schema-readonly";
import { ManageFilesSchema } from "./schema";
import { gitlab, toQuery } from "../../utils/gitlab-api";
import { normalizeProjectId } from "../../utils/projectIdentifier";
import { enhancedFetch } from "../../utils/fetch";
import { ToolRegistry, EnhancedToolDefinition } from "../../types";
import { isActionDenied } from "../../config";
import { parseGitLabApiError } from "../../utils/error-handler";

/**
 * Files tools registry - 2 CQRS tools replacing 5 individual tools
 *
 * browse_files (Query): tree listing + file content reading
 * manage_files (Command): single file, batch commit, markdown upload
 */
export const filesToolRegistry: ToolRegistry = new Map<string, EnhancedToolDefinition>([
  // ============================================================================
  // browse_files - CQRS Query Tool (discriminated union schema)
  // TypeScript automatically narrows types in each switch case
  // ============================================================================
  [
    "browse_files",
    {
      name: "browse_files",
      description:
        "Explore project file structure and read source code. Actions: tree (list directory contents with recursive depth control), content (read file at specific ref/branch), download_attachment (get uploaded file by secret+filename). Related: manage_files to create/update files.",
      inputSchema: z.toJSONSchema(BrowseFilesSchema),
      gate: { envVar: "USE_FILES", defaultValue: true },
      handler: async (args: unknown) => {
        const input = BrowseFilesSchema.parse(args);

        // Runtime validation: reject denied actions even if they bypass schema filtering
        if (isActionDenied("browse_files", input.action)) {
          throw new Error(`Action '${input.action}' is not allowed for browse_files tool`);
        }

        switch (input.action) {
          case "tree": {
            // TypeScript knows: input has path, recursive, per_page, page (optional)
            const query: Record<string, string | number | boolean | undefined> = {};
            if (input.path) query.path = input.path;
            if (input.ref) query.ref = input.ref;
            if (input.recursive !== undefined) query.recursive = input.recursive;
            if (input.per_page !== undefined) query.per_page = input.per_page;
            if (input.page !== undefined) query.page = input.page;

            return gitlab.get(`projects/${normalizeProjectId(input.project_id)}/repository/tree`, {
              query: toQuery(query, []),
            });
          }

          case "content": {
            // TypeScript knows: input has file_path (required)
            const queryParams = new URLSearchParams();
            if (input.ref) queryParams.set("ref", input.ref);

            const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${normalizeProjectId(input.project_id)}/repository/files/${encodeURIComponent(input.file_path)}/raw?${queryParams}`;
            const response = await enhancedFetch(apiUrl);

            if (!response.ok) {
              throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
            }

            const content = await response.text();
            return {
              file_path: input.file_path,
              ref: input.ref ?? "HEAD",
              size: content.length,
              content: content,
              content_type: response.headers.get("content-type") ?? "text/plain",
            };
          }

          case "download_attachment": {
            // TypeScript knows: input has project_id, secret, filename (required)
            const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${normalizeProjectId(input.project_id)}/uploads/${input.secret}/${input.filename}`;
            const response = await enhancedFetch(apiUrl);

            if (!response.ok) {
              throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
            }

            const attachment = await response.arrayBuffer();
            return {
              filename: input.filename,
              content: Buffer.from(attachment).toString("base64"),
              contentType: response.headers.get("content-type") ?? "application/octet-stream",
            };
          }

          /* istanbul ignore next -- unreachable with Zod discriminatedUnion */
          default:
            throw new Error(`Unknown action: ${(input as { action: string }).action}`);
        }
      },
    },
  ],

  // ============================================================================
  // manage_files - CQRS Command Tool (discriminated union schema)
  // TypeScript automatically narrows types in each switch case
  // ============================================================================
  [
    "manage_files",
    {
      name: "manage_files",
      description:
        "Create, update, or upload repository files. Actions: single (create/update one file with commit message), batch (atomic multi-file commit), upload (add attachment returning markdown link). Related: browse_files to read existing files.",
      inputSchema: z.toJSONSchema(ManageFilesSchema),
      gate: { envVar: "USE_FILES", defaultValue: true },
      handler: async (args: unknown) => {
        const input = ManageFilesSchema.parse(args);

        // Runtime validation: reject denied actions even if they bypass schema filtering
        if (isActionDenied("manage_files", input.action)) {
          throw new Error(`Action '${input.action}' is not allowed for manage_files tool`);
        }

        switch (input.action) {
          case "single": {
            // TypeScript knows: input has file_path, content, commit_message, branch (required)
            const { project_id, file_path, action: _action, overwrite, ...body } = input;
            const normalizedProjectId = normalizeProjectId(project_id);
            const encodedFilePath = encodeURIComponent(file_path);

            // If overwrite=true, check file existence and use appropriate HTTP method
            if (overwrite) {
              let fileExists = false;
              try {
                await gitlab.get(
                  `projects/${normalizedProjectId}/repository/files/${encodedFilePath}`,
                  { query: { ref: body.start_branch ?? body.branch } }
                );
                fileExists = true;
              } catch (error: unknown) {
                // Only treat real 404 as "file does not exist"; re-throw all other errors
                if (!(error instanceof Error)) {
                  throw error;
                }

                const parsed = parseGitLabApiError(error.message);
                if (!parsed) {
                  // Unexpected/unparseable error format - propagate instead of masking
                  throw error;
                }

                if (parsed.status !== 404) {
                  // Re-throw non-404 errors (permission denied, server error, etc.)
                  throw error;
                }
                // parsed.status === 404: file doesn't exist, proceed with POST
              }

              // Use PUT for update, POST for create
              const method = fileExists ? "put" : "post";
              return gitlab[method](
                `projects/${normalizedProjectId}/repository/files/${encodedFilePath}`,
                {
                  body,
                  contentType: "form",
                }
              );
            }

            // Default behavior (overwrite=false or omitted): always POST (create only)
            return gitlab.post(
              `projects/${normalizedProjectId}/repository/files/${encodedFilePath}`,
              {
                body,
                contentType: "form",
              }
            );
          }

          case "batch": {
            // TypeScript knows: input has files, branch, commit_message (required)
            const normalizedProjectId = normalizeProjectId(input.project_id);

            let actions: Array<{
              action: string;
              file_path: string;
              content: string;
              encoding: string;
              execute_filemode: boolean;
            }>;

            // If overwrite=true, check each file existence and set appropriate action
            if (input.overwrite) {
              // Parallel file existence checks - throws on first non-404 error
              const fileChecks = await Promise.all(
                input.files.map(async file => {
                  try {
                    await gitlab.get(
                      `projects/${normalizedProjectId}/repository/files/${encodeURIComponent(file.file_path)}`,
                      { query: { ref: input.start_branch ?? input.branch } }
                    );
                    return { file_path: file.file_path, exists: true };
                  } catch (error: unknown) {
                    // Parse status from error message (gitlab.get throws plain Error)
                    if (error instanceof Error) {
                      const parsed = parseGitLabApiError(error.message);
                      if (parsed) {
                        if (parsed.status === 404) {
                          return { file_path: file.file_path, exists: false };
                        }
                        // Non-404 error (403, 500, etc.) - re-throw to fail the whole batch
                        throw error;
                      }
                    }
                    // Unparseable error - re-throw
                    throw error;
                  }
                })
              );

              // Build existence map from successful checks
              const existenceMap = new Map<string, boolean>();
              fileChecks.forEach(result => {
                existenceMap.set(result.file_path, result.exists);
              });

              // Map files to actions with correct create/update
              actions = input.files.map(file => ({
                action: existenceMap.get(file.file_path) ? "update" : "create",
                file_path: file.file_path,
                content: file.content,
                encoding: file.encoding ?? "text",
                execute_filemode: file.execute_filemode ?? false,
              }));
            } else {
              // Default behavior (overwrite=false or omitted): all actions are "create"
              actions = input.files.map(file => ({
                action: "create",
                file_path: file.file_path,
                content: file.content,
                encoding: file.encoding ?? "text",
                execute_filemode: file.execute_filemode ?? false,
              }));
            }

            const body: Record<string, unknown> = {
              branch: input.branch,
              commit_message: input.commit_message,
              actions,
            };

            if (input.start_branch) body.start_branch = input.start_branch;
            if (input.author_email) body.author_email = input.author_email;
            if (input.author_name) body.author_name = input.author_name;

            return gitlab.post(`projects/${normalizedProjectId}/repository/commits`, {
              body,
              contentType: "json",
            });
          }

          case "upload": {
            // TypeScript knows: input has file, filename (required)
            const formData = new FormData();
            const buffer = Buffer.from(input.file, "base64");
            // Buffer is a Uint8Array subclass, can be passed directly to File constructor
            const fileObj = new File([buffer], input.filename, {
              type: "application/octet-stream",
            });
            formData.append("file", fileObj);

            return gitlab.post(`projects/${normalizeProjectId(input.project_id)}/uploads`, {
              body: formData,
            });
          }

          /* istanbul ignore next -- unreachable with Zod discriminatedUnion */
          default:
            throw new Error(`Unknown action: ${(input as { action: string }).action}`);
        }
      },
    },
  ],
]);

export function getFilesReadOnlyToolNames(): string[] {
  return ["browse_files"];
}

export function getFilesToolDefinitions(): EnhancedToolDefinition[] {
  return Array.from(filesToolRegistry.values());
}

export function getFilteredFilesTools(readOnlyMode: boolean = false): EnhancedToolDefinition[] {
  if (readOnlyMode) {
    const readOnlyNames = getFilesReadOnlyToolNames();
    return Array.from(filesToolRegistry.values()).filter(tool => readOnlyNames.includes(tool.name));
  }
  return getFilesToolDefinitions();
}
