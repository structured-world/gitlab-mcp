/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any */
import { GetRepositoryTreeSchema, GetFileContentsSchema } from './schema-readonly';
import { CreateOrUpdateFileSchema, PushFilesSchema, MarkdownUploadSchema } from './schema';

/**
 * Handler for get_file_contents tool - REAL GitLab API call
 */
export async function handleGetFileContents(args: unknown): Promise<unknown> {
  const options = GetFileContentsSchema.parse(args);
  const { project_id, file_path, ref } = options;

  const queryParams = new URLSearchParams();
  if (ref) {
    queryParams.set('ref', ref);
  }

  const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(project_id)}/repository/files/${encodeURIComponent(file_path)}?${queryParams}`;
  const response = await fetch(apiUrl, {
    headers: {
      Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
    },
  });

  if (!response.ok) {
    throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
  }

  const fileContent = await response.json();
  return fileContent;
}

/**
 * Handler for get_repository_tree tool - REAL GitLab API call
 */
export async function handleGetRepositoryTree(args: unknown): Promise<unknown> {
  const options = GetRepositoryTreeSchema.parse(args);
  const { project_id } = options;

  const queryParams = new URLSearchParams();
  Object.entries(options).forEach(([key, value]) => {
    if (value !== undefined && key !== 'project_id') {
      queryParams.set(key, String(value));
    }
  });

  const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(project_id)}/repository/tree?${queryParams}`;
  const response = await fetch(apiUrl, {
    headers: {
      Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
    },
  });

  if (!response.ok) {
    throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
  }

  const tree = await response.json();
  return tree;
}

/**
 * Handler for create_or_update_file tool - REAL GitLab API call
 */
export async function handleCreateOrUpdateFile(args: unknown): Promise<unknown> {
  const options = CreateOrUpdateFileSchema.parse(args);
  const { project_id, file_path } = options;

  const body = new URLSearchParams();
  Object.entries(options).forEach(([key, value]) => {
    if (value !== undefined && key !== 'project_id' && key !== 'file_path') {
      body.set(key, String(value));
    }
  });

  const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(project_id)}/repository/files/${encodeURIComponent(file_path)}`;
  const response = await fetch(apiUrl, {
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
}

/**
 * Handler for push_files tool - REAL GitLab API call
 */
export async function handlePushFiles(args: unknown): Promise<unknown> {
  const options = PushFilesSchema.parse(args);
  const { project_id } = options;

  const body: any = {
    branch: options.branch,
    commit_message: options.commit_message,
    actions: options.files.map((file) => ({
      action: 'create',
      file_path: file.file_path,
      content: file.content,
      encoding: file.encoding ?? 'text',
      execute_filemode: file.execute_filemode ?? false,
    })),
  };

  if (options.start_branch) {
    body.start_branch = options.start_branch;
  }
  if (options.author_email) {
    body.author_email = options.author_email;
  }
  if (options.author_name) {
    body.author_name = options.author_name;
  }

  const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(project_id)}/repository/commits`;
  const response = await fetch(apiUrl, {
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
}

/**
 * Handler for upload_markdown tool - REAL GitLab API call
 */
export async function handleUploadMarkdown(args: unknown): Promise<unknown> {
  const options = MarkdownUploadSchema.parse(args);
  const { project_id, file, filename } = options;

  const formData = new FormData();

  // Check if file is base64 encoded or a file path
  let fileBlob: Blob;
  if (file.startsWith('data:') || file.match(/^[A-Za-z0-9+/]+=*$/)) {
    // Base64 encoded content
    const base64Data = file.replace(/^data:[^;]+;base64,/, '');
    const binaryString = Buffer.from(base64Data, 'base64').toString('binary');
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    fileBlob = new Blob([bytes]);
  } else {
    // Assume it's text content
    fileBlob = new Blob([file], { type: 'text/plain' });
  }

  formData.append('file', fileBlob, filename);

  const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(project_id)}/uploads`;
  const response = await fetch(apiUrl, {
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
}
