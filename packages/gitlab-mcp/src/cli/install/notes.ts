import { InstallResult } from './types';

/** Prints what the user must still act on after an install attempt. */
export function printNotes(result: InstallResult, print: (line: string) => void): void {
  for (const note of result.notes ?? []) print(`    ! ${note}`);
}
