import { readFile, stat } from 'node:fs/promises';
import { join, normalize, resolve } from 'node:path';
import { existsSync } from 'node:fs';

import { Logger } from '../../logging/index.js';
import { createForWorkspace } from '../../workspace/index.js';
import { redactSecrets } from './redact-secrets.js';
import type { DiagnoseContextGatherResult, DiagnoseContextSource, DiagnoseTarget } from './types.js';
import type { SanitizedLogEntry } from '../log-sanitizer.js';

const logger = Logger.create({ component: 'diagnose.context' });

const MAX_TOTAL_BYTES = 40 * 1024;
const MAX_FILES = 8;
const MAX_FILE_BYTES = 12 * 1024;
const LINE_CONTEXT_RADIUS = 30;

const ALWAYS_INCLUDE = [
  'package.json',
  'tsconfig.json',
  'tsconfig.build.json',
  'jsconfig.json',
  '.airo/config.json',
];

const PATH_IN_LOG_RE =
  /(?:^|\s)(?:\.\/)?((?:src|lib|server|api|app|pages|components|dist)[^\s:()]+\.(?:ts|tsx|js|jsx|mjs|cjs|json))(?:[:(]\d+)?/gi;

const MODULE_IN_LOG_RE = /Cannot find module ['"]([^'"]+)['"]/gi;

export interface DiagnoseContextFile {
  path: string;
  content: string;
  truncated: boolean;
}

export interface DiagnoseContextGatherRequest {
  appId: string;
  target: DiagnoseTarget;
  logs: SanitizedLogEntry[];
  snapshotPath?: string;
  logSource?: 'customer' | 'import_job';
}

export class DiagnoseContextService {
  async gather(request: DiagnoseContextGatherRequest): Promise<DiagnoseContextGatherResult> {
    const empty: DiagnoseContextGatherResult = {
      projectContextText: 'No project files were available for this diagnosis.',
      contextSource: 'none',
      filesIncluded: 0,
    };

    const pathsToRead = new Set<string>(ALWAYS_INCLUDE);
    this.extractPathsFromLogs(request.logs, pathsToRead);

    const snapshotPath = request.snapshotPath;
    if (snapshotPath && existsSync(snapshotPath)) {
      return this.gatherFromRoot(snapshotPath, pathsToRead, 'snapshot', request.appId);
    }

    const workspace = createForWorkspace(request.appId, request.target);
    if (!workspace) {
      logger.info('diagnose.context.workspace_unavailable', {
        appId: request.appId,
        target: request.target,
      });
      return empty;
    }

    return this.gatherFromWorkspace(workspace, pathsToRead, request.appId);
  }

  extractPathsFromLogs(logs: SanitizedLogEntry[], paths: Set<string>): void {
    for (const entry of logs) {
      let match: RegExpExecArray | null;
      PATH_IN_LOG_RE.lastIndex = 0;
      while ((match = PATH_IN_LOG_RE.exec(entry.message)) !== null) {
        const p = match[1]!.replace(/\\/g, '/');
        if (!p.includes('..')) paths.add(p);
      }

      MODULE_IN_LOG_RE.lastIndex = 0;
      while ((match = MODULE_IN_LOG_RE.exec(entry.message)) !== null) {
        const mod = match[1]!;
        if (mod.startsWith('.') || mod.startsWith('/')) {
          paths.add(mod.replace(/^\.\//, ''));
        }
      }
    }
  }

  private async gatherFromRoot(
    root: string,
    paths: Set<string>,
    source: DiagnoseContextSource,
    appId: string
  ): Promise<DiagnoseContextGatherResult> {
    const files: DiagnoseContextFile[] = [];
    let totalBytes = 0;
    let readFailures = 0;

    for (const relPath of [...paths].slice(0, MAX_FILES + 10)) {
      if (files.length >= MAX_FILES || totalBytes >= MAX_TOTAL_BYTES) break;

      const file = await this.readFromDisk(root, relPath, totalBytes, appId);
      if (!file) {
        readFailures += 1;
        continue;
      }
      files.push(file);
      totalBytes += Buffer.byteLength(file.content, 'utf8');
    }

    if (readFailures > 0 && files.length === 0) {
      logger.warn('diagnose.context.snapshot_reads_all_failed', {
        appId,
        root,
        pathsAttempted: paths.size,
        readFailures,
      });
    }

    logger.info('diagnose.context.gathered', {
      appId,
      contextSource: source,
      filesIncluded: files.length,
      readFailures,
    });

    return {
      projectContextText: this.formatContext(files),
      contextSource: source,
      filesIncluded: files.length,
    };
  }

  private async gatherFromWorkspace(
    workspace: NonNullable<ReturnType<typeof createForWorkspace>>,
    paths: Set<string>,
    appId: string
  ): Promise<DiagnoseContextGatherResult> {
    const files: DiagnoseContextFile[] = [];
    let totalBytes = 0;
    let readFailures = 0;

    for (const relPath of [...paths]) {
      if (files.length >= MAX_FILES || totalBytes >= MAX_TOTAL_BYTES) break;

      const lineMatch = relPath.match(/:(\d+)(?::\d+)?$/);
      const cleanPath = relPath.replace(/:(\d+)(?::\d+)?$/, '');
      const viewOpts: { path: string; offset?: number; limit?: number } = { path: cleanPath };
      if (lineMatch) {
        const line = Number.parseInt(lineMatch[1]!, 10);
        viewOpts.offset = Math.max(1, line - LINE_CONTEXT_RADIUS);
        viewOpts.limit = LINE_CONTEXT_RADIUS * 2;
      }

      try {
        const result = await workspace.files.view(viewOpts);
        if (result.encoding === 'base64') continue;

        let content = redactSecrets(result.content);
        let truncated = result.truncated;
        if (Buffer.byteLength(content, 'utf8') > MAX_FILE_BYTES) {
          content = content.slice(0, MAX_FILE_BYTES) + '\n... (truncated)';
          truncated = true;
        }
        if (totalBytes + Buffer.byteLength(content, 'utf8') > MAX_TOTAL_BYTES) continue;

        files.push({ path: cleanPath, content, truncated });
        totalBytes += Buffer.byteLength(content, 'utf8');
      } catch (error) {
        readFailures += 1;
        logger.warn('diagnose.context.workspace_read_failed', {
          appId,
          path: cleanPath,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const contextSource: DiagnoseContextSource = files.length > 0 ? 'workspace' : 'none';
    if (readFailures > 0 && files.length === 0) {
      logger.warn('diagnose.context.workspace_reads_all_failed', {
        appId,
        pathsAttempted: paths.size,
        readFailures,
      });
    }

    logger.info('diagnose.context.gathered', {
      appId,
      contextSource,
      filesIncluded: files.length,
      readFailures,
    });

    return {
      projectContextText:
        files.length > 0
          ? this.formatContext(files)
          : 'No project files were available for this diagnosis.',
      contextSource,
      filesIncluded: files.length,
    };
  }

  private async readFromDisk(
    root: string,
    relPath: string,
    bytesSoFar: number,
    appId: string
  ): Promise<DiagnoseContextFile | null> {
    const cleanPath = relPath.replace(/:(\d+)(?::\d+)?$/, '').replace(/\\/g, '/');
    const abs = resolve(root, cleanPath);
    if (!normalize(abs).startsWith(normalize(resolve(root)))) return null;
    if (!existsSync(abs)) return null;

    try {
      const fileStat = await stat(abs);
      if (!fileStat.isFile()) return null;

      let content = redactSecrets(await readFile(abs, 'utf8'));
      let truncated = false;

      const lineMatch = relPath.match(/:(\d+)(?::\d+)?$/);
      if (lineMatch) {
        const line = Number.parseInt(lineMatch[1]!, 10);
        const lines = content.split('\n');
        const start = Math.max(0, line - 1 - LINE_CONTEXT_RADIUS);
        const end = Math.min(lines.length, line + LINE_CONTEXT_RADIUS);
        content = lines.slice(start, end).join('\n');
        truncated = start > 0 || end < lines.length;
      }

      if (Buffer.byteLength(content, 'utf8') > MAX_FILE_BYTES) {
        content = content.slice(0, MAX_FILE_BYTES) + '\n... (truncated)';
        truncated = true;
      }
      if (bytesSoFar + Buffer.byteLength(content, 'utf8') > MAX_TOTAL_BYTES) return null;

      return { path: cleanPath, content, truncated };
    } catch (error) {
      logger.warn('diagnose.context.disk_read_failed', {
        appId,
        path: cleanPath,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  private formatContext(files: DiagnoseContextFile[]): string {
    if (files.length === 0) {
      return 'No project files were available for this diagnosis.';
    }

    return files
      .map((f) => {
        const truncNote = f.truncated ? ' (truncated)' : '';
        return `### ${f.path}${truncNote}\n\`\`\`\n${f.content}\n\`\`\``;
      })
      .join('\n\n');
  }
}

export const diagnoseContextService = new DiagnoseContextService();
