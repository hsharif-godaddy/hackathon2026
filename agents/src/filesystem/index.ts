import { LocalFileSystemOperations } from './local.js';
import type { FileSystemOperations } from './types.js';

export { LocalFileSystemOperations } from './local.js';
export type { FileHandle, FileStats, FileSystemOperations } from './types.js';

export const defaultLocalFs: FileSystemOperations = new LocalFileSystemOperations();
