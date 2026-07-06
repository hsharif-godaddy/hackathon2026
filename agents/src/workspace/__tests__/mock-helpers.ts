/**
 * Test helpers for workspace-related mocks.
 *
 * Provides factory functions for creating RunCommandResult objects with
 * sensible defaults, and a Map-backed WorkspaceFiles mock that implements
 * the full interface with real in-memory file semantics.
 */

import { Readable } from 'node:stream';

import { vi } from 'vitest';

import { DevSupervisorError } from '../../services/DevSupervisorClient.js';
import { collectBuffer } from '../files.js';
import type {
  DeleteOptions,
  DownloadOptions,
  DownloadResult,
  EditOptions,
  EditResult,
  InsertOptions,
  InsertResult,
  MoveOptions,
  ReadTextOptions,
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
} from '../files.js';
import type { RunCommandResult } from '../tasks.js';

export { createStubWorkspaceFiles } from './test-workspace-files.js';

/**
 * Create a RunCommandResult with defaults for a successful command.
 * Override any field via the partial parameter.
 */
export function makeRunCommandResult(overrides: Partial<RunCommandResult> = {}): RunCommandResult {
  return {
    taskId: 't',
    exitCode: 0,
    stdout: '',
    stderr: '',
    timedOut: false,
    executionTimeMs: 1,
    ...overrides,
  };
}

export interface MockWorkspaceFiles {
  store: Map<string, string>;
  files: WorkspaceFiles;
  spies: { [K in keyof WorkspaceFiles]: ReturnType<typeof vi.fn> };
}

/**
 * Create a Map-backed WorkspaceFiles mock with all 13 methods implemented.
 * Methods that read/write use the in-memory store; methods that don't have
 * obvious in-memory semantics (archive, download) return minimal defaults.
 * All methods are wrapped in vi.fn() for spy assertions.
 */
export function createMockWorkspaceFiles(seed: Record<string, string> = {}): MockWorkspaceFiles {
  const store: Map<string, string> = new Map(Object.entries(seed));

  function getOrThrow(path: string): string {
    const content: string | undefined = store.get(path);
    if (content === undefined) {
      throw new DevSupervisorError('not_found', 404, `${path}: no such file`);
    }
    return content;
  }

  const tree = vi.fn(async (_options?: TreeOptions): Promise<TreeResult> => {
    const entries = [...store.keys()].map((path: string) => ({
      path,
      kind: 'file' as const,
      size: Buffer.byteLength(store.get(path)!),
      modifiedAt: new Date().toISOString(),
    }));
    return { entries, truncated: false };
  });

  const stat = vi.fn(async (options: StatOptions): Promise<StatResult> => {
    const entries = options.paths.map((p: string) => {
      if (store.has(p)) {
        return { path: p, kind: 'file' as const, size: Buffer.byteLength(store.get(p)!), modifiedAt: new Date().toISOString() };
      }
      return { path: p, error: 'not_found' as const };
    });
    return { entries };
  });

  const view = vi.fn(async (options: ViewOptions): Promise<ViewResult> => {
    const content: string = getOrThrow(options.path);
    return {
      path: options.path,
      content,
      lines: content.split('\n').length,
      size: Buffer.byteLength(content),
      truncated: false,
    };
  });

  const search = vi.fn(async (options: SearchOptions): Promise<SearchMatch[]> => {
    const matches: SearchMatch[] = [];
    for (const [path, content] of store) {
      const lines: string[] = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const idx: number = lines[i]!.indexOf(options.pattern);
        if (idx !== -1) {
          matches.push({ path, line: i + 1, column: idx + 1, preview: lines[i]! });
        }
      }
    }
    return matches;
  });

  const write = vi.fn(async (options: WriteOptions): Promise<WriteResult> => {
    if (options.createOnly && store.has(options.path)) {
      throw new DevSupervisorError('already_exists', 409, `${options.path}: file exists`);
    }
    store.set(options.path, options.content);
    return { bytesWritten: Buffer.byteLength(options.content) };
  });

  const edit = vi.fn(async (options: EditOptions): Promise<EditResult> => {
    const content: string = getOrThrow(options.path);
    const replaced: string = options.replaceAll
      ? content.replaceAll(options.oldString, options.newString)
      : content.replace(options.oldString, options.newString);
    if (replaced === content) return { applied: 0 };
    store.set(options.path, replaced);
    const applied: number = options.replaceAll
      ? content.split(options.oldString).length - 1
      : 1;
    return { applied };
  });

  const insert = vi.fn(async (options: InsertOptions): Promise<InsertResult> => {
    const content: string = getOrThrow(options.path);
    const lines: string[] = content.split('\n');
    const insertLines: string[] = options.content.split('\n');
    lines.splice(options.line, 0, ...insertLines);
    store.set(options.path, lines.join('\n'));
    return { lines: lines.length };
  });

  const del = vi.fn(async (options: DeleteOptions): Promise<void> => {
    getOrThrow(options.path);
    store.delete(options.path);
  });

  const move = vi.fn(async (options: MoveOptions): Promise<void> => {
    const content: string = getOrThrow(options.from);
    store.delete(options.from);
    store.set(options.to, content);
  });

  const upload = vi.fn(async (options: { path: string; data: Readable | Buffer | Uint8Array | string }): Promise<WriteResult> => {
    let buf: Buffer;
    if (options.data instanceof Readable) {
      buf = await collectBuffer(options.data);
    } else if (typeof options.data === 'string') {
      buf = Buffer.from(options.data, 'utf-8');
    } else {
      buf = Buffer.from(options.data);
    }
    store.set(options.path, buf.toString('utf8'));
    return { bytesWritten: buf.length };
  });

  const readText = vi.fn(async (options: ReadTextOptions): Promise<string> => {
    return getOrThrow(options.path);
  });

  const download = vi.fn(async (options: DownloadOptions): Promise<DownloadResult> => {
    const content: string = getOrThrow(options.path);
    const buf: Buffer = Buffer.from(content, 'utf8');
    return {
      stream: Readable.from(buf),
      contentType: 'application/octet-stream',
      contentLength: buf.length,
    };
  });

  const archive = vi.fn(async (): Promise<{ stream: Readable; contentType: string }> => {
    return { stream: Readable.from(Buffer.alloc(0)), contentType: 'application/zip' };
  });

  const files: WorkspaceFiles = {
    tree,
    stat,
    view,
    search,
    write,
    edit,
    insert,
    delete: del,
    move,
    upload,
    readText,
    download,
    archive,
  } as unknown as WorkspaceFiles;

  return {
    store,
    files,
    spies: { tree, stat, view, search, write, edit, insert, delete: del, move, upload, readText, download, archive },
  };
}
