import * as fs from 'node:fs';

/**
 * Flush a directory entry change (a rename into it) to disk, so the replaced file
 * survives a crash. Windows has no directory fsync; NTFS journals the rename.
 */
export async function syncDirectory(dir: string): Promise<void> {
  if (process.platform === 'win32') return;
  const handle = await fs.promises.open(dir, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}
