import { readFile, readdir, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, resolve, relative } from 'path';
import matter from 'gray-matter';
import { MemoryEntry, MemoryFileFrontMatter } from '../types/memory.js';
import { FileEditTool, FileEditOptions } from '../tools/file-edit.js';
import { logger } from '../logging/index.js';

/**
 * Memory Service
 * 
 * Handles low-level file operations for the memory system including reading,
 * writing, and managing memory entries stored as markdown files with YAML front matter.
 */
export class MemoryService {
  private static readonly MEMORY_DIR = '.memory';
  private static readonly MAX_VALUE_SIZE = 100 * 1024;
  
  private fileEditTool: FileEditTool;

  constructor() {
    this.fileEditTool = new FileEditTool();
  }

  /**
   * Set a memory entry (create or update)
   * 
   * @param appPath - Path to the app directory
   * @param appId - App ID for context
   * @param key - Full key path (e.g., "app.title")
   * @param value - Value to store
   * @param metadata - Optional custom metadata
   * @returns The created/updated memory entry
   * @throws Error if key is invalid or value is too large
   */
  async set(
    appPath: string,
    appId: string,
    key: string,
    value: any,
    metadata?: Record<string, any>
  ): Promise<MemoryEntry> {
    this.validateKey(key);
    this.validateValue(value);

    const paths = this.buildMemoryPaths(appPath, key);
    await this.ensureMemoryDir(paths.memoryDir);

    const { namespace, keyName } = this.parseKey(key);

    const existingEntry = existsSync(paths.fullPath) 
      ? await this.readMemoryFile(paths.fullPath) 
      : null;

    const now = new Date().toISOString();
    const entry: MemoryEntry = {
      namespace,
      key: keyName,
      fullKey: key,
      value,
      type: this.getValueType(value),
      ...(metadata && { metadata }),
      createdAt: existingEntry?.createdAt || now,
      updatedAt: now,
    };

    const content = this.generateFileContent(entry);

    const result = await this.fileEditTool.editFile(
      appPath,
      {
        path: paths.relativePath,
        mode: existingEntry ? 'rewrite' : 'create',
        content,
        createDirs: true,
        autoCommit: true,
        commitMessage: `Update memory: ${key}`,
      },
      { appId }
    );

    if (!result.success) {
      throw new Error(`Failed to write memory file: ${result.error}`);
    }

    logger.info('memory.set.success', {
      appId,
      key,
      type: entry.type,
      isUpdate: !!existingEntry,
    });

    return entry;
  }

  /**
   * Get a memory entry by key
   * 
   * @param appPath - Path to the app directory
   * @param key - Full key path (e.g., "app.title")
   * @returns The memory entry or null if not found
   * @throws Error if key is invalid
   */
  async get(appPath: string, key: string): Promise<MemoryEntry | null> {
    this.validateKey(key);

    const paths = this.buildMemoryPaths(appPath, key);

    if (!existsSync(paths.fullPath)) {
      return null;
    }

    return this.readMemoryFile(paths.fullPath);
  }

  /**
   * Delete a memory entry
   * 
   * @param appPath - Path to the app directory
   * @param appId - App ID for context
   * @param key - Full key path (e.g., "app.title")
   * @returns true if deleted, false if not found
   * @throws Error if key is invalid or deletion fails
   */
  async delete(appPath: string, appId: string, key: string): Promise<boolean> {
    this.validateKey(key);

    const paths = this.buildMemoryPaths(appPath, key);

    if (!existsSync(paths.fullPath)) {
      return false;
    }

    const result = await this.fileEditTool.editFile(
      appPath,
      {
        path: paths.relativePath,
        mode: 'delete',
        autoCommit: true,
        commitMessage: `Delete memory: ${key}`,
      },
      { appId }
    );

    if (!result.success) {
      throw new Error(`Failed to delete memory file: ${result.error}`);
    }

    logger.info('memory.delete.success', {
      appId,
      key,
    });

    return true;
  }

  /**
   * List memory entries by prefix
   * 
   * @param appPath - Path to the app directory
   * @param prefix - Optional key prefix to filter by (e.g., "app")
   * @returns Array of matching memory entries
   */
  async list(appPath: string, prefix?: string): Promise<MemoryEntry[]> {
    const paths = this.buildMemoryPaths(appPath, '');

    if (!existsSync(paths.memoryDir)) {
      return [];
    }

    const files = await readdir(paths.memoryDir);
    const entries: MemoryEntry[] = [];

    for (const file of files) {
      if (!file.endsWith('.md')) {
        continue;
      }

      const fullPath = this.buildFullPathForFile(paths.memoryDir, file);
      const entry = await this.readMemoryFile(fullPath);

      if (prefix && !entry.fullKey.startsWith(prefix)) {
        continue;
      }

      entries.push(entry);
    }

    return entries.sort((a, b) => a.fullKey.localeCompare(b.fullKey));
  }

  /**
   * Batch get multiple memory entries
   * 
   * @param appPath - Path to the app directory
   * @param keys - Array of keys to retrieve
   * @returns Map of key to memory entry (missing keys are omitted)
   */
  async batchGet(appPath: string, keys: string[]): Promise<Record<string, MemoryEntry>> {
    const result: Record<string, MemoryEntry> = {};

    await Promise.all(
      keys.map(async (key) => {
        const entry = await this.get(appPath, key);
        if (entry) {
          result[key] = entry;
        }
      })
    );

    return result;
  }

