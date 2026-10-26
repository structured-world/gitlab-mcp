import type { EnhancedToolDefinition } from '../../types';

/** Remove credentials from owned project/group JSON, including nested projects and lists. */
export function stripProjectSecrets(data: unknown): unknown {
  const pending: unknown[] = [data];
  while (pending.length > 0) {
    const value = pending.pop();
    if (value === null || typeof value !== 'object') continue;
    const record = value as Record<string, unknown>;
    delete record.runners_token;
    delete record.import_url;
    for (const key in record) {
      if (!Object.hasOwn(record, key)) continue;
      const child = record[key];
      if (child !== null && typeof child === 'object') pending.push(child);
    }
  }
  return data;
}

/** Filter every successful metadata result after action-specific validation and augmentation. */
export function withSafeProjectResponse(
  handler: EnhancedToolDefinition['handler'],
): EnhancedToolDefinition['handler'] {
  return async (args) => stripProjectSecrets(await handler(args));
}
