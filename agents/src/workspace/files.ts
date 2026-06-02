export interface TreeEntry {
  path: string;
  kind: 'file' | 'directory';
  size: number;
  modifiedAt: string;
}

export interface TreeOptions {
  path?: string;
  recursive?: boolean;
  maxDepth?: number;
  includeGlobs?: string[];
  excludeGlobs?: string[];
}

export interface TreeResult {
  entries: TreeEntry[];
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
}
