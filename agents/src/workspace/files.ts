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

export interface WorkspaceFiles {
  tree(options?: TreeOptions): Promise<TreeResult>;
  view(options: ViewOptions): Promise<ViewResult>;
  search(options: SearchOptions): Promise<SearchMatch[]>;
  write(options: WriteOptions): Promise<WriteResult>;
  edit(options: EditOptions): Promise<EditResult>;
  delete(options: DeleteOptions): Promise<void>;
  move(options: MoveOptions): Promise<void>;
  upload(options: FileUploadOptions): Promise<WriteResult>;
}
