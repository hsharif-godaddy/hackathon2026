export interface DirectoryEntry {
  path: string;
  kind: 'file' | 'directory';
  size: number;
  modifiedAt: Date;
}

export interface TreeOptions {
  path?: string;
  recursive?: boolean;
  maxDepth?: number;
  includeGlobs?: string[];
  excludeGlobs?: string[];
}

export interface ViewOptions {
  path: string;
  range?: { startLine: number; endLine: number };
}

export interface ViewResult {
  path: string;
  content: string;
  encoding: 'utf-8' | 'base64';
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

export type FileEdit =
  | { op: 'create'; path: string; content: string; encoding?: 'utf-8' | 'base64' }
  | {
      op: 'replaceText';
      path: string;
      find: string;
      replace: string;
      occurrence?: number;
      expectedSha256?: string;
    }
  | {
      op: 'insertText';
      path: string;
      at:
        | { kind: 'lineColumn'; line: number; column?: number }
        | { kind: 'beforeText'; beforeText: string }
        | { kind: 'afterText'; afterText: string };
      text: string;
      expectedSha256?: string;
    }
  | { op: 'delete'; path: string; recursive?: boolean; expectedSha256?: string }
  | { op: 'move'; from: string; to: string; expectedSha256?: string };

export type FileEditErrorCode =
  | 'source-missing'
  | 'destination-exists'
  | 'sha-mismatch'
  | 'io';

interface FileEditOutcome {
  ok: boolean;
  error?: string;
  errorCode?: FileEditErrorCode;
  sha256?: string;
}

export type FileEditResult =
  | ({ op: 'create'; path: string } & FileEditOutcome)
  | ({ op: 'replaceText'; path: string } & FileEditOutcome)
  | ({ op: 'insertText'; path: string } & FileEditOutcome)
  | ({ op: 'delete'; path: string } & FileEditOutcome)
  | ({ op: 'move'; from: string; to: string } & FileEditOutcome);

export interface ApplyEditsOptions {
  edits: FileEdit[];
  expectedWorkspaceRevision?: string;
}

export interface ApplyEditsResponse {
  applied: number;
  results: FileEditResult[];
  workspaceRevision: string;
}

export interface WorkspaceFiles {
  tree(options?: TreeOptions): Promise<DirectoryEntry[]>;
  view(options: ViewOptions): Promise<ViewResult>;
  search(options: SearchOptions): Promise<SearchMatch[]>;
  applyEdits(options: ApplyEditsOptions): Promise<ApplyEditsResponse>;
}
