import * as z from 'zod';

const scope = z.object({
  type: z.enum(['project', 'group']),
  path: z.string(),
  additionalPaths: z.array(z.string()).optional(),
  includeSubgroups: z.boolean(),
  detected: z.boolean(),
});
const baseContext = z.object({
  host: z.string(),
  apiUrl: z.string(),
  profileName: z.string().optional(),
  presetName: z.string().optional(),
  readOnly: z.boolean(),
  scope: scope.optional(),
  oauthMode: z.boolean(),
});
const context = baseContext.extend({ initialContext: baseContext.optional() });
const preset = z.object({
  name: z.string(),
  description: z.string().optional(),
  readOnly: z.boolean(),
  isBuiltIn: z.boolean(),
  scope: z
    .object({
      project: z.string().optional(),
      group: z.string().optional(),
      namespace: z.string().optional(),
      projects: z.array(z.string()).optional(),
      groups: z.array(z.string()).optional(),
      includeSubgroups: z.boolean().optional(),
    })
    .optional(),
  features: z.record(z.string(), z.boolean()).optional(),
});
const profile = z.object({
  name: z.string(),
  host: z.string().optional(),
  authType: z.enum(['pat', 'oauth', 'cookie']).optional(),
  readOnly: z.boolean(),
  isBuiltIn: z.boolean(),
  isPreset: z.boolean(),
  description: z.string().optional(),
});
const switched = z.object({
  success: z.boolean(),
  previous: z.string().optional(),
  current: z.string(),
  message: z.string(),
});
const whoami = z.object({
  user: z
    .object({
      id: z.number(),
      username: z.string(),
      name: z.string(),
      email: z.string().optional(),
      avatarUrl: z.string().optional(),
      isAdmin: z.boolean().optional(),
      adminModeActive: z.boolean().optional(),
      state: z.string(),
    })
    .nullable(),
  token: z
    .object({
      type: z.enum([
        'personal_access_token',
        'project_access_token',
        'group_access_token',
        'oauth',
        'unknown',
      ]),
      name: z.string().nullable(),
      scopes: z.array(z.string()),
      expiresAt: z.string().nullable(),
      daysUntilExpiry: z.number().nullable(),
      isValid: z.boolean(),
      hasGraphQLAccess: z.boolean(),
      hasWriteAccess: z.boolean(),
    })
    .nullable(),
  server: z.object({
    host: z.string(),
    apiUrl: z.string(),
    version: z.string(),
    tier: z.enum(['free', 'premium', 'ultimate', 'unknown']),
    edition: z.enum(['EE', 'CE', 'unknown']),
    readOnlyMode: z.boolean(),
    oauthEnabled: z.boolean(),
  }),
  capabilities: z.object({
    canBrowse: z.boolean(),
    canManage: z.boolean(),
    canAccessGraphQL: z.boolean(),
    availableToolCount: z.number(),
    totalToolCount: z.number(),
    filteredByScopes: z.number(),
    filteredByReadOnly: z.number(),
    filteredByTier: z.number(),
    filteredByDeniedRegex: z.number(),
    filteredByActionDenial: z.number(),
    filteredByAdmin: z.number(),
  }),
  context: z.object({
    activePreset: z.string().nullable(),
    activeProfile: z.string().nullable(),
    scope: scope.nullable(),
  }),
  warnings: z.array(z.string()),
  recommendations: z.array(
    z.object({
      action: z.enum([
        'create_new_token',
        'add_scope',
        'enable_oauth',
        'contact_admin',
        'enable_admin_mode',
        'renew_token',
      ]),
      message: z.string(),
      url: z.string().optional(),
      priority: z.enum(['high', 'medium', 'low']),
    }),
  ),
  scopesRefreshed: z.boolean(),
});

/** Object-root discriminated outputs, including list actions, for MCP 2025-11-25. */
const success = z.discriminatedUnion('action', [
  z.object({ action: z.literal('show'), data: context }),
  z.object({ action: z.literal('list_presets'), data: z.array(preset) }),
  z.object({ action: z.literal('list_profiles'), data: z.array(profile) }),
  z.object({ action: z.literal('whoami'), data: whoami }),
  z.object({ action: z.literal('switch_preset'), data: switched }),
  z.object({ action: z.literal('switch_profile'), data: switched }),
  z.object({
    action: z.literal('set_scope'),
    data: z.object({ success: z.boolean(), scope, message: z.string() }),
  }),
  z.object({
    action: z.literal('reset'),
    data: z.object({ success: z.boolean(), message: z.string(), context }),
  }),
]);

// SDK clients validate structuredContent even on isError responses. Declare the
// server's error envelope too, so diagnostic failures remain consumable by clients.
const error = z.object({
  error: z.union([
    z.object({ error: z.string() }),
    z.looseObject({
      error_code: z.string(),
      tool: z.string(),
      action: z.string(),
      message: z.string(),
    }),
  ]),
});
export const ContextOutputSchema = z.union([success, error]);
