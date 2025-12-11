import type { CompressionStrategy, CompressionContext } from '../MessageCompressor.js';
import type { LLMMessage } from '../../ConversationHistoryLoader.js';
import { readFile, stat } from 'fs/promises';
import { existsSync } from 'fs';
import { logger } from '../../../logging/index.js';
import { estimateTokens } from '../../../utils/token-counter.js';
import { createSafePathBuilder } from '../../../utils/safe-path.js';
import { basename } from 'path';

interface HotFileMetrics {
  path: string;
  firstReadIndex: number;
  lastAccessTime: number;
  readCount: number;
  writeCount: number;
  score: number;
  content?: string;
  tokenCount?: number;
  fileSize?: number;
}

interface HotFileConfig {
  maxTokens: number;
  maxFileSize: number;
  recencyWindowMs: number;
  minReadCount: number;
  minWriteCount: number;
  recentFilesTokenBudget: number;
  recentFilesMessageWindow: number;
}

export class HotFileInclusionStrategy implements CompressionStrategy {
  readonly name = 'hot-file-inclusion';

  private fileMetrics = new Map<string, HotFileMetrics>();
  private hotFiles: HotFileMetrics[] = [];
  private appPath: string | undefined = undefined;
  private config: HotFileConfig;

  constructor(appPath?: string, config?: Partial<HotFileConfig>) {
    this.appPath = appPath;
    this.config = {
      maxTokens: 30000,
      maxFileSize: 1024 * 1024,
      recencyWindowMs: 10 * 60 * 1000,
      minReadCount: 1,
      minWriteCount: 1,
      recentFilesTokenBudget: 5000,
      recentFilesMessageWindow: 10,
      ...config,
    };
  }

  setAppPath(appPath: string): void {
    this.appPath = appPath;
  }

  analyzeMessages(messages: LLMMessage[]): void {
    this.fileMetrics.clear();
    this.hotFiles = [];

    const now = Date.now();
    const fileAccess = new Map<string, { reads: number[]; writes: number[] }>();

    for (let i = 0; i < messages.length; i++) {
      const message = messages[i];
      if (!message) continue;

      if (message.role === 'assistant' && message.tool_calls) {
        for (const toolCall of message.tool_calls) {
          try {
            const args = JSON.parse(toolCall.function.arguments);

            if (toolCall.function.name === 'readFile') {
              const filePath = args.path || args.file_path || args.filePath;
              if (!filePath) continue;

              if (!fileAccess.has(filePath)) {
                fileAccess.set(filePath, { reads: [], writes: [] });
              }
              fileAccess.get(filePath)!.reads.push(i);
            } else if (toolCall.function.name === 'fileEdit') {
              // Handle batch operations format (new format)
              if (args.operations && Array.isArray(args.operations)) {
                // Track files already recorded for this message to prevent duplicates
                const recordedFiles = new Set<string>();

                for (const op of args.operations) {
                  const filePath = op.path || op.file_path || op.filePath;
                  if (!filePath) continue;

                  const mode = op.mode;
                  if (mode === 'rewrite' || mode === 'create' || !mode) {
                    if (!fileAccess.has(filePath)) {
                      fileAccess.set(filePath, { reads: [], writes: [] });
                    }

                    // Only record this message index once per file
                    if (!recordedFiles.has(filePath)) {
                      fileAccess.get(filePath)!.writes.push(i);
                      recordedFiles.add(filePath);
                    }
                  }
                }
              } else {
                // Handle single operation format (legacy format from old conversations)
                const filePath = args.path || args.file_path || args.filePath;
                if (!filePath) continue;

                const mode = args.mode;
                if (mode === 'rewrite' || mode === 'create' || !mode) {
                  if (!fileAccess.has(filePath)) {
                    fileAccess.set(filePath, { reads: [], writes: [] });
                  }
                  fileAccess.get(filePath)!.writes.push(i);
                }
              }
            }
          } catch {
            // Ignore JSON parse errors
          }
        }
      }
    }

    for (const [filePath, access] of fileAccess.entries()) {
      const readCount = access.reads.length;
      const writeCount = access.writes.length;
      const allAccessIndices = [...access.reads, ...access.writes].filter((idx) => idx >= 0);
      if (allAccessIndices.length === 0) continue;

      const firstReadIndex: number = access.reads.length > 0 ? access.reads[0]! : allAccessIndices[0]!;
      const lastAccessIndex = Math.max(...allAccessIndices);
      const lastAccessTime: number = now - (messages.length - lastAccessIndex) * 60000;

      const hasAnyAccess = readCount > 0 || writeCount > 0;

      let score = 0;
      score += readCount;
      score += writeCount * 2;

      const meetsHotCriteria = readCount >= this.config.minReadCount || writeCount >= this.config.minWriteCount;

      if (meetsHotCriteria) {
        this.fileMetrics.set(filePath, {
          path: filePath,
          firstReadIndex,
          lastAccessTime,
          readCount,
          writeCount,
          score,
        });
      }
    }

    const sortedFiles = Array.from(this.fileMetrics.values()).sort((a, b) => b.score - a.score);

    logger.debug('compression.hot_files.analysis.complete', {
      totalFiles: fileAccess.size,
      qualifiedFiles: sortedFiles.length,
      topFiles: sortedFiles.slice(0, 5).map((f) => ({
        path: f.path,
        score: f.score,
        reads: f.readCount,
        writes: f.writeCount,
      })),
    });

    this.hotFiles = sortedFiles;
  }

