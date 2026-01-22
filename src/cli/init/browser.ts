/**
 * Browser utilities for init wizard
 */

type OpenModule = { default: (url: string) => Promise<unknown> };

/**
 * Dynamic import that works in CommonJS context for ESM-only packages.
 * TypeScript transpiles dynamic import() to require() in CommonJS mode,
 * so we use eval to preserve the actual import() call at runtime.
 */
async function dynamicImport(): Promise<OpenModule> {
  // Using indirect eval to preserve dynamic import in CommonJS output
  const importFn = (0, eval)("m => import(m)") as (m: string) => Promise<OpenModule>;
  return importFn("open");
}

/** Import function - can be replaced in tests */
let importOpen: () => Promise<OpenModule> = dynamicImport;

/**
 * Set custom import function (for testing)
 * @internal
 */
export function _setImportOpen(fn: () => Promise<OpenModule>): void {
  importOpen = fn;
}

/**
 * Reset to default import function (for testing cleanup)
 * @internal
 */
export function _resetImportOpen(): void {
  importOpen = dynamicImport;
}

/**
 * Open URL in browser using the ESM-only 'open' package.
 * Returns true if successful, false otherwise.
 */
export async function openUrl(url: string): Promise<boolean> {
  try {
    const openModule = await importOpen();
    await openModule.default(url);
    return true;
  } catch {
    return false;
  }
}
