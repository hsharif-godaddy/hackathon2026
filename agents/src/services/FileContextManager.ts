import { readFile, stat } from 'fs/promises';
import { basename } from 'path';
import { existsSync } from 'fs';
import { logger } from '../logging/index.js';
import { estimateTokens } from '../utils/token-counter.js';
import { createSafePathBuilder } from '../utils/safe-path.js';
import { FileContextRepository } from '../database/repositories/FileContextRepository.js';
import { createHash } from 'crypto';

/**
 * Tracks file access patterns and manages hot files for conversation context
 */
export interface FileContext {
  path: string;
  lastModified: number; // When we recorded a modification operation
  lastRead: number; // When we recorded a read operation
  modificationCount: number;
  readCount: number;
  content?: string;
  size: number;
  tokenCount?: number;
  actualFileModTime?: number | null; // Actual file modification time for cache validation
}

/**
 * File context with scoring for hot file prioritization
 */
interface ScoredFileContext extends FileContext {
  score: number;
}

/**
 * Configuration for hot file inclusion
 */
interface HotFileConfig {
  maxTokens: number; // Max tokens to use for hot files (default 30k)
  maxFileSize: number; // Max file size in bytes to include (default 1MB)
  recencyWindowMs: number; // Time window for recent activity (default 10 min)
  minModificationCount: number; // Min modifications to be considered hot (default 3)
  minReadCount: number; // Min reads to be considered hot (default 2)
}

/**
 * Manages file context for conversation history optimization
 * Tracks frequently accessed files and includes them in conversation context
 */
export class FileContextManager {
  private repository: FileContextRepository;
  private appPath: string;
  private config: HotFileConfig;
  private safePathBuilder: ReturnType<typeof createSafePathBuilder>;

  constructor(appPath: string, config?: Partial<HotFileConfig>) {
    this.appPath = appPath;
    this.repository = new FileContextRepository();
    this.safePathBuilder = createSafePathBuilder(appPath);
    this.config = {
      maxTokens: 30000,
      maxFileSize: 1024 * 1024, // 1MB
      recencyWindowMs: 10 * 60 * 1000, // 10 minutes
      minModificationCount: 3,
      minReadCount: 2,
      ...config
    };
  }

  /**
   * Record a file modification
   */
  recordFileModification(filePath: string, success: boolean): void {
    const isDebugMode = process.env.HOT_FILES_DEBUG === 'true';
    
    if (!success) {
      if (isDebugMode) {
        logger.info('hot_files.tracking.modification_skipped', {
          filePath,
          reason: 'operation failed'
        });
      }
      return; // Only track successful operations
    }

    const now = Date.now();
    const existing = this.repository.findByPath(this.appPath, filePath);
    
    if (isDebugMode) {
      logger.info('hot_files.tracking.modification_recorded', {
        filePath,
        existingRecord: !!existing,
        previousModCount: existing?.modificationCount || 0,
        newModCount: (existing?.modificationCount || 0) + 1
      });
    }
    
    if (existing) {
      // Update existing record
      existing.lastModified = now;
      existing.modificationCount++;
      this.repository.upsert({
        appPath: existing.appPath,
        filePath: existing.filePath,
        lastModified: existing.lastModified,
        lastRead: existing.lastRead,
        modificationCount: existing.modificationCount,
        readCount: existing.readCount,
        fileSize: existing.fileSize,
        tokenCount: existing.tokenCount,
        contentHash: existing.contentHash,
        actualFileModTime: existing.actualFileModTime || null
      });
    } else {
      // Create new record
      this.repository.upsert({
        appPath: this.appPath,
        filePath,
        lastModified: now,
        lastRead: 0,
        modificationCount: 1,
        readCount: 0,
        fileSize: 0,
        tokenCount: 0,
        contentHash: '',
        actualFileModTime: null
      });
    }

    logger.info('file_context.modification_recorded', {
      filePath,
      modificationCount: existing ? existing.modificationCount : 1,
      lastModified: now
    });
  }

