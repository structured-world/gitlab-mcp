/**
 * Flattens a position object into form-encoded fields with bracket notation.
 * GitLab API expects: position[base_sha]=xxx, position[head_sha]=xxx, etc.
 * NOT: position={"base_sha":"xxx","head_sha":"xxx"}
 *
 * @see https://docs.gitlab.com/ee/api/discussions.html#create-a-new-thread-in-the-merge-request-diff
 */
export function flattenPositionToFormFields(
  body: Record<string, unknown>,
  position: Record<string, unknown>,
): void {
  for (const [key, value] of Object.entries(position)) {
    if (value === undefined || value === null) continue;

    if (typeof value === 'object' && !Array.isArray(value)) {
      // Handle nested objects like line_range.start, line_range.end
      for (const [nestedKey, nestedValue] of Object.entries(value as Record<string, unknown>)) {
        if (nestedValue === undefined || nestedValue === null) continue;

        if (typeof nestedValue === 'object' && !Array.isArray(nestedValue)) {
          // Handle deeply nested (line_range.start.line_code, etc.)
          for (const [deepKey, deepValue] of Object.entries(
            nestedValue as Record<string, unknown>,
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
