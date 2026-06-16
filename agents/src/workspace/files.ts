import type { Readable } from 'node:stream';

/**
 * Single tree entry. `path` is **workspace-rooted** — i.e. relative to the
 * workspace root, with `TreeOptions.path` already joined in. A
 * `tree({ path: 'docs/ui-kit/primitives' })` call returns entries like
 * `{ path: 'docs/ui-kit/primitives/button.md' }`. Pass these paths straight
 * back into `view` / `download` / `stat` without re-prefixing.
 */
export interface TreeEntry {
  path: string;
  kind: 'file' | 'directory';
  size: number;
  modifiedAt: string;
}

export interface TreeOptions {
  /**
   * Workspace-relative directory to walk. Empty / omitted = workspace root.
   * Returned `TreeEntry.path` values are workspace-rooted (this prefix is
   * joined in by the server) — see `TreeEntry`.
   */
  path?: string;
  recursive?: boolean;
  maxDepth?: number;
  /**
   * Restrict emitted entries to one kind. Filtering happens server-side
   * before the entry cap. Directory descent is independent of the filter, so
   * both `'directory'` and `'file'` still walk into subdirectories to surface
   * nested matches.
   */
  kindFilter?: 'file' | 'directory';
  /**
   * Globs anchored by a slash-presence rule (as ripgrep `--glob` / minimatch
   * `matchBase` do — not full `.gitignore` semantics; no `!` negation or
   * trailing-slash dir-only). A pattern **without** a slash matches the
   * basename at any depth (`*.log`, `node_modules`); a pattern **with** a
   * slash is anchored to the workspace root and matched against the full path
   * (`src/legacy/**`). A leading globstar segment makes a slash pattern match
   * at any depth.
   */
  includeGlobs?: string[];
  /**
   * Same slash-presence anchoring as {@link TreeOptions.includeGlobs}. A
   * matched **directory is pruned** — not descended into — which covers both
   * a slash-free name (`node_modules`) and a subtree pattern (`build/**`, since
   * `**` matches zero segments so the directory itself matches). Excluding
   * either skips the whole subtree rather than walking it.
   */
  excludeGlobs?: string[];
}

export interface TreeResult {
  /**
   * Workspace-rooted tree entries (the request `path` is already joined in).
   * Pass straight back into `view` / `download` / `stat` without re-prefixing.
   */
  entries: TreeEntry[];
  /** True when the result was capped at the supervisor's max-entries limit. */
  truncated: boolean;
}

export interface ViewOptions {
  path: string;
  offset?: number;
  limit?: number;
}

export interface ViewResult {
  path: string;
  content: string;
  encoding: 'utf-8' | 'base64';
  lines: number;
  size: number;
  truncated: boolean;
}

export interface SearchOptions {
  pattern: string;
  path?: string;
  caseSensitive?: boolean;
  maxResults?: number;
  includeGlobs?: string[];
  excludeGlobs?: string[];
}

export interface SearchMatch {
  path: string;
  line: number;
  column: number;
  preview: string;
}

export interface WriteOptions {
  path: string;
  content: string;
  encoding?: 'utf-8' | 'base64';
  createOnly?: boolean;
}

export interface WriteResult {
  bytesWritten: number;
}

export interface EditOptions {
  path: string;
  oldString: string;
  newString: string;
  replaceAll?: boolean;
}

export interface EditResult {
  applied: number;
}

export interface InsertOptions {
  path: string;
  line: number;
  content: string;
}

export interface InsertResult {
  lines: number;
}

export interface DeleteOptions {
  path: string;
  recursive?: boolean;
}

export interface MoveOptions {
  from: string;
  to: string;
}

export interface FileUploadOptions {
  path: string;
  data: Buffer | Uint8Array;
}

export interface DownloadOptions {
  path: string;
}

export interface DownloadResult {
  data: Buffer;
  contentType: string;
}

export interface ArchiveOptions {
  /** Workspace-relative directories to walk recursively. Missing dirs are skipped. */
  dirs?: string[];
  /** Workspace-relative files to include. Missing files are skipped. */
  files?: string[];
  /** Top-level folder name inside the zip (e.g. entries become `<prefix>/src/x.ts`). */
  prefix?: string;
}

export interface ArchiveResult {
  /** Raw zip byte stream. Pipe straight to an HTTP response. */
  stream: Readable;
  contentType: string;
}

export interface StatOptions {
  paths: string[];
}

/**
 * Successful stat() entry — file or directory metadata.
 *
 * Use `'error' in entry` (or check `entry.error`) before reading the metadata
 * fields; failure entries set `error` and leave Kind/Size/ModifiedAt empty.
 */
export interface StatEntryFound {
  path: string;
  kind: 'file' | 'directory';
  /** Size in bytes (omitted for directories — Go server returns 0). */
  size: number;
  modifiedAt: string;
  error?: never;
}

/** Failure entry — set when the path could not be resolved or stat'd. */
export interface StatEntryError {
  path: string;
  error: 'not_found' | 'permission_denied' | 'invalid_path';
  kind?: never;
  size?: never;
  modifiedAt?: never;
}

export type StatEntry = StatEntryFound | StatEntryError;

export interface StatResult {
  entries: StatEntry[];
}

export interface WorkspaceFiles {
  tree(options?: TreeOptions): Promise<TreeResult>;
  /**
   * Cheap multi-path metadata lookup. Each path resolves independently —
   * a missing path produces an inline `{ path, error: 'not_found' }` entry
   * rather than failing the whole call. Use this instead of `tree()` for
   * existence checks (no directory walk) and instead of `view({ limit: 1 })`
   * for stat-only probes (no file read or base64 round-trip).
   */
  stat(options: StatOptions): Promise<StatResult>;
  view(options: ViewOptions): Promise<ViewResult>;
  search(options: SearchOptions): Promise<SearchMatch[]>;
  write(options: WriteOptions): Promise<WriteResult>;
  edit(options: EditOptions): Promise<EditResult>;
  insert(options: InsertOptions): Promise<InsertResult>;
  delete(options: DeleteOptions): Promise<void>;
  move(options: MoveOptions): Promise<void>;
  upload(options: FileUploadOptions): Promise<WriteResult>;
  download(options: DownloadOptions): Promise<DownloadResult>;
  /**
   * Stream a zip of the given dirs/files, assembled server-side. Unlike
   * download(), there is no per-file size cap — use this for bulk export.
   */
  archive(options: ArchiveOptions): Promise<ArchiveResult>;
}