  /**
   * Record a file read
   */
  recordFileRead(filePath: string): void {
    const isDebugMode = process.env.HOT_FILES_DEBUG === 'true';
    const now = Date.now();
    const existing = this.repository.findByPath(this.appPath, filePath);
    
    if (isDebugMode) {
      logger.info('hot_files.tracking.read_recorded', {
        filePath,
        existingRecord: !!existing,
        previousReadCount: existing?.readCount || 0,
        newReadCount: (existing?.readCount || 0) + 1
      });
    }
    
    if (existing) {
      // Update existing record
      existing.lastRead = now;
      existing.readCount++;
      this.repository.upsert({
        appPath: existing.appPath,
        filePath: existing.filePath,
        lastModified: existing.lastModified,
        lastRead: existing.lastRead,
        modificationCount: existing.modificationCount,
        readCount: existing.readCount,
        fileSize: existing.fileSize,
        tokenCount: existing.tokenCount,
        contentHash: existing.contentHash,
        actualFileModTime: existing.actualFileModTime || null
      });
    } else {
      // Create new record
      this.repository.upsert({
        appPath: this.appPath,
        filePath,
        lastModified: 0,
        lastRead: now,
        modificationCount: 0,
        readCount: 1,
        fileSize: 0,
        tokenCount: 0,
        contentHash: '',
        actualFileModTime: null
      });
    }

    logger.info('file_context.read_recorded', {
      filePath,
      readCount: existing ? existing.readCount : 1,
      lastRead: now
    });
  }

  /**
   * Get files that should be included in conversation context
   */
  async getHotFilesContext(): Promise<string> {
    const isDebugMode = process.env.HOT_FILES_DEBUG === 'true';
    
    if (isDebugMode) {
      logger.info('hot_files.context_generation.start', {
        appPath: this.appPath,
        config: this.config
      });
    }
    
    const hotFiles = this.getHotFilesList();
    
    if (isDebugMode) {
      logger.info('hot_files.scoring.results', {
        totalCandidates: hotFiles.length,
        hotFiles: hotFiles.map(f => ({
          path: f.path,
          score: f.score,
          lastModified: f.lastModified,
          lastRead: f.lastRead,
          modificationCount: f.modificationCount,
          readCount: f.readCount,
          timeSinceModified: Date.now() - f.lastModified,
          timeSinceRead: Date.now() - f.lastRead
        }))
      });
    }
    
    if (hotFiles.length === 0) {
      if (isDebugMode) {
        logger.info('hot_files.context_generation.no_hot_files', {
          reason: 'No files meet hot criteria'
        });
      }
      return '';
    }

    // Load content for hot files and calculate total tokens
    const loadedFiles: Array<{ path: string; content: string; tokenCount: number }> = [];
    let totalTokens = 0;

    for (const fileContext of hotFiles) {
      if (totalTokens >= this.config.maxTokens) {
        if (isDebugMode) {
          logger.info('hot_files.token_budget.exceeded', {
            currentTokens: totalTokens,
            maxTokens: this.config.maxTokens,
            skippedFile: fileContext.path
          });
        }
        break;
      }

      if (isDebugMode) {
        logger.info('hot_files.file_loading.attempt', {
          filePath: fileContext.path,
          currentTokens: totalTokens,
          remainingBudget: this.config.maxTokens - totalTokens
        });
      }

      try {
        const content = await this.loadFileContent(fileContext);
        if (content) {
          const tokenCount = estimateTokens(content);
          
          if (isDebugMode) {
            logger.info('hot_files.file_loading.success', {
              filePath: fileContext.path,
              contentLength: content.length,
              tokenCount,
              wouldExceedBudget: (totalTokens + tokenCount) > this.config.maxTokens
            });
          }
          
          // Only include if it fits within token budget
          if (totalTokens + tokenCount <= this.config.maxTokens) {
            loadedFiles.push({
              path: fileContext.path,
              content,
              tokenCount
            });
            totalTokens += tokenCount;

            // Cache the content and token count
            fileContext.content = content;
            fileContext.tokenCount = tokenCount;
            
            if (isDebugMode) {
              logger.info('hot_files.file_loading.included', {
                filePath: fileContext.path,
                tokenCount,
                totalTokens
              });
            }
          } else if (isDebugMode) {
            logger.info('hot_files.file_loading.budget_exceeded', {
              filePath: fileContext.path,
              tokenCount,
              currentTotal: totalTokens,
              wouldBe: totalTokens + tokenCount,
              maxTokens: this.config.maxTokens
            });
          }
        } else if (isDebugMode) {
          logger.info('hot_files.file_loading.no_content', {
            filePath: fileContext.path,
            reason: 'loadFileContent returned null'
          });
        }
      } catch (error) {
        logger.warn('file_context.load_failed', {
          filePath: fileContext.path,
          error: error instanceof Error ? error.message : String(error)
        });
        
        if (isDebugMode) {
          logger.info('hot_files.file_loading.error', {
            filePath: fileContext.path,
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined
          });
        }
      }
    }

    if (loadedFiles.length === 0) {
      if (isDebugMode) {
        logger.info('hot_files.context_generation.no_loaded_files', {
          reason: 'No files could be loaded or fit within token budget',
          hotFilesFound: hotFiles.length,
          tokenBudget: this.config.maxTokens
        });
      }
      return '';
    }

    if (isDebugMode) {
      logger.info('hot_files.context_generation.final_summary', {
        totalHotFiles: hotFiles.length,
        loadedFiles: loadedFiles.length,
        totalTokens,
        maxTokens: this.config.maxTokens,
        tokenUtilization: `${Math.round((totalTokens / this.config.maxTokens) * 100)}%`,
        loadedFilePaths: loadedFiles.map(f => f.path)
      });
    }

    logger.info('file_context.hot_files_loaded', {
      fileCount: loadedFiles.length,
      totalTokens,
      maxTokens: this.config.maxTokens
    });

    // Format the context message
    let contextMessage = `[Hot Files Context - Recently Modified/Read Files]\n\n`;
    contextMessage += `The following ${loadedFiles.length} files have been frequently accessed and are included for context:\n\n`;

    for (const file of loadedFiles) {
      // Find file info from the hot files list
      const fileInfo = hotFiles.find(hf => hf.path === file.path);
      contextMessage += `**${file.path}** (`;
      contextMessage += `${fileInfo?.modificationCount || 0} edits, ${fileInfo?.readCount || 0} reads)\n`;
      contextMessage += '```\n';
      contextMessage += file.content;
      contextMessage += '\n```\n\n';
    }

    contextMessage += `*These files are automatically included to reduce redundant file reads.*`;

    if (isDebugMode) {
      logger.info('hot_files.context_generation.complete', {
        finalContextLength: contextMessage.length,
        totalFiles: loadedFiles.length,
        totalTokens,
        contextPreview: contextMessage.substring(0, 200) + '...'
      });
    }

    return contextMessage;
  }

