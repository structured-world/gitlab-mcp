/**
 * Handlers for manage_context tool actions
 *
 * Each handler corresponds to an action in ManageContextSchema.
 */

import { getContextManager } from './context-manager';
import {
  ListPresetsInput,
  ManageContextInput,
  ResetContextInput,
  SetScopeInput,
  ShowContextInput,
  SwitchPresetInput,
  WhoamiInput,
} from './schema';
import {
  PresetInfo,
  ResetResult,
  SessionContext,
  SetScopeResult,
  SwitchResult,
  WhoamiResult,
} from './types';
import { executeWhoami } from './whoami';
import {
  AccountChangeResult,
  AccountLinkResult,
  handleLinkAccount,
  handleListAccounts,
  handleSwitchAccount,
  handleUnlinkAccount,
} from './accounts';
import type { ChatAccount } from '../../accounts/chat-accounts';

/**
 * Handle show action - return current context
 */
export async function handleShowContext(_input: ShowContextInput): Promise<SessionContext> {
  const manager = getContextManager();
  return manager.getContext();
}

/**
 * Handle list_presets action - return available presets
 */
export async function handleListPresets(_input: ListPresetsInput): Promise<PresetInfo[]> {
  const manager = getContextManager();
  return manager.listPresets();
}

/**
 * Handle switch_preset action - change active preset
 */
export async function handleSwitchPreset(input: SwitchPresetInput): Promise<SwitchResult> {
  const manager = getContextManager();
  return manager.switchPreset(input.preset);
}

/**
 * Handle set_scope action - set namespace scope with auto-detection
 */
export async function handleSetScope(input: SetScopeInput): Promise<SetScopeResult> {
  const manager = getContextManager();
  return manager.setScope(input.namespace, input.includeSubgroups);
}

/**
 * Handle reset action - restore initial context
 */
export async function handleResetContext(_input: ResetContextInput): Promise<ResetResult> {
  const manager = getContextManager();
  return manager.reset();
}

/**
 * Handle whoami action - return authentication status and capabilities
 */
export async function handleWhoami(_input: WhoamiInput): Promise<WhoamiResult> {
  return executeWhoami();
}

/**
 * Main handler dispatcher for manage_context tool
 */
export async function handleManageContext(
  input: ManageContextInput,
): Promise<
  | SessionContext
  | PresetInfo[]
  | SwitchResult
  | SetScopeResult
  | ResetResult
  | WhoamiResult
  | ChatAccount[]
  | AccountChangeResult
  | AccountLinkResult
> {
  switch (input.action) {
    case 'show':
      return handleShowContext(input);
    case 'list_presets':
      return handleListPresets(input);
    case 'switch_preset':
      return handleSwitchPreset(input);
    case 'set_scope':
      return handleSetScope(input);
    case 'clear_scope':
      return getContextManager().clearScope();
    case 'reset':
      return handleResetContext(input);
    case 'whoami':
      return handleWhoami(input);
    case 'list_accounts':
      return handleListAccounts();
    case 'switch_account':
      return handleSwitchAccount(input);
    case 'link_account':
      return handleLinkAccount(input);
    case 'unlink_account':
      return handleUnlinkAccount(input);
    /* istanbul ignore next -- unreachable with Zod discriminatedUnion */
    default:
      throw new Error(`Unknown action: ${(input as { action: string }).action}`);
  }
}
