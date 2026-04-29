import type { Readable, Writable } from 'node:stream';

export type OpenFlag = 'r' | 'r+' | 'w' | 'w+' | 'a' | 'a+';

export interface FileStats {
  size: number;
  isDirectory(): boolean;
  isFile(): boolean;
  /**
   * Modification time as a Date instance (not a string). Remote implementations
   * that deserialize HTTP/JSON responses must reconstruct this via `new Date(...)` —
   * structural typing will not catch a plain-string stub.
   */
  mtime: Date;
}

export interface FileHandle {
  read(
    buffer: Buffer,
    offset: number,
    length: number,
    position: number
  ): Promise<{ bytesRead: number }>;
  close(): Promise<void>;
}

export interface FileSystemOperations {
  readFile(path: string, encoding: BufferEncoding): Promise<string>;
  readFile(path: string): Promise<Buffer>;
  writeFile(path: string, content: string | Buffer, encoding?: BufferEncoding): Promise<void>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  readdir(path: string): Promise<string[]>;
  stat(path: string): Promise<FileStats>;
  access(path: string): Promise<void>;
  unlink(path: string): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
  /**
   * Resolves `false` only when the path does not exist (ENOENT). Permission
   * errors (EACCES/EPERM) and other I/O errors must propagate as rejections —
   * callers rely on this distinction to avoid treating a protected file as
   * missing (which would e.g. bypass the immutability guard).
   */
  exists(path: string): Promise<boolean>;
  open(path: string, flags: OpenFlag): Promise<FileHandle>;

  /** Optional streaming read. Callers must fall back to readFile when undefined. */
  createReadStream?(path: string): Readable;

  /** Optional streaming write. Callers must fall back to writeFile when undefined. */
  createWriteStream?(path: string): Writable;
}
