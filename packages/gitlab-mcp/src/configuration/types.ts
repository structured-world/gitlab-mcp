/**
 * Configuration model of a caller: the account's durable settings and the overrides of
 * the current MCP session. Both only narrow what the operator's configuration allows.
 */

import { z } from 'zod';

/** A project or group the caller works in. */
export const WorkingScopeSchema = z
  .object({
    type: z.enum(['project', 'group']),
    path: z.string().min(1),
    /** Group scopes: whether projects of subgroups belong to the scope. */
    includeSubgroups: z.boolean(),
  })
  .strict();
export type WorkingScope = z.infer<typeof WorkingScopeSchema>;

/**
 * Settings of one account, kept across restarts and shared by the account's sessions.
 * Absent fields take the operator's configuration.
 */
export const AccountSettingsSchema = z
  .object({
    /** Built-in or local preset applied to every session of the account. */
    preset: z.string().min(1).optional(),
    /** Only read tools, on top of whatever the operator and the preset allow. */
    readOnly: z.boolean().optional(),
    /** Tool groups (feature keys such as `wiki`, `pipelines`) the account switched off. */
    disabledToolGroups: z.array(z.string().min(1)).optional(),
    /** Default working scope of new sessions. */
    scope: WorkingScopeSchema.optional(),
  })
  .strict();
export type AccountSettings = z.infer<typeof AccountSettingsSchema>;

/** Stored settings of an account with the version of the last write. */
export interface AccountSettingsRecord {
  accountKey: string;
  settings: AccountSettings;
  /** Starts at 1 and grows with every write; compare-and-set writes name it. */
  version: number;
  updatedAt: number;
}