  canCompress(context: CompressionContext): boolean {
    return false;
  }

  compress(context: CompressionContext): LLMMessage | null {
    return null;
  }

  async loadHotFilesContent(): Promise<void> {
    if (!this.appPath) {
      logger.warn('compression.hot_files.load.no_app_path', {
        message: 'Cannot load hot files without app path',
      });
      return;
    }

    const safePathBuilder = createSafePathBuilder(this.appPath);

    const recentFiles = this.hotFiles
      .filter(f => f.lastAccessTime >= Date.now() - this.config.recencyWindowMs)
      .sort((a, b) => b.lastAccessTime - a.lastAccessTime);

    const scoredFiles = this.hotFiles
      .filter(f => !recentFiles.includes(f))
      .sort((a, b) => b.score - a.score);

    let recentTokens = 0;
    let scoredTokens = 0;

    const recentFilesLoaded: string[] = [];
    for (const fileMetrics of recentFiles) {
      if (recentTokens >= this.config.recentFilesTokenBudget) {
        logger.debug('compression.hot_files.load.recent_budget_exceeded', {
          currentTokens: recentTokens,
          recentBudget: this.config.recentFilesTokenBudget,
          remainingFiles: recentFiles.length - recentFilesLoaded.length,
        });
        break;
      }

      const result = await this.loadSingleFile(fileMetrics, safePathBuilder, recentTokens, this.config.recentFilesTokenBudget);
      if (result.loaded) {
        recentTokens += result.tokenCount;
        recentFilesLoaded.push(fileMetrics.path);
        logger.debug('compression.hot_files.load.recent_included', {
          filePath: fileMetrics.path,
          tokenCount: result.tokenCount,
          recentTokens,
          tier: 'recent',
        });
      }
    }

    const scoredBudget = this.config.maxTokens - this.config.recentFilesTokenBudget;
    const scoredFilesLoaded: string[] = [];
    for (const fileMetrics of scoredFiles) {
      if (scoredTokens >= scoredBudget) {
        logger.debug('compression.hot_files.load.scored_budget_exceeded', {
          currentTokens: scoredTokens,
          scoredBudget,
          remainingFiles: scoredFiles.length - scoredFilesLoaded.length,
        });
        break;
      }

      const result = await this.loadSingleFile(fileMetrics, safePathBuilder, scoredTokens, scoredBudget);
      if (result.loaded) {
        scoredTokens += result.tokenCount;
        scoredFilesLoaded.push(fileMetrics.path);
        logger.debug('compression.hot_files.load.scored_included', {
          filePath: fileMetrics.path,
          tokenCount: result.tokenCount,
          score: fileMetrics.score,
          scoredTokens,
          tier: 'scored',
        });
      }
    }

    const totalTokens = recentTokens + scoredTokens;
    logger.info('compression.hot_files.load.complete', {
      totalFiles: this.hotFiles.length,
      recentFilesLoaded: recentFilesLoaded.length,
      scoredFilesLoaded: scoredFilesLoaded.length,
      totalLoadedFiles: recentFilesLoaded.length + scoredFilesLoaded.length,
      recentTokens,
      scoredTokens,
      totalTokens,
      recentBudget: this.config.recentFilesTokenBudget,
      scoredBudget,
      maxTokens: this.config.maxTokens,
      tokenUtilization: `${Math.round((totalTokens / this.config.maxTokens) * 100)}%`,
    });
  }

