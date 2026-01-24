/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import * as z from "zod";
import {
  // Consolidated schemas
  BrowseProjectsSchema,
  BrowseNamespacesSchema,
  BrowseCommitsSchema,
  BrowseEventsSchema,
  BrowseUsersSchema,
  BrowseTodosSchema,
} from "./schema-readonly";
import {
  // Consolidated schemas
  ManageProjectSchema,
  ManageNamespaceSchema,
  ManageTodosSchema,
} from "./schema";
import { enhancedFetch } from "../../utils/fetch";
import { normalizeProjectId } from "../../utils/projectIdentifier";
import { smartUserSearch, type UserSearchParams } from "../../utils/smart-user-search";
import { cleanGidsFromObject } from "../../utils/idConversion";
import { ToolRegistry, EnhancedToolDefinition } from "../../types";
import { isActionDenied } from "../../config";

/**
 * Core tools registry - CQRS consolidated
 * All tools use discriminated union schema pattern.
 * TypeScript automatically narrows types in each switch case.
 */
export const coreToolRegistry: ToolRegistry = new Map<string, EnhancedToolDefinition>([
  // ============================================================================
  // BROWSE TOOLS (read-only queries)
  // ============================================================================

  [
    "browse_projects",
    {
      name: "browse_projects",
      description:
        "Find, list, or inspect GitLab projects. Actions: search (find by name/topic across GitLab), list (browse accessible projects or group projects), get (retrieve full project details). Related: manage_project to create/update/delete projects.",
      inputSchema: z.toJSONSchema(BrowseProjectsSchema),
      handler: async (args: unknown): Promise<unknown> => {
        const input = BrowseProjectsSchema.parse(args);

        if (isActionDenied("browse_projects", input.action)) {
          throw new Error(`Action '${input.action}' is not allowed for browse_projects tool`);
        }

        switch (input.action) {
          case "search": {
            const { q, with_programming_language, visibility, order_by, sort, per_page, page } =
              input;
            const queryParams = new URLSearchParams();

            if (q) {
              let finalSearchTerms = q;

              const topicMatches = q.match(/topic:(\w+)/g);
              if (topicMatches) {
                const topics = topicMatches.map(match => match.replace("topic:", ""));
                queryParams.set("topic", topics.join(","));
                finalSearchTerms = finalSearchTerms.replace(/topic:\w+/g, "").trim();
              }

              if (finalSearchTerms) {
                queryParams.set("search", finalSearchTerms);
              }
            }

            if (with_programming_language)
              queryParams.set("with_programming_language", with_programming_language);
            if (visibility) queryParams.set("visibility", visibility);
            if (order_by) queryParams.set("order_by", order_by);
            if (sort) queryParams.set("sort", sort);
            if (per_page) queryParams.set("per_page", String(per_page));
            if (page) queryParams.set("page", String(page));

            queryParams.set("active", "true");

            const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects?${queryParams}`;
            const response = await enhancedFetch(apiUrl);

            if (!response.ok) {
              throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
            }

            const projects = await response.json();
            return cleanGidsFromObject(projects);
          }

          case "list": {
            const {
              group_id,
              search,
              owned,
              starred,
              membership,
              simple,
              with_programming_language,
              include_subgroups,
              with_shared,
              visibility,
              archived,
              order_by,
              sort,
              per_page,
              page,
            } = input;
            const queryParams = new URLSearchParams();

            if (visibility) queryParams.set("visibility", visibility);
            if (archived !== undefined) queryParams.set("archived", String(archived));
            if (owned !== undefined) queryParams.set("owned", String(owned));
            if (starred !== undefined) queryParams.set("starred", String(starred));
            if (membership !== undefined) queryParams.set("membership", String(membership));
            if (search) queryParams.set("search", search);
            if (simple !== undefined) queryParams.set("simple", String(simple));
            if (order_by) queryParams.set("order_by", order_by);
            if (sort) queryParams.set("sort", sort);
            if (per_page) queryParams.set("per_page", String(per_page));
            if (page) queryParams.set("page", String(page));
            if (include_subgroups !== undefined)
              queryParams.set("include_subgroups", String(include_subgroups));
            if (with_shared !== undefined) queryParams.set("with_shared", String(with_shared));
            if (with_programming_language)
              queryParams.set("with_programming_language", with_programming_language);

            if (!queryParams.has("order_by")) queryParams.set("order_by", "created_at");
            if (!queryParams.has("sort")) queryParams.set("sort", "desc");
            if (!queryParams.has("simple")) queryParams.set("simple", "true");
            if (!queryParams.has("per_page")) queryParams.set("per_page", "20");

            let apiUrl: string;
            if (group_id) {
              apiUrl = `${process.env.GITLAB_API_URL}/api/v4/groups/${encodeURIComponent(group_id)}/projects?${queryParams}`;
            } else {
              queryParams.set("active", "true");
              apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects?${queryParams}`;
            }

            const response = await enhancedFetch(apiUrl);

            if (!response.ok) {
              throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
            }

            const projects = await response.json();
            return cleanGidsFromObject(projects);
          }

          case "get": {
            const { project_id, statistics, license } = input;

            const queryParams = new URLSearchParams();
            if (statistics) queryParams.set("statistics", "true");
            if (license) queryParams.set("license", "true");

            const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${normalizeProjectId(project_id)}?${queryParams}`;
            const response = await enhancedFetch(apiUrl);

            if (!response.ok) {
              throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
            }

            const project = await response.json();
            return cleanGidsFromObject(project);
          }

          /* istanbul ignore next -- unreachable with Zod discriminatedUnion */
          default:
            throw new Error(`Unknown action: ${(input as { action: string }).action}`);
        }
      },
    },
  ],

  [
    "browse_namespaces",
    {
      name: "browse_namespaces",
      description:
        "Explore GitLab groups and user namespaces. Actions: list (discover available namespaces), get (retrieve details with storage stats), verify (check if path exists). Related: manage_namespace to create/update/delete groups.",
      inputSchema: z.toJSONSchema(BrowseNamespacesSchema),
      handler: async (args: unknown): Promise<unknown> => {
        const input = BrowseNamespacesSchema.parse(args);

        if (isActionDenied("browse_namespaces", input.action)) {
          throw new Error(`Action '${input.action}' is not allowed for browse_namespaces tool`);
        }

        switch (input.action) {
          case "list": {
            const {
              search,
              owned_only,
              top_level_only,
              with_statistics,
              min_access_level,
              per_page,
              page,
            } = input;
            const queryParams = new URLSearchParams();

            if (search) queryParams.set("search", search);
            if (owned_only !== undefined) queryParams.set("owned_only", String(owned_only));
            if (top_level_only !== undefined)
              queryParams.set("top_level_only", String(top_level_only));
            if (with_statistics !== undefined)
              queryParams.set("with_statistics", String(with_statistics));
            if (min_access_level !== undefined)
              queryParams.set("min_access_level", String(min_access_level));
            if (per_page) queryParams.set("per_page", String(per_page));
            if (page) queryParams.set("page", String(page));

            const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/namespaces?${queryParams}`;
            const response = await enhancedFetch(apiUrl);

            if (!response.ok) {
              throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
            }

            const namespaces = await response.json();
            return cleanGidsFromObject(namespaces);
          }

          case "get": {
            const { namespace_id } = input;

            const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/namespaces/${encodeURIComponent(namespace_id)}`;
            const response = await enhancedFetch(apiUrl);

            if (!response.ok) {
              throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
            }

            const namespace = await response.json();
            return cleanGidsFromObject(namespace);
          }

          case "verify": {
            const { namespace_id } = input;

            const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/namespaces/${encodeURIComponent(namespace_id)}`;
            const response = await enhancedFetch(apiUrl);

            return {
              exists: response.ok,
              status: response.status,
              namespace: namespace_id,
              data: response.ok ? await response.json() : null,
            };
          }

          /* istanbul ignore next -- unreachable with Zod discriminatedUnion */
          default:
            throw new Error(`Unknown action: ${(input as { action: string }).action}`);
        }
      },
    },
  ],

  [
    "browse_commits",
    {
      name: "browse_commits",
      description:
        "Explore repository commit history and diffs. Actions: list (browse commits with filters), get (retrieve commit metadata and stats), diff (view code changes). Related: browse_refs for branch/tag info.",
      inputSchema: z.toJSONSchema(BrowseCommitsSchema),
      handler: async (args: unknown): Promise<unknown> => {
        const input = BrowseCommitsSchema.parse(args);

        if (isActionDenied("browse_commits", input.action)) {
          throw new Error(`Action '${input.action}' is not allowed for browse_commits tool`);
        }

        switch (input.action) {
          case "list": {
            const {
              project_id,
              ref_name,
              since,
              until,
              path,
              author,
              all,
              with_stats,
              first_parent,
              order,
              trailers,
              per_page,
              page,
            } = input;
            const queryParams = new URLSearchParams();

            if (ref_name) queryParams.set("ref_name", ref_name);
            if (since) queryParams.set("since", since);
            if (until) queryParams.set("until", until);
            if (path) queryParams.set("path", path);
            if (author) queryParams.set("author", author);
            if (all !== undefined) queryParams.set("all", String(all));
            if (with_stats !== undefined) queryParams.set("with_stats", String(with_stats));
            if (first_parent !== undefined) queryParams.set("first_parent", String(first_parent));
            if (order) queryParams.set("order", order);
            if (trailers !== undefined) queryParams.set("trailers", String(trailers));
            if (per_page) queryParams.set("per_page", String(per_page));
            if (page) queryParams.set("page", String(page));

            const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(project_id)}/repository/commits?${queryParams}`;
            const response = await enhancedFetch(apiUrl);

            if (!response.ok) {
              throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
            }

            return await response.json();
          }

          case "get": {
            const { project_id, sha, stats } = input;

            const queryParams = new URLSearchParams();
            if (stats) queryParams.set("stats", "true");

            const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(project_id)}/repository/commits/${encodeURIComponent(sha)}?${queryParams}`;
            const response = await enhancedFetch(apiUrl);

            if (!response.ok) {
              throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
            }

            return await response.json();
          }

          case "diff": {
            const { project_id, sha, unidiff, per_page, page } = input;

            const queryParams = new URLSearchParams();
            if (unidiff) queryParams.set("unidiff", "true");
            if (per_page) queryParams.set("per_page", String(per_page));
            if (page) queryParams.set("page", String(page));

            const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(project_id)}/repository/commits/${encodeURIComponent(sha)}/diff?${queryParams}`;
            const response = await enhancedFetch(apiUrl);

            if (!response.ok) {
              throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
            }

            return await response.json();
          }

          /* istanbul ignore next -- unreachable with Zod discriminatedUnion */
          default:
            throw new Error(`Unknown action: ${(input as { action: string }).action}`);
        }
      },
    },
  ],

  [
    "browse_events",
    {
      name: "browse_events",
      description:
        "Track GitLab activity and events. Actions: user (your activity across all projects), project (specific project activity feed). Filter by date range, action type, or target type.",
      inputSchema: z.toJSONSchema(BrowseEventsSchema),
      handler: async (args: unknown): Promise<unknown> => {
        const input = BrowseEventsSchema.parse(args);

        if (isActionDenied("browse_events", input.action)) {
          throw new Error(`Action '${input.action}' is not allowed for browse_events tool`);
        }

        const buildQueryParams = (opts: {
          target_type?: string;
          event_action?: string;
          before?: string;
          after?: string;
          sort?: string;
          per_page?: number;
          page?: number;
        }) => {
          const queryParams = new URLSearchParams();
          if (opts.target_type) queryParams.set("target_type", opts.target_type);
          if (opts.event_action) queryParams.set("action", opts.event_action);
          if (opts.before) queryParams.set("before", opts.before);
          if (opts.after) queryParams.set("after", opts.after);
          if (opts.sort) queryParams.set("sort", opts.sort);
          if (opts.per_page) queryParams.set("per_page", String(opts.per_page));
          if (opts.page) queryParams.set("page", String(opts.page));
          return queryParams;
        };

        switch (input.action) {
          case "user": {
            const queryParams = buildQueryParams(input);
            const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/events?${queryParams}`;
            const response = await enhancedFetch(apiUrl);

            if (!response.ok) {
              throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
            }

            return await response.json();
          }

          case "project": {
            const { project_id } = input;
            const queryParams = buildQueryParams(input);
            const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(project_id)}/events?${queryParams}`;
            const response = await enhancedFetch(apiUrl);

            if (!response.ok) {
              throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
            }

            return await response.json();
          }

          /* istanbul ignore next -- unreachable with Zod discriminatedUnion */
          default:
            throw new Error(`Unknown action: ${(input as { action: string }).action}`);
        }
      },
    },
  ],

  [
    "browse_users",
    {
      name: "browse_users",
      description:
        "Find GitLab users with smart pattern detection. Actions: search (find users by name/email/username with transliteration support), get (retrieve specific user by ID). Related: browse_members for project/group membership.",
      inputSchema: z.toJSONSchema(BrowseUsersSchema),
      handler: async (args: unknown): Promise<unknown> => {
        const input = BrowseUsersSchema.parse(args);

        if (isActionDenied("browse_users", input.action)) {
          throw new Error(`Action '${input.action}' is not allowed for browse_users tool`);
        }

        switch (input.action) {
          case "search": {
            const { smart_search, search, username, public_email, ...otherParams } = input;

            const hasUsernameOrEmail = Boolean(username) || Boolean(public_email);
            const hasOnlySearch = Boolean(search) && !hasUsernameOrEmail;
            const shouldUseSmartSearch =
              smart_search === false ? false : smart_search === true || hasOnlySearch;

            if (shouldUseSmartSearch && (search || username || public_email)) {
              const query = search ?? username ?? public_email ?? "";
              const additionalParams: UserSearchParams = {};

              Object.entries(otherParams).forEach(([key, value]) => {
                if (value !== undefined && key !== "smart_search" && key !== "action") {
                  additionalParams[key] = value;
                }
              });

              return await smartUserSearch(query, additionalParams);
            } else {
              const queryParams = new URLSearchParams();
              Object.entries(input).forEach(([key, value]) => {
                if (value !== undefined && key !== "smart_search" && key !== "action") {
                  queryParams.set(key, String(value));
                }
              });

              const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/users?${queryParams}`;
              const response = await enhancedFetch(apiUrl);

              if (!response.ok) {
                throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
              }

              const users = await response.json();
              return cleanGidsFromObject(users);
            }
          }

          case "get": {
            const { user_id } = input;

            const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/users/${encodeURIComponent(user_id)}`;
            const response = await enhancedFetch(apiUrl);

            if (!response.ok) {
              throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
            }

            const user = await response.json();
            return cleanGidsFromObject(user);
          }

          /* istanbul ignore next -- unreachable with Zod discriminatedUnion */
          default:
            throw new Error(`Unknown action: ${(input as { action: string }).action}`);
        }
      },
    },
  ],

  [
    "browse_todos",
    {
      name: "browse_todos",
      description:
        "View your GitLab todo queue (notifications requiring action). Actions: list (filter by state, action type, target type). Todos are auto-created for assignments, mentions, reviews, and pipeline failures. Related: manage_todos to mark done/restore.",
      inputSchema: z.toJSONSchema(BrowseTodosSchema),
      handler: async (args: unknown): Promise<unknown> => {
        const input = BrowseTodosSchema.parse(args);

        if (isActionDenied("browse_todos", input.action)) {
          throw new Error(`Action '${input.action}' is not allowed for browse_todos tool`);
        }

        switch (input.action) {
          case "list": {
            const queryParams = new URLSearchParams();
            const { action: _action, todo_action, ...rest } = input;

            // Map todo_action to API 'action' parameter
            if (todo_action) queryParams.set("action", todo_action);

            Object.entries(rest).forEach(([key, value]) => {
              if (value !== undefined) {
                queryParams.set(key, String(value));
              }
            });

            const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/todos?${queryParams}`;
            const response = await enhancedFetch(apiUrl);

            if (!response.ok) {
              throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
            }

            const todos = await response.json();
            return cleanGidsFromObject(todos);
          }

          /* istanbul ignore next -- unreachable with Zod discriminatedUnion */
          default:
            throw new Error(`Unknown action: ${(input as { action: string }).action}`);
        }
      },
    },
  ],

  // ============================================================================
  // MANAGE TOOLS (write operations)
  // ============================================================================

  [
    "manage_project",
    {
      name: "manage_project",
      description:
        "Create, update, or manage GitLab projects. Actions: create (new project with settings), fork (copy existing project), update (modify settings), delete (remove permanently), archive/unarchive (toggle read-only), transfer (move to different namespace). Related: browse_projects for discovery.",
      inputSchema: z.toJSONSchema(ManageProjectSchema),
      handler: async (args: unknown): Promise<unknown> => {
        const input = ManageProjectSchema.parse(args);

        if (isActionDenied("manage_project", input.action)) {
          throw new Error(`Action '${input.action}' is not allowed for manage_project tool`);
        }

        switch (input.action) {
          case "create": {
            const {
              name,
              namespace,
              description,
              visibility,
              initialize_with_readme,
              issues_enabled,
              merge_requests_enabled,
              jobs_enabled,
              wiki_enabled,
              snippets_enabled,
              lfs_enabled,
              request_access_enabled,
              only_allow_merge_if_pipeline_succeeds,
              only_allow_merge_if_all_discussions_are_resolved,
            } = input;

            // Resolve namespace path to ID if provided
            let namespaceId: string | undefined;
            let resolvedNamespace: { id: string; full_path: string } | null = null;
            if (namespace) {
              const namespaceApiUrl = `${process.env.GITLAB_API_URL}/api/v4/namespaces/${encodeURIComponent(namespace)}`;
              const namespaceResponse = await enhancedFetch(namespaceApiUrl);

              if (namespaceResponse.ok) {
                resolvedNamespace = (await namespaceResponse.json()) as {
                  id: string;
                  full_path: string;
                };
                namespaceId = String(resolvedNamespace.id);
              } else {
                throw new Error(`Namespace '${namespace}' not found or not accessible`);
              }
            }

            // Check if project already exists
            const targetNamespacePath = resolvedNamespace
              ? resolvedNamespace.full_path
              : "current-user";
            const projectPath = `${targetNamespacePath}/${name}`;
            const checkProjectUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(projectPath)}`;
            const checkResponse = await enhancedFetch(checkProjectUrl);

            if (checkResponse.ok) {
              const existingProject = (await checkResponse.json()) as { id: string };
              throw new Error(
                `Project '${projectPath}' already exists (ID: ${existingProject.id}).`
              );
            }

            // Create project
            const body = new URLSearchParams();
            body.set("name", name);

            const generatedPath = name
              .toLowerCase()
              .replace(/[^a-z0-9-]/g, "-")
              .replace(/-+/g, "-")
              .replace(/^-|-$/g, "");
            body.set("path", generatedPath);

            if (namespaceId) body.set("namespace_id", namespaceId);
            if (description) body.set("description", description);
            if (visibility) body.set("visibility", visibility);
            if (initialize_with_readme) body.set("initialize_with_readme", "true");
            if (issues_enabled !== undefined) body.set("issues_enabled", String(issues_enabled));
            if (merge_requests_enabled !== undefined)
              body.set("merge_requests_enabled", String(merge_requests_enabled));
            if (jobs_enabled !== undefined) body.set("jobs_enabled", String(jobs_enabled));
            if (wiki_enabled !== undefined) body.set("wiki_enabled", String(wiki_enabled));
            if (snippets_enabled !== undefined)
              body.set("snippets_enabled", String(snippets_enabled));
            if (lfs_enabled !== undefined) body.set("lfs_enabled", String(lfs_enabled));
            if (request_access_enabled !== undefined)
              body.set("request_access_enabled", String(request_access_enabled));
            if (only_allow_merge_if_pipeline_succeeds !== undefined)
              body.set(
                "only_allow_merge_if_pipeline_succeeds",
                String(only_allow_merge_if_pipeline_succeeds)
              );
            if (only_allow_merge_if_all_discussions_are_resolved !== undefined)
              body.set(
                "only_allow_merge_if_all_discussions_are_resolved",
                String(only_allow_merge_if_all_discussions_are_resolved)
              );

            const createApiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects`;
            const createResponse = await enhancedFetch(createApiUrl, {
              method: "POST",
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
              body: body.toString(),
            });

            if (!createResponse.ok) {
              throw new Error(
                `GitLab API error: ${createResponse.status} ${createResponse.statusText}`
              );
            }

            const project = await createResponse.json();
            return {
              ...project,
              validation: {
                namespace_resolved: namespace ? `${namespace} -> ${namespaceId}` : "current-user",
                generated_path: generatedPath,
              },
            };
          }

          case "fork": {
            const { project_id, namespace, namespace_path, fork_name, fork_path } = input;

            const body = new URLSearchParams();
            if (namespace) body.set("namespace", namespace);
            if (namespace_path) body.set("namespace_path", namespace_path);
            if (fork_name) body.set("name", fork_name);
            if (fork_path) body.set("path", fork_path);

            const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(project_id)}/fork`;
            const response = await enhancedFetch(apiUrl, {
              method: "POST",
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
              body: body.toString(),
            });

            if (!response.ok) {
              throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
            }

            return await response.json();
          }

          case "update": {
            const { project_id, action: _action, ...updateParams } = input;

            const body = new URLSearchParams();
            Object.entries(updateParams).forEach(([key, value]) => {
              if (value !== undefined) {
                body.set(key, String(value));
              }
            });

            const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${normalizeProjectId(project_id)}`;
            const response = await enhancedFetch(apiUrl, {
              method: "PUT",
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
              body: body.toString(),
            });

            if (!response.ok) {
              throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
            }

            return await response.json();
          }

          case "delete": {
            const { project_id } = input;

            const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${normalizeProjectId(project_id)}`;
            const response = await enhancedFetch(apiUrl, { method: "DELETE" });

            if (!response.ok) {
              throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
            }

            return { success: true, message: `Project ${project_id} deleted` };
          }

          case "archive": {
            const { project_id } = input;

            const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${normalizeProjectId(project_id)}/archive`;
            const response = await enhancedFetch(apiUrl, { method: "POST" });

            if (!response.ok) {
              throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
            }

            return await response.json();
          }

          case "unarchive": {
            const { project_id } = input;

            const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${normalizeProjectId(project_id)}/unarchive`;
            const response = await enhancedFetch(apiUrl, { method: "POST" });

            if (!response.ok) {
              throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
            }

            return await response.json();
          }

          case "transfer": {
            const { project_id, namespace } = input;

            const body = new URLSearchParams();
            body.set("namespace", namespace);

            const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${normalizeProjectId(project_id)}/transfer`;
            const response = await enhancedFetch(apiUrl, {
              method: "PUT",
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
              body: body.toString(),
            });

            if (!response.ok) {
              throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
            }

            return await response.json();
          }

          /* istanbul ignore next -- unreachable with Zod discriminatedUnion */
          default:
            throw new Error(`Unknown action: ${(input as { action: string }).action}`);
        }
      },
    },
  ],

  [
    "manage_namespace",
    {
      name: "manage_namespace",
      description:
        "Create, update, or delete GitLab groups/namespaces. Actions: create (new group with visibility/settings), update (modify group settings), delete (remove permanently). Related: browse_namespaces for discovery.",
      inputSchema: z.toJSONSchema(ManageNamespaceSchema),
      handler: async (args: unknown): Promise<unknown> => {
        const input = ManageNamespaceSchema.parse(args);

        if (isActionDenied("manage_namespace", input.action)) {
          throw new Error(`Action '${input.action}' is not allowed for manage_namespace tool`);
        }

        switch (input.action) {
          case "create": {
            const body = new URLSearchParams();

            body.set("name", input.name);
            body.set("path", input.path);

            if (input.description) body.set("description", input.description);
            if (input.visibility) body.set("visibility", input.visibility);
            if (input.parent_id !== undefined) body.set("parent_id", String(input.parent_id));
            if (input.lfs_enabled !== undefined) body.set("lfs_enabled", String(input.lfs_enabled));
            if (input.request_access_enabled !== undefined)
              body.set("request_access_enabled", String(input.request_access_enabled));
            if (input.default_branch_protection !== undefined)
              body.set("default_branch_protection", String(input.default_branch_protection));
            if (input.avatar) body.set("avatar", input.avatar);

            const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/groups`;
            const response = await enhancedFetch(apiUrl, {
              method: "POST",
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
              body: body.toString(),
            });

            if (!response.ok) {
              throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
            }

            return await response.json();
          }

          case "update": {
            const { group_id, action: _action, ...updateParams } = input;

            const body = new URLSearchParams();
            Object.entries(updateParams).forEach(([key, value]) => {
              if (value !== undefined) {
                body.set(key, String(value));
              }
            });

            const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/groups/${encodeURIComponent(group_id)}`;
            const response = await enhancedFetch(apiUrl, {
              method: "PUT",
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
              body: body.toString(),
            });

            if (!response.ok) {
              throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
            }

            return await response.json();
          }

          case "delete": {
            const { group_id } = input;

            const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/groups/${encodeURIComponent(group_id)}`;
            const response = await enhancedFetch(apiUrl, { method: "DELETE" });

            if (!response.ok) {
              throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
            }

            return { success: true, message: `Group ${group_id} deleted` };
          }

          /* istanbul ignore next -- unreachable with Zod discriminatedUnion */
          default:
            throw new Error(`Unknown action: ${(input as { action: string }).action}`);
        }
      },
    },
  ],

  // ============================================================================
  // TODOS TOOLS
  // ============================================================================

  [
    "manage_todos",
    {
      name: "manage_todos",
      description:
        "Manage your GitLab todo queue. Actions: mark_done (complete a single todo), mark_all_done (clear entire queue), restore (undo completion). Related: browse_todos to view your todo list.",
      inputSchema: z.toJSONSchema(ManageTodosSchema),
      handler: async (args: unknown): Promise<unknown> => {
        const input = ManageTodosSchema.parse(args);

        if (isActionDenied("manage_todos", input.action)) {
          throw new Error(`Action '${input.action}' is not allowed for manage_todos tool`);
        }

        switch (input.action) {
          case "mark_done": {
            const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/todos/${input.id}/mark_as_done`;
            const response = await enhancedFetch(apiUrl, { method: "POST" });

            if (!response.ok) {
              throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
            }

            const todo = await response.json();
            return cleanGidsFromObject(todo);
          }

          case "mark_all_done": {
            const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/todos/mark_all_as_done`;
            const response = await enhancedFetch(apiUrl, { method: "POST" });

            if (!response.ok) {
              throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
            }

            return { success: true, message: "All todos marked as done" };
          }

          case "restore": {
            const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/todos/${input.id}/mark_as_pending`;
            const response = await enhancedFetch(apiUrl, { method: "POST" });

            if (!response.ok) {
              throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
            }

            const todo = await response.json();
            return cleanGidsFromObject(todo);
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
export function getCoreReadOnlyToolNames(): string[] {
  return [
    "browse_projects",
    "browse_namespaces",
    "browse_commits",
    "browse_events",
    "browse_users",
    "browse_todos",
  ];
}

/**
 * Get all tool definitions from the registry
 */
export function getCoreToolDefinitions(): EnhancedToolDefinition[] {
  return Array.from(coreToolRegistry.values());
}

/**
 * Get filtered tools based on read-only mode
 */
export function getFilteredCoreTools(readOnlyMode: boolean = false): EnhancedToolDefinition[] {
  if (readOnlyMode) {
    const readOnlyNames = getCoreReadOnlyToolNames();
    return Array.from(coreToolRegistry.values()).filter(tool => readOnlyNames.includes(tool.name));
  }
  return getCoreToolDefinitions();
}