  /**
   * Get list of files that qualify as "hot"
   */
  private getHotFilesList(): ScoredFileContext[] {
    const isDebugMode = process.env.HOT_FILES_DEBUG === 'true';
    const now = Date.now();
    const hotFiles: ScoredFileContext[] = [];

    // Get all file contexts from database for this app
    const fileContexts = this.repository.findByAppPath(this.appPath);

    if (isDebugMode) {
      logger.info('hot_files.scoring.start', {
        appPath: this.appPath,
        totalFileContexts: fileContexts.length,
        config: {
          recencyWindowMs: this.config.recencyWindowMs,
          minModificationCount: this.config.minModificationCount,
          minReadCount: this.config.minReadCount
        }
      });
    }

    for (const dbFileContext of fileContexts) {
      // Convert database FileContext to service FileContext
      const fileContext: FileContext = {
        path: dbFileContext.filePath,
        lastModified: dbFileContext.lastModified,
        lastRead: dbFileContext.lastRead,
        modificationCount: dbFileContext.modificationCount,
        readCount: dbFileContext.readCount,
        size: dbFileContext.fileSize,
        tokenCount: dbFileContext.tokenCount,
        actualFileModTime: dbFileContext.actualFileModTime
      };

      const timeSinceModified = now - fileContext.lastModified;
      const timeSinceRead = now - fileContext.lastRead;
      const isRecentlyModified = timeSinceModified < this.config.recencyWindowMs;
      const isRecentlyRead = timeSinceRead < this.config.recencyWindowMs;
      const isFrequentlyModified = fileContext.modificationCount >= this.config.minModificationCount;
      const isFrequentlyRead = fileContext.readCount >= this.config.minReadCount;

      // Score based on recency and frequency
      let score = 0;
      if (isRecentlyModified) score += 10;
      if (isRecentlyRead) score += 5;
      if (isFrequentlyModified) score += fileContext.modificationCount;
      if (isFrequentlyRead) score += fileContext.readCount;

      const meetsHotCriteria = isRecentlyModified || isFrequentlyModified || (isRecentlyRead && isFrequentlyRead);

      if (isDebugMode) {
        logger.info('hot_files.scoring.file_evaluation', {
          filePath: fileContext.path,
          timeSinceModified: `${Math.round(timeSinceModified / 1000)}s`,
          timeSinceRead: `${Math.round(timeSinceRead / 1000)}s`,
          modificationCount: fileContext.modificationCount,
          readCount: fileContext.readCount,
          criteria: {
            isRecentlyModified,
            isRecentlyRead,
            isFrequentlyModified,
            isFrequentlyRead
          },
          score,
          meetsHotCriteria,
          reason: meetsHotCriteria ? 
            [
              isRecentlyModified ? 'recently modified' : null,
              isFrequentlyModified ? 'frequently modified' : null,
              (isRecentlyRead && isFrequentlyRead) ? 'recently & frequently read' : null
            ].filter(Boolean).join(', ') : 'does not meet hot criteria'
        });
      }

      // Include if it meets any hot criteria
      if (meetsHotCriteria) {
        hotFiles.push({ ...fileContext, score });
      }
    }

    // Sort by score (descending) and return
    const sortedHotFiles = hotFiles.sort((a, b) => b.score - a.score);
    
    if (isDebugMode) {
      logger.info('hot_files.scoring.final_results', {
        totalEvaluated: fileContexts.length,
        qualifiedHotFiles: sortedHotFiles.length,
        topFiles: sortedHotFiles.slice(0, 5).map(f => ({
          path: f.path,
          score: f.score,
          modCount: f.modificationCount,
          readCount: f.readCount
        }))
      });
    }
    
    return sortedHotFiles;
  }

