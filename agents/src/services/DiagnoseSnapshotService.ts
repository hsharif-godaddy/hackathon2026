import { createReadStream } from 'node:fs';
import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, lstat, writeFile } from 'node:fs/promises';
import { dirname, join, normalize, relative, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import JSZip from 'jszip';

import { Logger } from '../logging/index.js';

const logger = Logger.create({ component: 'diagnose-snapshot' });

const SKIP_DIR_NAMES = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  'coverage',
  '__MACOSX',
]);

const MAX_SNAPSHOT_BYTES = 10 * 1024 * 1024;
const MAX_SINGLE_FILE_BYTES = 512 * 1024;
/** Drop snapshot job dirs older than this (abandoned failed imports). */
export const DEFAULT_SNAPSHOT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface PreserveDiagnoseSnapshotParams {
  jobId: string;
  appId: string;
  appPath: string;
  /** Host path to `.import-{jobId}.zip` when app tree is not yet copied. */
  agentZipPath?: string;
  /** Max age for stale job dirs under this app (default 7 days). */
  snapshotTtlMs?: number;
}

/**
 * Copies a bounded project tree for failed imports so diagnose can read the code
 * that actually failed (before git rollback removes it from app.path).
 */
export class DiagnoseSnapshotService {
  /** Per-app snapshot root — never a shared parent across apps/sites. */
  getSnapshotsRoot(appPath: string, appId: string): string {
    return join(dirname(appPath), 'diagnose-snapshots', appId);
  }

  getSnapshotDir(appPath: string, appId: string, jobId: string): string {
    return join(this.getSnapshotsRoot(appPath, appId), jobId);
  }

  async preserve(params: PreserveDiagnoseSnapshotParams): Promise<string | null> {
    const destDir = this.getSnapshotDir(params.appPath, params.appId, params.jobId);
    const appRoot = resolve(params.appPath);
    const ttlMs = params.snapshotTtlMs ?? DEFAULT_SNAPSHOT_TTL_MS;

    try {
      await this.pruneStaleSnapshots(params.appPath, params.appId, ttlMs);
      await rm(destDir, { recursive: true, force: true });
      await mkdir(destDir, { recursive: true });

      let bytesCopied = 0;
      const appHasPackageJson = existsSync(join(appRoot, 'package.json'));

      if (appHasPackageJson) {
        bytesCopied = await this.copyDirectoryBounded(appRoot, destDir, bytesCopied);
      } else if (params.agentZipPath && existsSync(params.agentZipPath)) {
        bytesCopied = await this.extractZipBounded(params.agentZipPath, destDir, bytesCopied);
      } else {
        logger.warn('diagnose-snapshot.skip.no_source', {
          appId: params.appId,
          jobId: params.jobId,
          appPath: params.appPath,
        });
        await rm(destDir, { recursive: true, force: true });
        return null;
      }

      if (bytesCopied === 0) {
        await rm(destDir, { recursive: true, force: true });
        return null;
      }

      logger.info('diagnose-snapshot.preserved', {
        appId: params.appId,
        jobId: params.jobId,
        destDir,
        bytesCopied,
      });
      return destDir;
    } catch (error) {
      logger.warn('diagnose-snapshot.preserve_failed', {
        appId: params.appId,
        jobId: params.jobId,
        error: error instanceof Error ? error.message : String(error),
      });
      await rm(destDir, { recursive: true, force: true }).catch(() => undefined);
      return null;
    }
  }

  /** Remove all diagnose snapshots for one app (call after successful import). */
  async cleanupForApp(appPath: string, appId: string): Promise<void> {
    const snapshotsRoot = this.getSnapshotsRoot(appPath, appId);
    if (!existsSync(snapshotsRoot)) return;
    await rm(snapshotsRoot, { recursive: true, force: true });
    logger.info('diagnose-snapshot.cleanup', { appId, snapshotsRoot });
  }

