import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import type { Readable, Writable } from 'node:stream';
import type { FileHandle, FileStats, FileSystemOperations, OpenFlag } from './types.js';

class LocalFileHandle implements FileHandle {
  constructor(private readonly handle: fsp.FileHandle) {}

  async read(
    buffer: Buffer,
    offset: number,
    length: number,
    position: number
  ): Promise<{ bytesRead: number }> {
    const result = await this.handle.read(buffer, offset, length, position);
    return { bytesRead: result.bytesRead };
  }

  async close(): Promise<void> {
    await this.handle.close();
  }
}

export class LocalFileSystemOperations implements FileSystemOperations {
  readFile(path: string, encoding: BufferEncoding): Promise<string>;
  readFile(path: string): Promise<Buffer>;
  async readFile(path: string, encoding?: BufferEncoding): Promise<string | Buffer> {
    if (encoding) {
      return fsp.readFile(path, encoding);
    }
    return fsp.readFile(path);
  }

  async writeFile(path: string, content: string | Buffer, encoding?: BufferEncoding): Promise<void> {
    await fsp.writeFile(path, content, encoding ? { encoding } : undefined);
  }

  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    await fsp.mkdir(path, options);
  }

  async readdir(path: string): Promise<string[]> {
    return fsp.readdir(path);
  }

  async stat(path: string): Promise<FileStats> {
    return fsp.stat(path);
  }

  async access(path: string): Promise<void> {
    await fsp.access(path);
  }

  async unlink(path: string): Promise<void> {
    await fsp.unlink(path);
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    await fsp.rename(oldPath, newPath);
  }

  async exists(path: string): Promise<boolean> {
    try {
      await fsp.access(path);
      return true;
    } catch (err) {
      // Only ENOENT means "does not exist". Permission errors (EACCES/EPERM) and
      // other I/O errors should surface — otherwise a permission problem looks
      // identical to a missing file to every caller.
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw err;
    }
  }

  async open(path: string, flags: OpenFlag): Promise<FileHandle> {
    const handle = await fsp.open(path, flags);
    return new LocalFileHandle(handle);
  }

  createReadStream(path: string): Readable {
    return fs.createReadStream(path);
  }

  createWriteStream(path: string): Writable {
    return fs.createWriteStream(path);
  }
}