  private async loadSingleFile(
    fileMetrics: HotFileMetrics,
    safePathBuilder: ReturnType<typeof createSafePathBuilder>,
    currentTokens: number,
    maxTokens: number
  ): Promise<{ loaded: boolean; tokenCount: number }> {
    try {
      const fullPath = safePathBuilder.resolve(fileMetrics.path);

      if (!existsSync(fullPath)) {
        logger.debug('compression.hot_files.load.file_not_found', { filePath: fileMetrics.path });
        return { loaded: false, tokenCount: 0 };
      }

      const stats = await stat(fullPath);

      if (stats.size > this.config.maxFileSize) {
        logger.debug('compression.hot_files.load.file_too_large', {
          filePath: fileMetrics.path,
          size: stats.size,
          maxSize: this.config.maxFileSize,
        });
        return { loaded: false, tokenCount: 0 };
      }

      if (this.isBinaryFile(fileMetrics.path)) {
        logger.debug('compression.hot_files.load.binary_file', { filePath: fileMetrics.path });
        return { loaded: false, tokenCount: 0 };
      }

      const content = await readFile(fullPath, 'utf-8');
      const tokenCount = estimateTokens(content);

      if (currentTokens + tokenCount > maxTokens) {
        logger.debug('compression.hot_files.load.would_exceed_budget', {
          filePath: fileMetrics.path,
          tokenCount,
          currentTotal: currentTokens,
          maxTokens,
        });
        return { loaded: false, tokenCount: 0 };
      }

      fileMetrics.content = content;
      fileMetrics.tokenCount = tokenCount;
      fileMetrics.fileSize = stats.size;

      return { loaded: true, tokenCount };
    } catch (error) {
      logger.warn('compression.hot_files.load.error', {
        filePath: fileMetrics.path,
        error: error instanceof Error ? error.message : String(error),
      });
      return { loaded: false, tokenCount: 0 };
    }
  }

  getHotFilesMessage(): string | null {
    const loadedFiles = this.hotFiles.filter((f) => f.content);

    if (loadedFiles.length === 0) {
      return null;
    }

    let message = `[Hot Files Context - Frequently Accessed Files]\n\n`;
    message += `The following ${loadedFiles.length} files have been frequently accessed and are included for context:\n\n`;

    for (const file of loadedFiles) {
      message += `**${file.path}** (${file.readCount} reads, ${file.writeCount} edits)\n`;
      message += '```\n';
      message += file.content;
      message += '\n```\n\n';
    }

    message += `*These files are automatically included to reduce redundant file reads.*`;

    return message;
  }

  getHotFilesList(): HotFileMetrics[] {
    return this.hotFiles;
  }

  isHotFile(filePath: string): boolean {
    return this.fileMetrics.has(filePath);
  }

  private isBinaryFile(filePath: string): boolean {
    const fileName = basename(filePath);
    const binaryExtensions = [
      '.zip',
      '.tar',
      '.gz',
      '.rar',
      '.7z',
      '.db',
      '.sqlite',
      '.sqlite3',
      '.bin',
      '.exe',
      '.dll',
      '.so',
      '.png',
      '.jpg',
      '.jpeg',
      '.gif',
      '.bmp',
      '.ico',
      '.pdf',
      '.doc',
      '.docx',
      '.xls',
      '.xlsx',
    ];

    return binaryExtensions.some((ext) => fileName.endsWith(ext));
  }
}
