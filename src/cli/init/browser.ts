/**
 * Browser utilities for init wizard
 */

/**
 * Dynamic import that works in CommonJS context for ESM-only packages.
 * TypeScript transpiles dynamic import() to require() in CommonJS mode,
 * so we use eval to preserve the actual import() call at runtime.
 */
async function dynamicImport<T>(moduleName: string): Promise<T> {
  // Using indirect eval to preserve dynamic import in CommonJS output
  const importFn = (0, eval)("m => import(m)") as (m: string) => Promise<T>;
  return importFn(moduleName);
}

/**
 * Open URL in browser using the ESM-only 'open' package.
 * Returns true if successful, false otherwise.
 */
export async function openUrl(url: string): Promise<boolean> {
  try {
    const openModule = await dynamicImport<{ default: (url: string) => Promise<unknown> }>("open");
    await openModule.default(url);
    return true;
  } catch {
    return false;
  }
}