  /**
   * Ensure memory directory exists
   * 
   * @param memoryDir - Path to memory directory
   */
  private async ensureMemoryDir(memoryDir: string): Promise<void> {
    if (!existsSync(memoryDir)) {
      await mkdir(memoryDir, { recursive: true });
      logger.info('memory.directory.created', {
        path: memoryDir,
      });
    }
  }

  /**
   * Read and parse a memory file
   * 
   * @param filePath - Full path to memory file
   * @returns Parsed memory entry
   * @throws Error if file cannot be parsed
   */
  private async readMemoryFile(filePath: string): Promise<MemoryEntry> {
    const content = await readFile(filePath, 'utf-8');
    const { data } = matter(content);

    const frontMatter = data as MemoryFileFrontMatter;

    return {
      namespace: frontMatter.namespace,
      key: frontMatter.key,
      fullKey: `${frontMatter.namespace}.${frontMatter.key}`,
      value: frontMatter.value,
      type: frontMatter.type as any,
      ...(frontMatter.metadata && { metadata: frontMatter.metadata }),
      createdAt: frontMatter.createdAt,
      updatedAt: frontMatter.updatedAt,
    };
  }

  /**
   * Generate markdown file content with YAML front matter
   * 
   * @param entry - Memory entry to serialize
   * @returns Markdown file content
   */
  private generateFileContent(entry: MemoryEntry): string {
    const frontMatter: MemoryFileFrontMatter = {
      namespace: entry.namespace,
      key: entry.key,
      value: entry.value,
      type: entry.type,
      ...(entry.metadata && { metadata: entry.metadata }),
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
    };

    const yamlContent = Object.entries(frontMatter)
      .filter(([_, value]) => value !== undefined)
      .map(([key, value]) => {
        if (typeof value === 'object') {
          return `${key}: ${JSON.stringify(value)}`;
        }
        return `${key}: ${JSON.stringify(value)}`;
      })
      .join('\n');

    const valueDisplay = typeof entry.value === 'string' 
      ? entry.value 
      : JSON.stringify(entry.value, null, 2);

    return `---
${yamlContent}
---

# ${entry.fullKey}

Current value: ${valueDisplay}

Last updated: ${entry.updatedAt}
`;
  }

  /**
   * Parse a key into namespace and key name
   * 
   * @param key - Full key path
   * @returns Namespace and key name
   */
  private parseKey(key: string): { namespace: string; keyName: string } {
    const lastDotIndex = key.lastIndexOf('.');
    
    if (lastDotIndex === -1) {
      throw new Error(`Invalid key format: ${key}. Keys must contain at least one dot (e.g., "namespace.key")`);
    }

    const namespace = key.substring(0, lastDotIndex);
    const keyName = key.substring(lastDotIndex + 1);

    return { namespace, keyName };
  }

  /**
   * Build all necessary file paths for a memory key
   * 
   * This is the centralized path manipulation helper to consolidate
   * all path operations and reduce semgrep warnings to a single location.
   * 
   * @param appPath - Base application directory path
   * @param key - Memory key (can be empty for directory-only operations)
   * @returns Object containing all relevant paths
   */
  private buildMemoryPaths(appPath: string, key: string): {
    memoryDir: string;
    fileName: string;
    relativePath: string;
    fullPath: string;
  } {
    const memoryDir = join(appPath, MemoryService.MEMORY_DIR);
    const fileName = key ? `${key.replace(/\//g, '_')}.md` : '';
    const relativePath = key ? join(MemoryService.MEMORY_DIR, fileName) : MemoryService.MEMORY_DIR;
    const fullPath = key ? join(memoryDir, fileName) : memoryDir;

    return {
      memoryDir,
      fileName,
      relativePath,
      fullPath,
    };
  }

  /**
   * Build full path for a file in the memory directory
   * 
   * @param memoryDir - Memory directory path
   * @param fileName - File name
   * @returns Full path to file
   */
  private buildFullPathForFile(memoryDir: string, fileName: string): string {
    return join(memoryDir, fileName);
  }

  /**
   * Get type of a value
   * 
   * @param value - Value to check
   * @returns Type string
   */
  private getValueType(value: any): MemoryEntry['type'] {
    if (value === null) {return 'null';}
    if (Array.isArray(value)) {return 'array';}
    return typeof value as MemoryEntry['type'];
  }

  /**
   * Validate a key format
   * 
   * @param key - Key to validate
   * @throws Error if key is invalid
   */
  private validateKey(key: string): void {
    if (!key || typeof key !== 'string') {
      throw new Error('Key must be a non-empty string');
    }

    if (!key.includes('.')) {
      throw new Error('Key must contain at least one dot (e.g., "namespace.key")');
    }

    if (key.includes('..') || key.startsWith('.') || key.endsWith('.')) {
      throw new Error('Key cannot have consecutive dots or start/end with dots');
    }

    if (key.includes('/') || key.includes('\\')) {
      throw new Error('Key cannot contain path separators');
    }

    if (key.includes(' ')) {
      throw new Error('Key cannot contain spaces');
    }

    if (!/^[a-zA-Z0-9._-]+$/.test(key)) {
      throw new Error('Key can only contain alphanumeric characters, dots, hyphens, and underscores');
    }
  }

  /**
   * Validate value size
   * 
   * @param value - Value to validate
   * @throws Error if value is too large
   */
  private validateValue(value: any): void {
    const serialized = JSON.stringify(value);
    
    if (serialized.length > MemoryService.MAX_VALUE_SIZE) {
      throw new Error(
        `Value size (${serialized.length} bytes) exceeds maximum allowed size (${MemoryService.MAX_VALUE_SIZE} bytes)`
      );
    }
  }
}