  /**
   * Load content for a file if it should be included
   */
  private async loadFileContent(fileContext: FileContext): Promise<string | null> {
    // Return cached content if available and file hasn't been modified
    if (fileContext.content && fileContext.actualFileModTime !== undefined) {
      try {
        const fullPath = this.safePathBuilder.resolve(fileContext.path);
        const stats = await stat(fullPath);
        if (stats.mtime.getTime() === fileContext.actualFileModTime) {
          return fileContext.content;
        }
        // File has been modified externally, clear cache
        delete fileContext.content;
        delete fileContext.tokenCount;
        delete fileContext.actualFileModTime;
      } catch (error) {
        // File might not exist anymore
        return null;
      }
    }

    try {
      const fullPath = this.safePathBuilder.resolve(fileContext.path);
      
      if (!existsSync(fullPath)) {
        return null;
      }

      // Check file size
      const stats = await stat(fullPath);
      if (stats.size > this.config.maxFileSize) {
        logger.warn('file_context.file_too_large', {
          filePath: fileContext.path,
          size: stats.size,
          maxSize: this.config.maxFileSize
        });
        return null;
      }

      // Check if it's a binary file
      if (this.isBinaryFile(fileContext.path)) {
        return null;
      }

      // Update size and actual file modification time for cache validation
      fileContext.size = stats.size;
      fileContext.actualFileModTime = stats.mtime.getTime();

      // Read the file
      const content = await readFile(fullPath, 'utf-8');
      
      // Truncate if too long
      let finalContent = content;
      if (content.length > this.config.maxFileSize) {
        finalContent = content.substring(0, this.config.maxFileSize) + '\n\n[... truncated due to size limit ...]';
      }

      // Calculate content hash and token count for database storage
      const contentHash = createHash('sha256').update(finalContent).digest('hex');
      const tokenCount = estimateTokens(finalContent);

      // Update the database with fresh file metadata
      const dbFileContext = this.repository.findByPath(this.appPath, fileContext.path);
      if (dbFileContext) {
        this.repository.upsert({
          appPath: dbFileContext.appPath,
          filePath: dbFileContext.filePath,
          lastModified: dbFileContext.lastModified,
          lastRead: dbFileContext.lastRead,
          modificationCount: dbFileContext.modificationCount,
          readCount: dbFileContext.readCount,
          fileSize: stats.size,
          tokenCount,
          contentHash,
          actualFileModTime: stats.mtime.getTime()
        });
      }

      // Cache the content in memory for this session
      fileContext.content = finalContent;
      fileContext.tokenCount = tokenCount;

      return finalContent;
    } catch (error) {
      logger.warn('file_context.read_failed', {
        filePath: fileContext.path,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  /**
   * Check if a file is likely binary
   */
  private isBinaryFile(filePath: string): boolean {
    const fileName = basename(filePath);
    const binaryExtensions = [
      '.zip', '.tar', '.gz', '.rar', '.7z', '.db', '.sqlite', '.sqlite3',
      '.bin', '.exe', '.dll', '.so', '.png', '.jpg', '.jpeg', '.gif',
      '.bmp', '.ico', '.pdf', '.doc', '.docx', '.xls', '.xlsx'
    ];
    
    return binaryExtensions.some(ext => fileName.endsWith(ext));
  }

  /**
   * Clear old entries to prevent database growth
   */
  pruneOldEntries(): void {
    const now = Date.now();
    const maxAge = this.config.recencyWindowMs * 5; // Keep entries for 5x the recency window
    const cutoffTimestamp = now - maxAge;

    const pruned = this.repository.deleteOlderThan(this.appPath, cutoffTimestamp);
    if (pruned > 0) {
      logger.info('file_context.pruned_entries', {
        prunedCount: pruned,
        maxAgeMs: maxAge
      });
    }
  }

  /**
   * Get summary information about hot files
   */
  getSummary(): {
    totalFiles: number;
    hotFiles: number;
    totalTokensUsed: number;
  } {
    const hotFiles = this.getHotFilesList();
    const stats = this.repository.getStats(this.appPath);

    return {
      totalFiles: stats.totalFiles,
      hotFiles: hotFiles.length,
      totalTokensUsed: stats.totalTokens
    };
  }
}