  /** Delete job snapshot dirs older than ttlMs for this app only. */
  async pruneStaleSnapshots(
    appPath: string,
    appId: string,
    ttlMs: number = DEFAULT_SNAPSHOT_TTL_MS
  ): Promise<void> {
    const snapshotsRoot = this.getSnapshotsRoot(appPath, appId);
    if (!existsSync(snapshotsRoot)) return;

    const cutoff = Date.now() - ttlMs;
    let entries: Array<{ name: string; isDirectory(): boolean }>;
    try {
      entries = await readdir(snapshotsRoot, { withFileTypes: true });
    } catch (error) {
      logger.warn('diagnose-snapshot.prune.read_failed', {
        appId,
        snapshotsRoot,
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const jobDir = join(snapshotsRoot, entry.name);
      try {
        const st = await lstat(jobDir);
        if (st.mtimeMs < cutoff) {
          await rm(jobDir, { recursive: true, force: true });
          logger.info('diagnose-snapshot.prune.removed', { appId, jobId: entry.name, jobDir });
        }
      } catch (error) {
        logger.warn('diagnose-snapshot.prune.entry_failed', {
          appId,
          jobDir,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  private shouldSkipDir(name: string): boolean {
    if (SKIP_DIR_NAMES.has(name)) return true;
    if (name.startsWith('.import-')) return true;
    return false;
  }

  private isSafeRelativePath(relPath: string): boolean {
    const normalized = relPath.replace(/\\/g, '/');
    if (!normalized || normalized.startsWith('/') || normalized.includes('..')) {
      return false;
    }
    return true;
  }

  private async copyDirectoryBounded(
    sourceRoot: string,
    destRoot: string,
    bytesSoFar: number
  ): Promise<number> {
    let total = bytesSoFar;
    const resolvedDestRoot = resolve(destRoot);
    const resolvedSourceRoot = resolve(sourceRoot);

    const walk = async (dir: string): Promise<void> => {
      if (total >= MAX_SNAPSHOT_BYTES) return;

      const entries = await readdirWithTypes(dir);
      for (const entry of entries) {
        if (total >= MAX_SNAPSHOT_BYTES) return;

        const abs = join(dir, entry.name);
        const rel = relative(resolvedSourceRoot, abs);
        if (!this.isSafeRelativePath(rel)) continue;

        let entryStat;
        try {
          entryStat = await lstat(abs);
        } catch {
          continue;
        }

        if (entryStat.isSymbolicLink()) continue;

        if (entryStat.isDirectory()) {
          if (this.shouldSkipDir(entry.name)) continue;
          await walk(abs);
          continue;
        }

        if (!entryStat.isFile()) continue;

        if (entryStat.size > MAX_SINGLE_FILE_BYTES) continue;
        if (total + entryStat.size > MAX_SNAPSHOT_BYTES) continue;

        const destPath = join(destRoot, rel);
        if (!isPathContainedInRoot(destPath, resolvedDestRoot)) continue;

        await mkdir(dirname(destPath), { recursive: true });
        await pipeline(createReadStream(abs), createWriteStream(destPath));
        total += entryStat.size;
      }
    };

    await walk(resolvedSourceRoot);
    return total;
  }

  private async extractZipBounded(
    zipPath: string,
    destRoot: string,
    bytesSoFar: number
  ): Promise<number> {
    let total = bytesSoFar;
    const resolvedDestRoot = resolve(destRoot);
    const zipData = await readFile(zipPath);
    const zip = await JSZip.loadAsync(zipData);

    const paths = Object.keys(zip.files).filter((p) => !p.startsWith('__MACOSX/') && !p.endsWith('/'));
    const commonPrefix = detectCommonPrefix(paths);

    for (const entryPath of paths) {
      if (total >= MAX_SNAPSHOT_BYTES) break;

      const file = zip.files[entryPath];
      if (!file || file.dir) continue;
      if (entryPath.includes('..')) continue;

      const stripped =
        commonPrefix && entryPath.startsWith(commonPrefix)
          ? entryPath.slice(commonPrefix.length)
          : entryPath;
      if (!stripped || !this.isSafeRelativePath(stripped)) continue;

      const parts = stripped.split('/');
      if (parts.some((p) => this.shouldSkipDir(p))) continue;

      const destPath = join(destRoot, stripped);
      if (!isPathContainedInRoot(destPath, resolvedDestRoot)) continue;

      if (/\.(png|jpg|jpeg|gif|svg|ico|webp|woff2?|ttf|eot|mp4|zip|gz)$/i.test(stripped)) {
        continue;
      }

      const content = await file.async('uint8array');
      if (content.length > MAX_SINGLE_FILE_BYTES) continue;
      if (total + content.length > MAX_SNAPSHOT_BYTES) continue;

      await mkdir(dirname(destPath), { recursive: true });
      await writeFile(destPath, content);
      total += content.length;
    }

    return total;
  }
}

/** True when resolved target stays under resolved root (zip-slip / traversal guard). */
export function isPathContainedInRoot(targetPath: string, rootPath: string): boolean {
  const resolvedTarget = normalize(resolve(targetPath));
  const resolvedRoot = normalize(resolve(rootPath));
  const prefix = resolvedRoot.endsWith('/') ? resolvedRoot : `${resolvedRoot}/`;
  return resolvedTarget === resolvedRoot || resolvedTarget.startsWith(prefix);
}

async function readdirWithTypes(dir: string): Promise<Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>> {
  return readdir(dir, { withFileTypes: true });
}

function detectCommonPrefix(paths: string[]): string {
  const topDirs = new Set(paths.map((p) => p.split('/')[0]).filter(Boolean));
  if (topDirs.size === 1) {
    const prefix = [...topDirs][0]! + '/';
    if (paths.some((p) => p.startsWith(prefix) && p.length > prefix.length)) {
      return prefix;
    }
  }
  return '';
}

export const diagnoseSnapshotService = new DiagnoseSnapshotService();
