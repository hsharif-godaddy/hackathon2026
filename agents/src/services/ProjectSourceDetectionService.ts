/**
 * ProjectSourceDetectionService
 *
 * Scans customer app files after code sync (zip import, git pull) for
 * fingerprints of third-party app builders. Results are logged only.
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { Logger } from '../logging/index.js';
import type {
  ProjectSourceDetectionContext,
  ProjectSourceDetectionResult,
  ProjectSourceId,
  ProjectSourceMatch,
} from '../types/project-source.js';

const MAX_FILES_SCANNED = 20;
const MAX_WALK_FILES = MAX_FILES_SCANNED - 2; // package.json + README.md reserved
const MAX_FILE_BYTES = 512 * 1024;
const MAX_MATCHES_LOGGED = 20;

const REQUIRED_FILES = ['package.json', 'README.md'] as const;

const SKIP_DIR_NAMES = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  'coverage',
]);

const SCANNABLE_EXTENSIONS = new Set([
  '.json',
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.md',
  '.html',
  '.css',
  '.scss',
  '.vue',
  '.yaml',
  '.yml',
  '.toml',
]);

interface SourceDetector {
  id: ProjectSourceId;
  needles: string[];
}

const DETECTORS: SourceDetector[] = [
  { id: 'lovable', needles: ['lovable'] },
];

/** Format source IDs for structured logs (logger rejects array fields). */
export function formatDetectedSourcesForLog(sources: ProjectSourceId[]): string {
  return sources.join(',');
}

/** Format match records for structured logs (logger rejects array/object fields). */
export function formatMatchesForLog(matches: ProjectSourceMatch[]): string {
  return matches
    .map((m) => (m.line !== undefined ? `${m.source}:${m.file}:${m.line}` : `${m.source}:${m.file}`))
    .join(',');
}

export class ProjectSourceDetectionService {
  private logger = Logger.create({ component: 'project-source-detection' });

  async detect(appPath: string): Promise<ProjectSourceDetectionResult> {
    const root = resolve(appPath);
    const rootStat = await stat(root).catch(() => null);
    if (!rootStat?.isDirectory()) {
      throw new Error(`App path is not a directory: ${appPath}`);
    }

    const scannedPaths = new Set<string>();
    const matches: ProjectSourceMatch[] = [];
    let filesSkippedDueToCap = 0;

    const scanFile = async (absolutePath: string): Promise<void> => {
      const normalized = resolve(absolutePath);
      if (scannedPaths.has(normalized)) {
        return;
      }
      scannedPaths.add(normalized);

      let content: string;
      try {
        content = await readFile(normalized, 'utf8');
      } catch {
        return;
      }

      const relFile = relative(root, normalized) || normalized;
      const lines = content.split('\n');

      for (const detector of DETECTORS) {
        if (matches.some(m => m.source === detector.id)) {
          continue;
        }
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          const lineLower = line.toLowerCase();
          for (const needle of detector.needles) {
            if (lineLower.includes(needle.toLowerCase())) {
              matches.push({
                source: detector.id,
                file: relFile,
                line: i + 1,
              });
              break;
            }
          }
          if (matches.some(m => m.source === detector.id)) {
            break;
          }
        }
      }
    };

    for (const name of REQUIRED_FILES) {
      await scanFile(join(root, name));
    }

    const walkCandidates: string[] = [];

    const collectCandidates = async (dir: string): Promise<void> => {
      let entries: string[];
      try {
        entries = await readdir(dir);
      } catch {
        return;
      }

      for (const name of entries) {
        if (name.startsWith('.import-')) {
          continue;
        }

        const full = join(dir, name);
        const normalized = resolve(full);

        if (REQUIRED_FILES.includes(name as (typeof REQUIRED_FILES)[number])) {
          const rel = relative(root, normalized);
          if (rel === name) {
            continue;
          }
        }

        let entryStat: Awaited<ReturnType<typeof stat>>;
        try {
          entryStat = await stat(full);
        } catch {
          continue;
        }

        if (entryStat.isDirectory()) {
          if (SKIP_DIR_NAMES.has(name)) {
            continue;
          }
          await collectCandidates(full);
          continue;
        }

        if (!entryStat.isFile()) {
          continue;
        }

        if (entryStat.size > MAX_FILE_BYTES) {
          continue;
        }

        const ext = name.includes('.') ? name.slice(name.lastIndexOf('.')) : '';
        if (!SCANNABLE_EXTENSIONS.has(ext)) {
          continue;
        }

        walkCandidates.push(normalized);
      }
    };

    await collectCandidates(root);

    let walkScanned = 0;
    for (const candidate of walkCandidates) {
      if (walkScanned >= MAX_WALK_FILES) {
        filesSkippedDueToCap += 1;
        continue;
      }
      await scanFile(candidate);
      walkScanned += 1;
    }

    const detectedSources = [...new Set(matches.map(m => m.source))];

    return {
      detectedSources,
      matches: matches.slice(0, MAX_MATCHES_LOGGED),
      filesScanned: scannedPaths.size,
      filesSkippedDueToCap,
    };
  }

  async detectAndLog(context: ProjectSourceDetectionContext): Promise<ProjectSourceDetectionResult> {
    const { appId, appPath, jobId, trigger } = context;

    try {
      const result = await this.detect(appPath);

      const baseFields = {
        appId,
        jobId,
        trigger,
        filesScanned: result.filesScanned,
        filesSkippedDueToCap: result.filesSkippedDueToCap,
      };

      if (result.detectedSources.length > 0) {
        this.logger.info('project-source.detected', {
          ...baseFields,
          detectedSources: formatDetectedSourcesForLog(result.detectedSources),
          matchCount: result.matches.length,
          matches: formatMatchesForLog(result.matches),
        });
      } else {
        this.logger.info('project-source.detect.none', baseFields);
      }

      return result;
    } catch (error) {
      this.logger.warn('project-source.detect.failed', {
        appId,
        jobId,
        trigger,
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        detectedSources: [],
        matches: [],
        filesScanned: 0,
        filesSkippedDueToCap: 0,
      };
    }
  }

  detectAndLogInBackground(context: ProjectSourceDetectionContext): void {
    void this.detectAndLog(context).catch((error) => {
      this.logger.warn('project-source.detect.background-error', {
        appId: context.appId,
        jobId: context.jobId,
        trigger: context.trigger,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }
}

export const projectSourceDetectionService = new ProjectSourceDetectionService();
