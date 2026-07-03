import {
  readFile,
  readdir,
  writeFile,
  mkdir,
} from 'node:fs/promises';
import type { FileStore } from './file-store.js';

/**
 * Filesystem-backed {@link FileStore} — the default backend, a thin wrapper
 * over `node:fs/promises` that preserves the exact behaviour the eval
 * persistence code relied on before the seam was introduced (notably:
 * ENOENT surfaces as `null`, not a throw).
 */
export class LocalFileStore implements FileStore {
  readonly backend = 'local' as const;

  async writeFile(path: string, data: string): Promise<void> {
    await writeFile(path, data);
  }

  async readFile(path: string): Promise<string | null> {
    try {
      return await readFile(path, 'utf-8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw err;
    }
  }

  async readdir(path: string): Promise<string[] | null> {
    try {
      return await readdir(path);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw err;
    }
  }

  async mkdir(path: string): Promise<void> {
    await mkdir(path, { recursive: true });
  }

  locationFor(path: string): string {
    // The local backend's "location" is just the path it was given.
    return path;
  }
}
