import { canonicalProjectPath } from './api-path';

/**
 * Smart project identifier that can be numeric ID or namespace path
 */
export interface ProjectIdentifier {
  /** The normalized project identifier for API calls */
  identifier: string;
  /** Whether this is a numeric ID (true) or namespace path (false) */
  isNumericId: boolean;
  /** Original input value */
  originalValue: string;
}

/**
 * Detects if a string is a numeric ID
 */
function isNumericId(str: string): boolean {
  return /^\d+$/.test(str.trim());
}

/**
 * Smart processing of project identifier that handles:
 * - Numeric IDs: "123" -> stays as "123"
 * - URL-encoded paths: decoded once, then encoded as one API segment
 * - Regular paths: "group/project" -> converts to "group%2Fproject"
 * - Dot segments and ambiguous encodings are rejected before any request
 */
export function processProjectIdentifier(input: string): ProjectIdentifier {
  const trimmedInput = canonicalProjectPath(input);

  // Check if it's a numeric ID
  if (isNumericId(trimmedInput)) {
    return {
      identifier: trimmedInput,
      isNumericId: true,
      originalValue: input,
    };
  }

  // For namespace paths, we need to ensure proper encoding for GitLab API
  const identifier = encodeURIComponent(trimmedInput);

  return {
    identifier,
    isNumericId: false,
    originalValue: input,
  };
}

/**
 * Canonical API segment for a project identifier supplied raw or URL-encoded.
 */
export function safeEncodeProjectId(projectId: string): string {
  const processed = processProjectIdentifier(projectId);
  return processed.identifier;
}

/**
 * Normalize project identifier for API calls
 * Ensures the identifier is properly formatted for GitLab REST API
 */
export function normalizeProjectId(projectId: string): string {
  return safeEncodeProjectId(projectId);
}

/**
 * Validate project identifier format
 * Returns error message if invalid, null if valid
 */
export function validateProjectIdentifier(input: string): string | null {
  if (!input || typeof input !== 'string') {
    return 'Project identifier is required and must be a string';
  }

  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return 'Project identifier cannot be empty';
  }

  // Check if it's numeric ID
  if (isNumericId(trimmed)) {
    return null; // Valid numeric ID
  }

  // Check if it's a valid namespace path (with or without encoding)
  let decoded: string;
  try {
    decoded = canonicalProjectPath(trimmed);
  } catch {
    return 'Invalid project identifier format. Use numeric ID or namespace/project path.';
  }

  // Basic validation for namespace/project format
  if (!/^[a-zA-Z0-9\-_./]+$/.test(decoded)) {
    return 'Invalid project identifier format. Use numeric ID or namespace/project path.';
  }

  return null; // Valid
}
