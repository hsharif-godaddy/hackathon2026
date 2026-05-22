import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, readFile, rm, stat, symlink, utimes } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import JSZip from 'jszip';
import {
  DiagnoseSnapshotService,
  isPathContainedInRoot,
  DEFAULT_SNAPSHOT_TTL_MS,
} from '../DiagnoseSnapshotService.js';

describe('isPathContainedInRoot', () => {
  it('rejects zip-slip style paths', () => {
    const root = '/tmp/snap-root';
    expect(isPathContainedInRoot('/tmp/snap-root/../etc/passwd', root)).toBe(false);
    expect(isPathContainedInRoot('/tmp/snap-root/ok/file.txt', root)).toBe(true);
  });
});

describe('DiagnoseSnapshotService', () => {
  let appPath: string;
  let baseDir: string;
  let otherAppPath: string;
  const service = new DiagnoseSnapshotService();

  beforeEach(async () => {
    baseDir = join(tmpdir(), `snap-${Date.now()}`);
    appPath = join(baseDir, 'site-a', 'preview');
    otherAppPath = join(baseDir, 'site-b', 'preview');
    await mkdir(appPath, { recursive: true });
    await mkdir(otherAppPath, { recursive: true });
    await writeFile(join(otherAppPath, 'package.json'), '{"name":"y","version":"1.0.0"}', 'utf8');
    await writeFile(join(appPath, 'package.json'), '{"name":"x","version":"1.0.0"}', 'utf8');
    await writeFile(join(appPath, 'index.js'), 'console.log("hi")', 'utf8');
  });

  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true }).catch(() => undefined);
  });

  it('preserves app tree under per-app diagnose-snapshots directory', async () => {
    const dest = await service.preserve({
      jobId: 'job-1',
      appId: 'app-1',
      appPath,
    });

    expect(dest).toBe(join(baseDir, 'site-a', 'diagnose-snapshots', 'app-1', 'job-1'));
    const pkg = await readFile(join(dest!, 'package.json'), 'utf8');
    expect(pkg).toContain('"name":"x"');
    const destStat = await stat(dest!);
    expect(destStat.isDirectory()).toBe(true);
  });

  it('extractZipBounded preserves files when package.json is not on disk yet', async () => {
    const zipOnlyBase = join(baseDir, 'zip-only', 'preview');
    await mkdir(zipOnlyBase, { recursive: true });
    const zipPath = join(zipOnlyBase, '.import-job-zip.zip');

    const zip = new JSZip();
    zip.file('package.json', JSON.stringify({ name: 'from-zip', version: '1.0.0' }));
    zip.file('src/index.ts', 'export const x = 1;\n');
    const buf = await zip.generateAsync({ type: 'nodebuffer' });
    await writeFile(zipPath, buf);

    const dest = await service.preserve({
      jobId: 'job-zip',
      appId: 'app-zip',
      appPath: zipOnlyBase,
      agentZipPath: zipPath,
    });

    expect(dest).toContain('diagnose-snapshots/app-zip/job-zip');
    const pkg = await readFile(join(dest!, 'package.json'), 'utf8');
    expect(pkg).toContain('from-zip');
    expect(await readFile(join(dest!, 'src', 'index.ts'), 'utf8')).toContain('export const x');
  });

  it('cleanupForApp removes only the requesting app snapshots, not sibling apps', async () => {
    await service.preserve({ jobId: 'job-a', appId: 'app-a', appPath });
    await service.preserve({ jobId: 'job-b', appId: 'app-b', appPath: otherAppPath });

    await service.cleanupForApp(appPath, 'app-a');

    expect(service.getSnapshotDir(appPath, 'app-a', 'job-a')).not.toBe(
      service.getSnapshotDir(otherAppPath, 'app-b', 'job-b')
    );
    await expect(stat(service.getSnapshotDir(appPath, 'app-a', 'job-a'))).rejects.toThrow();
    await expect(stat(service.getSnapshotDir(otherAppPath, 'app-b', 'job-b'))).resolves.toBeDefined();
  });

  it('does not follow symlinks when copying from app tree', async () => {
    const secretFile = join(baseDir, 'secret.txt');
    await writeFile(secretFile, 'leaked', 'utf8');
    try {
      await symlink(secretFile, join(appPath, 'link-to-secret'));
    } catch {
      // Symlinks may be unavailable (e.g. Windows without privilege).
      return;
    }

    const dest = await service.preserve({
      jobId: 'job-sym',
      appId: 'app-sym',
      appPath,
    });

    await expect(readFile(join(dest!, 'link-to-secret'), 'utf8')).rejects.toThrow();
  });

  it('pruneStaleSnapshots removes only expired job dirs for one app', async () => {
    const snapshotsRoot = service.getSnapshotsRoot(appPath, 'app-prune');
    const staleDir = join(snapshotsRoot, 'old-job');
    const freshDir = join(snapshotsRoot, 'new-job');
    await mkdir(staleDir, { recursive: true });
    await mkdir(freshDir, { recursive: true });
    await writeFile(join(staleDir, 'package.json'), '{}', 'utf8');
    await writeFile(join(freshDir, 'package.json'), '{}', 'utf8');

    const tenSecondsAgo = new Date(Date.now() - 10_000);
    await utimes(staleDir, tenSecondsAgo, tenSecondsAgo);
    await utimes(freshDir, new Date(), new Date());

    await service.pruneStaleSnapshots(appPath, 'app-prune', 5_000);

    await expect(stat(staleDir)).rejects.toThrow();
    await expect(stat(freshDir)).resolves.toBeDefined();
  });

  it('prune on preserve uses DEFAULT_SNAPSHOT_TTL_MS', async () => {
    const snapshotsRoot = service.getSnapshotsRoot(appPath, 'app-old');
    const oldJobDir = join(snapshotsRoot, 'stale-job');
    await mkdir(oldJobDir, { recursive: true });
    await writeFile(join(oldJobDir, 'package.json'), '{}', 'utf8');
    const ancient = new Date(Date.now() - DEFAULT_SNAPSHOT_TTL_MS - 86_400_000);
    await utimes(oldJobDir, ancient, ancient);

    await service.preserve({ jobId: 'new-job', appId: 'app-old', appPath });

    await expect(stat(oldJobDir)).rejects.toThrow();
    await expect(stat(join(snapshotsRoot, 'new-job'))).resolves.toBeDefined();
  });
});
