import matter from 'gray-matter';
import { MemoryEntry, MemoryFileFrontMatter } from '../types/memory.js';
import { createForWorkspace } from '../workspace/index.js';
import { DevSupervisorError } from './DevSupervisorClient.js';
import { logger } from '../logging/index.js';
import type { WorkspaceFiles } from '../workspace/files.js';

export class MemoryService {
  private static readonly MEMORY_DIR = '.memory';
  private static readonly MAX_VALUE_SIZE = 100 * 1024;

  private getWorkspaceFiles(appId: string): WorkspaceFiles {
    const workspace = createForWorkspace(appId, 'preview');
    if (!workspace) {
      throw new Error(`Workspace not available for app ${appId}`);
    }
    return workspace.files;
  }

  async set(
    appId: string,
    key: string,
    value: any,
    metadata?: Record<string, any>
  ): Promise<MemoryEntry> {
    this.validateKey(key);
    this.validateValue(value);

    const files = this.getWorkspaceFiles(appId);
    const relativePath = this.buildRelativePath(key);
    const { namespace, keyName } = this.parseKey(key);

    let existingEntry: MemoryEntry | null = null;
    try {
      const result = await files.view({ path: relativePath });
      existingEntry = this.parseMemoryContent(result.content);
    } catch (err: unknown) {
      if (!(err instanceof DevSupervisorError && err.code === 'not_found')) {
        logger.warn('memory.set.read_existing_error', { appId, key, error: err instanceof Error ? err.message : String(err) });
      }
    }

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
    await files.write({ path: relativePath, content });

    logger.info('memory.set.success', {
      appId,
      key,
      type: entry.type,
      isUpdate: !!existingEntry,
    });

    return entry;
  }

  async get(appId: string, key: string): Promise<MemoryEntry | null> {
    this.validateKey(key);

    const files = this.getWorkspaceFiles(appId);
    const relativePath = this.buildRelativePath(key);

    try {
      const result = await files.view({ path: relativePath });
      return this.parseMemoryContent(result.content);
    } catch (err: unknown) {
      if (err instanceof DevSupervisorError && err.code === 'not_found') return null;
      logger.warn('memory.get.read_error', { appId, key, error: err instanceof Error ? err.message : String(err) });
      return null;
    }
  }

  async delete(appId: string, key: string): Promise<boolean> {
    this.validateKey(key);

    const files = this.getWorkspaceFiles(appId);
    const relativePath = this.buildRelativePath(key);

    try {
      await files.delete({ path: relativePath });
      logger.info('memory.delete.success', { appId, key });
      return true;
    } catch (err: unknown) {
      if (err instanceof DevSupervisorError && err.code === 'not_found') return false;
      throw err;
    }
  }

  async list(appId: string, prefix?: string): Promise<MemoryEntry[]> {
    const files = this.getWorkspaceFiles(appId);

    let fileNames: string[];
    try {
      const treeResult = await files.tree({ path: MemoryService.MEMORY_DIR });
      fileNames = treeResult.entries
        .filter(e => e.kind === 'file' && e.path.endsWith('.md'))
        .map(e => e.path);
    } catch (err: unknown) {
      if (err instanceof DevSupervisorError && err.code === 'not_found') return [];
      throw err;
    }

    const entries: MemoryEntry[] = [];

    for (const filePath of fileNames) {
      try {
        const result = await files.view({ path: filePath });
        const entry = this.parseMemoryContent(result.content);

        if (prefix && !entry.fullKey.startsWith(prefix)) continue;
        entries.push(entry);
      } catch (err: unknown) {
        if (err instanceof DevSupervisorError && err.code === 'not_found') continue;
        throw err;
      }
    }

    return entries.sort((a, b) => a.fullKey.localeCompare(b.fullKey));
  }

  async batchGet(appId: string, keys: string[]): Promise<Record<string, MemoryEntry>> {
    const result: Record<string, MemoryEntry> = {};

    await Promise.all(
      keys.map(async (key) => {
        const entry = await this.get(appId, key);
        if (entry) {
          result[key] = entry;
        }
      })
    );

    return result;
  }

  private parseMemoryContent(content: string): MemoryEntry {
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

  private buildRelativePath(key: string): string {
    const fileName = `${key.replace(/\//g, '_')}.md`;
    return `${MemoryService.MEMORY_DIR}/${fileName}`;
  }

  private parseKey(key: string): { namespace: string; keyName: string } {
    const lastDotIndex = key.lastIndexOf('.');

    if (lastDotIndex === -1) {
      throw new Error(`Invalid key format: ${key}. Keys must contain at least one dot (e.g., "namespace.key")`);
    }

    const namespace = key.substring(0, lastDotIndex);
    const keyName = key.substring(lastDotIndex + 1);

    return { namespace, keyName };
  }

  private getValueType(value: any): MemoryEntry['type'] {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'array';
    return typeof value as MemoryEntry['type'];
  }

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

  private validateValue(value: any): void {
    const serialized = JSON.stringify(value);

    if (serialized.length > MemoryService.MAX_VALUE_SIZE) {
      throw new Error(
        `Value size (${serialized.length} bytes) exceeds maximum allowed size (${MemoryService.MAX_VALUE_SIZE} bytes)`
      );
    }
  }
}
