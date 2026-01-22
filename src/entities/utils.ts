import { z } from "zod";

const DEFAULT_NULL = process.env.DEFAULT_NULL === "true";

/**
 * GitLab REST API default pagination value.
 * @see https://docs.gitlab.com/ee/api/rest/index.html#pagination
 */
export const GITLAB_DEFAULT_PER_PAGE = 20;

/**
 * Maximum items per page allowed by GitLab API.
 */
export const GITLAB_MAX_PER_PAGE = 100;

/**
 * Creates pagination fields for Zod schemas with dynamic descriptions.
 * The description automatically includes the default value.
 *
 * @param defaultPerPage - Default items per page (default: 20)
 * @param maxPerPage - Maximum items per page (default: 100)
 * @returns Object with page and per_page Zod fields
 *
 * @example
 * // In schema definition:
 * const ListSchema = z.object({
 *   action: z.literal("list"),
 *   ...paginationFields(),  // Uses GitLab defaults (20, max 100)
 * });
 *
 * @example
 * // With custom default:
 * const ListSchema = z.object({
 *   action: z.literal("list"),
 *   ...paginationFields(50),  // Default 50, max 100
 * });
 */
export function paginationFields(
  defaultPerPage: number = GITLAB_DEFAULT_PER_PAGE,
  maxPerPage: number = GITLAB_MAX_PER_PAGE
) {
  if (defaultPerPage > maxPerPage) {
    throw new Error(
      `Invalid pagination config: defaultPerPage (${defaultPerPage}) cannot exceed maxPerPage (${maxPerPage})`
    );
  }
  return {
    per_page: z
      .number()
      .int()
      .min(1)
      .max(maxPerPage)
      .optional()
      .default(defaultPerPage)
      .describe(`Number of items per page (default: ${defaultPerPage}, max: ${maxPerPage})`),
    page: z.number().int().min(1).optional().describe("Page number"),
  };
}

export const flexibleBoolean = z.preprocess(val => {
  if (typeof val === "boolean") {
    return val;
  }
  let result = "false";
  try {
    result = String(val).toLowerCase();
  } catch {
    return false;
  }
  return ["true", "t", "1"].includes(result);
}, z.boolean());

export const flexibleBooleanNullable = DEFAULT_NULL
  ? flexibleBoolean.nullable().default(null)
  : flexibleBoolean.nullable();

/**
 * Required ID field that accepts string or number input.
 * Unlike z.coerce.string(), this properly rejects undefined/null values
 * instead of coercing them to the literal string "undefined"/"null".
 */
export const requiredId = z.preprocess(val => val ?? "", z.coerce.string().min(1));

/**
 * Asserts that a value is defined (not undefined).
 * Used for fields validated by Zod .refine() where TypeScript cannot
 * automatically narrow the type after runtime validation.
 *
 * Note: This intentionally only checks for undefined, not empty strings.
 * Empty string validation is handled by Zod schema .refine() checks which
 * run during Schema.parse(args) BEFORE handler code executes. This function
 * exists solely for TypeScript type narrowing after validation passes.
 *
 * @param value - The value to assert
 * @param fieldName - Name of the field for error messages
 * @throws Error if value is undefined
 */
export function assertDefined<T>(value: T | undefined, fieldName: string): asserts value is T {
  if (value === undefined) {
    throw new Error(`${fieldName} is required but was not provided`);
  }
}

/**
 * Validates that the appropriate ID field is provided based on scope.
 * Used by webhook schemas to ensure projectId or groupId is present.
 *
 * @param data - Object containing scope, projectId, and groupId fields
 * @returns true if validation passes
 */
export function validateScopeId(data: {
  scope: "project" | "group";
  projectId?: string;
  groupId?: string;
}): boolean {
  if (data.scope === "project") {
    return !!data.projectId;
  }
  if (data.scope === "group") {
    return !!data.groupId;
  }
  return true;
}
