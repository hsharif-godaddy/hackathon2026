import { join } from 'node:path';
import type { FileStore } from '../file-store.js';

/**
 * In-memory {@link FileStore} test double. Models the same path-keyed,
 * null-on-miss contract the real backends honour, so tests can inject it to
 * exercise persistence logic without touching disk or S3. `readdir` derives
 * immediate children from the flat key map, matching the bare-name semantics
 * the interface specifies.
 */
export class InMemoryFileStore implements FileStore {
  readonly backend = 'local' as const;
  readonly files = new Map<string, string>();

  async writeFile(path: string, data: string): Promise<void> {
    this.files.set(path, data);
  }

  async readFile(path: string): Promise<string | null> {
    return this.files.get(path) ?? null;
  }

  async readdir(path: string): Promise<string[] | null> {
    const prefix = path.endsWith('/') ? path : `${path}/`;
    const children = new Set<string>();
    let exists = false;
    for (const key of this.files.keys()) {
      if (key === path) exists = true;
      if (!key.startsWith(prefix)) continue;
      exists = true;
      const rest = key.slice(prefix.length);
      const slash = rest.indexOf('/');
      children.add(slash === -1 ? rest : rest.slice(0, slash));
    }
    if (!exists && this.dirs.has(path)) exists = true;
    return exists ? [...children] : null;
  }

  private readonly dirs = new Set<string>();

  async mkdir(path: string): Promise<void> {
    this.dirs.add(path);
  }

  locationFor(path: string): string {
    return path;
  }

  /** Convenience for assertions: did anything get written under this dir? */
  hasUnder(dir: string): boolean {
    const prefix = dir.endsWith('/') ? dir : `${dir}/`;
    return [...this.files.keys()].some((k) => k.startsWith(prefix));
  }

  /** Convenience: read by path segments. */
  get(...segments: string[]): string | null {
    return this.files.get(join(...segments)) ?? null;
  }
}
