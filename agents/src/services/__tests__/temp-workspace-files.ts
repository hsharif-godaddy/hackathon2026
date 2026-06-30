/**
 * A real-filesystem-backed `WorkspaceFiles` test double rooted at a temp dir.
 *
 * The conform path touches customer files through the Workspace API while
 * `scaffoldContent` writes content files through `node:fs` at
 * `path.join(appPath, 'src/content')`. Rooting this double at the SAME temp
 * `appPath` makes both hit the same files on disk — which is exactly the
 * runtime coexistence the conform relies on (API confines to `/app`, scaffold
 * writes to `/app`). That lets the tests prove snapshot/restore is byte-exact
 * across the two mechanisms.
 *
 * Only the methods the conform uses are implemented (`stat`, `view`, `write`,
 * `delete`); the rest throw so an accidental new dependency surfaces loudly.
 */

import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';

import type { CreateForWorkspace, WorkspaceClient } from '../../workspace/client.js';
import type {
  ArchiveOptions,
  ArchiveResult,
  DeleteOptions,
  DownloadOptions,
  DownloadResult,
  EditOptions,
  EditResult,
  FileUploadOptions,
  InsertOptions,
  InsertResult,
  MoveOptions,
  SearchMatch,
  SearchOptions,
  StatOptions,
  StatResult,
  TreeOptions,
  TreeResult,
  ViewOptions,
  ViewResult,
  WorkspaceFiles,
  WriteOptions,
  WriteResult,
} from '../../workspace/files.js';

function unsupported(method: string): never {
  throw new Error(`TempWorkspaceFiles: ${method} not implemented in test double`);
}

export class TempWorkspaceFiles implements WorkspaceFiles {
  constructor(private readonly root: string) {}

  private abs(relPath: string): string {
    return join(this.root, relPath);
  }

  async stat(options: StatOptions): Promise<StatResult> {
    const entries = await Promise.all(
      options.paths.map(async (p: string) => {
        try {
          const s = await fs.stat(this.abs(p));
          return {
            path: p,
            kind: s.isDirectory() ? ('directory' as const) : ('file' as const),
            size: s.size,
            modifiedAt: s.mtime.toISOString(),
          };
        } catch {
          return { path: p, error: 'not_found' as const };
        }
      }),
    );
    return { entries };
  }

  async view(options: ViewOptions): Promise<ViewResult> {
    const content: string = await fs.readFile(this.abs(options.path), 'utf8');
    return {
      path: options.path,
      content,
      encoding: 'utf-8',
      lines: content.split('\n').length,
      size: Buffer.byteLength(content),
      truncated: false,
    };
  }

  async write(options: WriteOptions): Promise<WriteResult> {
    const abs: string = this.abs(options.path);
    await fs.mkdir(dirname(abs), { recursive: true });
    // Atomic (tmp + same-dir rename), mirroring the supervisor's write contract.
    const tmp: string = `${abs}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
    await fs.writeFile(tmp, options.content, 'utf8');
    await fs.rename(tmp, abs);
    return { bytesWritten: Buffer.byteLength(options.content) };
  }

  async delete(options: DeleteOptions): Promise<void> {
    await fs.rm(this.abs(options.path), { recursive: options.recursive ?? false, force: false });
  }

  // ── Unused by the conform path ──────────────────────────────────────────────
  tree(_options?: TreeOptions): Promise<TreeResult> {
    return unsupported('tree');
  }
  search(_options: SearchOptions): Promise<SearchMatch[]> {
    return unsupported('search');
  }
  edit(_options: EditOptions): Promise<EditResult> {
    return unsupported('edit');
  }
  insert(_options: InsertOptions): Promise<InsertResult> {
    return unsupported('insert');
  }
  move(_options: MoveOptions): Promise<void> {
    return unsupported('move');
  }
  upload(_options: FileUploadOptions): Promise<WriteResult> {
    return unsupported('upload');
  }
  download(_options: DownloadOptions): Promise<DownloadResult> {
    return unsupported('download');
  }
  archive(_options: ArchiveOptions): Promise<ArchiveResult> {
    return unsupported('archive');
  }
}

/**
 * A `CreateForWorkspace` factory that binds every workspace id to a
 * `TempWorkspaceFiles` rooted at `root`. Only `.files` is real; the other
 * namespaces throw if touched (the conform never reaches them).
 */
export function tempWorkspaceFactory(root: string): CreateForWorkspace {
  const files: WorkspaceFiles = new TempWorkspaceFiles(root);
  return (): WorkspaceClient => {
    return new Proxy(
      { workspaceId: 'test', variant: 'preview', files } as unknown as WorkspaceClient,
      {
        get(target: WorkspaceClient, prop: string | symbol): unknown {
          if (prop in target) return (target as unknown as Record<string | symbol, unknown>)[prop];
          throw new Error(`TempWorkspaceClient: ${String(prop)} not implemented`);
        },
      },
    );
  };
}
