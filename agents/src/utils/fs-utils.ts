import { promises as fs } from 'node:fs';

/**
 * Atomic file write: write to a temp file in the same directory, then rename.
 * Rename within a directory is atomic on POSIX, so readers never see a
 * partially-written file. Temp file is cleaned up on rename failure.
 */
export async function atomicWrite(file: string, contents: string): Promise<void> {
  const tmp = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
  await fs.writeFile(tmp, contents, 'utf8');
  try {
    await fs.rename(tmp, file);
  } catch (err) {
    try { await fs.rm(tmp, { force: true }); } catch { /* best-effort cleanup */ }
    throw err;
  }
}

export async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    return false;
  }
}
