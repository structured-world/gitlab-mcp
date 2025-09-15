/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { zodToJsonSchema } from 'zod-to-json-schema';
import { GetRepositoryTreeSchema, GetFileContentsSchema } from './schema-readonly';
import { CreateOrUpdateFileSchema, PushFilesSchema, MarkdownUploadSchema } from './schema';
import { enhancedFetch } from '../../utils/fetch';
import { ToolRegistry, EnhancedToolDefinition } from '../../types';

/**
 * Files tools registry - unified registry containing all file operation tools with their handlers
 */
export const filesToolRegistry: ToolRegistry = new Map<string, EnhancedToolDefinition>([
  // Read-only tools
  [
    'get_repository_tree',
    {
      name: 'get_repository_tree',
      description: 'Get the repository tree for a GitLab project (list files and directories)',
      inputSchema: zodToJsonSchema(GetRepositoryTreeSchema),
      handler: async (args: unknown): Promise<unknown> => {
        const options = GetRepositoryTreeSchema.parse(args);
        const { project_id } = options;

        const queryParams = new URLSearchParams();
        Object.entries(options).forEach(([key, value]) => {
          if (value !== undefined && key !== 'project_id') {
            queryParams.set(key, String(value));
          }
        });

        const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(project_id)}/repository/tree?${queryParams}`;
        const response = await enhancedFetch(apiUrl, {
          headers: {
            Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
          },
        });

        if (!response.ok) {
          throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
        }

        const tree = await response.json();
        return tree;
      },
    },
  ],
  [
    'get_file_contents',
    {
      name: 'get_file_contents',
      description: 'Get the contents of a file or directory from a GitLab project',
      inputSchema: zodToJsonSchema(GetFileContentsSchema),
      handler: async (args: unknown): Promise<unknown> => {
        const options = GetFileContentsSchema.parse(args);
        const { project_id, file_path, ref } = options;

        const queryParams = new URLSearchParams();
        if (ref) {
          queryParams.set('ref', ref);
        }

        const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(project_id)}/repository/files/${encodeURIComponent(file_path)}?${queryParams}`;
        const response = await enhancedFetch(apiUrl, {
          headers: {
            Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
          },
        });

        if (!response.ok) {
          throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
        }

        const file = await response.json();
        return file;
      },
    },
  ],
  // Write tools
  [
    'create_or_update_file',
    {
      name: 'create_or_update_file',
      description: 'Create or update a single file in a GitLab project',
      inputSchema: zodToJsonSchema(CreateOrUpdateFileSchema),
      handler: async (args: unknown): Promise<unknown> => {
        const options = CreateOrUpdateFileSchema.parse(args);
        const { project_id, file_path } = options;

        const body = new URLSearchParams();
        Object.entries(options).forEach(([key, value]) => {
          if (value !== undefined && key !== 'project_id' && key !== 'file_path') {
            body.set(key, String(value));
          }
        });

        const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(project_id)}/repository/files/${encodeURIComponent(file_path)}`;
        const response = await enhancedFetch(apiUrl, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: body.toString(),
        });

        if (!response.ok) {
          throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
        }

        const result = await response.json();
        return result;
      },
    },
  ],
  [
    'push_files',
    {
      name: 'push_files',
      description: 'Push multiple files to a GitLab project in a single commit',
      inputSchema: zodToJsonSchema(PushFilesSchema),
      handler: async (args: unknown): Promise<unknown> => {
        const options = PushFilesSchema.parse(args);
        const { project_id } = options;

        // Convert files to actions format for GitLab API
        const actions = options.files.map((file) => ({
          action: 'create',
          file_path: file.file_path,
          content: file.content,
          encoding: file.encoding ?? 'text',
          execute_filemode: file.execute_filemode ?? false,
        }));

        const body = {
          branch: options.branch,
          commit_message: options.commit_message,
          actions: actions,
          start_branch: options.start_branch,
          author_email: options.author_email,
          author_name: options.author_name,
        };

        // Remove undefined fields
        Object.keys(body).forEach((key) => {
          if (body[key as keyof typeof body] === undefined) {
            delete body[key as keyof typeof body];
          }
        });

        const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(project_id)}/repository/commits`;
        const response = await enhancedFetch(apiUrl, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        });

        if (!response.ok) {
          throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
        }

        const commit = await response.json();
        return commit;
      },
    },
  ],
  [
    'upload_markdown',
    {
      name: 'upload_markdown',
      description: 'Upload a file to a GitLab project for use in markdown content',
      inputSchema: zodToJsonSchema(MarkdownUploadSchema),
      handler: async (args: unknown): Promise<unknown> => {
        const options = MarkdownUploadSchema.parse(args);
        const { project_id, file, filename } = options;

        // Create FormData for file upload
        const formData = new FormData();

        // Convert base64 file content to blob if needed
        let fileBlob: Blob;
        if (typeof file === 'string') {
          // Assume it's base64 encoded
          const binaryString = Buffer.from(file, 'base64').toString('binary');
          const bytes = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }
          fileBlob = new Blob([bytes]);
        } else {
          fileBlob = file as Blob;
        }

        formData.append('file', fileBlob, filename);

        const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(project_id)}/uploads`;
        const response = await enhancedFetch(apiUrl, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
          },
          body: formData,
        });

        if (!response.ok) {
          throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
        }

        const upload = await response.json();
        return upload;
      },
    },
  ],
]);

/**
 * Get read-only tool names from the registry
 */
export function getFilesReadOnlyToolNames(): string[] {
  return ['get_repository_tree', 'get_file_contents'];
}

/**
 * Get all tool definitions from the registry (for backward compatibility)
 */
export function getFilesToolDefinitions(): EnhancedToolDefinition[] {
  return Array.from(filesToolRegistry.values());
}

/**
 * Get filtered tools based on read-only mode
 */
export function getFilteredFilesTools(readOnlyMode: boolean = false): EnhancedToolDefinition[] {
  if (readOnlyMode) {
    const readOnlyNames = getFilesReadOnlyToolNames();
    return Array.from(filesToolRegistry.values()).filter((tool) =>
      readOnlyNames.includes(tool.name),
    );
  }
  return getFilesToolDefinitions();
}
