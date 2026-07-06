import type { Readable } from 'node:stream';

const DEFAULT_MAX_BUFFER_BYTES: number = 10 * 1024 * 1024; // 10 MB

/** Collect a Readable stream into a single Buffer (unbounded). */
export async function collectBuffer(stream: Readable): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk: Buffer) => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

/**
 * Collect a download stream into a Buffer, bounded by contentLength check
 * (default cap 10 MB). Rejects before reading if the file exceeds the limit.
 */
export async function collectBoundedBuffer(
  stream: Readable,
  contentLength: number,
  maxBytes: number = DEFAULT_MAX_BUFFER_BYTES,
): Promise<Buffer> {
  if (contentLength > maxBytes) {
    stream.destroy();
    throw new Error(`File too large to buffer (${contentLength} bytes, max ${maxBytes})`);
  }
  return collectBuffer(stream);
}

/**
 * Named storage root resolved server-side. The agent selects a root by name;
 * the server maps it to an absolute path and confines operations within it.
 * Omitting defaults to 'app' (the primary app source directory).
 * Keep in sync with StorageRootName in dev-supervisor/internal/sandbox/roots.go.
 */
export type StorageRoot = 'app' | 'public-assets' | 'private';

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
  root?: StorageRoot;
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
  root?: StorageRoot;
  path: string;
  offset?: number;
  limit?: number;
}

export interface ViewResult {
  path: string;
  /** Pre-formatted content with line numbers (format: "%Nd|line"). */
  content: string;
  /** Total number of lines in the file. */
  lines: number;
  /** File size in bytes. */
  size: number;
  /** True when the response was capped by the line limit. */
  truncated: boolean;
}

export interface SearchOptions {
  root?: StorageRoot;
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
  root?: StorageRoot;
  path: string;
  content: string;
  encoding?: 'utf-8' | 'base64';
  createOnly?: boolean;
}

export interface WriteResult {
  bytesWritten: number;
}

export interface EditOptions {
  root?: StorageRoot;
  path: string;
  oldString: string;
  newString: string;
  replaceAll?: boolean;
}

export interface EditResult {
  applied: number;
}

export interface InsertOptions {
  root?: StorageRoot;
  path: string;
  line: number;
  content: string;
}

export interface InsertResult {
  lines: number;
}

export interface DeleteOptions {
  root?: StorageRoot;
  path: string;
  recursive?: boolean;
}

export interface MoveOptions {
  root?: StorageRoot;
  from: string;
  to: string;
}

export interface FileUploadOptions {
  root?: StorageRoot;
  path: string;
  data: Readable | Buffer | Uint8Array | string;
  /** Fail with 409 if the file already exists. */
  createOnly?: boolean;
  /** Total byte length of the upload. Set when data is a Readable and the size is known upfront. */
  contentLength?: number;
}

export interface ReadTextOptions {
  root?: StorageRoot;
  path: string;
}

export interface DownloadOptions {
  root?: StorageRoot;
  path: string;
}

export interface DownloadResult {
  stream: Readable;
  contentType: string;
  contentLength: number;
}

export interface ArchiveOptions {
  root?: StorageRoot;
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
  root?: StorageRoot;
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
  /**
   * Agentic file view with line numbering and windowing. Returns pre-formatted
   * content with line numbers (format: "%Nd|line"). Use for AI tool responses.
   * For system/internal reads without agentic constraints, use readText().
   */
  view(options: ViewOptions): Promise<ViewResult>;
  search(options: SearchOptions): Promise<SearchMatch[]>;
  write(options: WriteOptions): Promise<WriteResult>;
  edit(options: EditOptions): Promise<EditResult>;
  insert(options: InsertOptions): Promise<InsertResult>;
  delete(options: DeleteOptions): Promise<void>;
  move(options: MoveOptions): Promise<void>;
  upload(options: FileUploadOptions): Promise<WriteResult>;
  /**
   * Read a text file's full content as a UTF-8 string. No line numbering,
   * no windowing, no agentic guardrails. For system/internal code that needs
   * file content directly. Uses the streaming download endpoint under the hood.
   */
  readText(options: ReadTextOptions): Promise<string>;
  /**
   * Stream raw file content from the workspace. Returns a Readable stream —
   * callers that need full content in memory should collect it; callers that
   * can pipe (media serving) avoid heap pressure entirely.
   */
  download(options: DownloadOptions): Promise<DownloadResult>;
  /**
   * Stream a zip of the given dirs/files, assembled server-side.
   */
  archive(options: ArchiveOptions): Promise<ArchiveResult>;
}
