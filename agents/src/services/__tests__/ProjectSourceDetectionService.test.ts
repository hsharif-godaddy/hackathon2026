import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  ProjectSourceDetectionService,
  formatDetectedSourcesForLog,
  formatMatchesForLog,
} from '../ProjectSourceDetectionService.js';

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('../../logging/index.js', () => ({
  Logger: {
    create: () => mockLogger,
  },
}));

describe('ProjectSourceDetectionService', () => {
  let service: ProjectSourceDetectionService;
  let tempDir: string;

  beforeEach(async () => {
    service = new ProjectSourceDetectionService();
    tempDir = await mkdtemp(join(tmpdir(), 'project-source-detect-'));
    mockLogger.info.mockClear();
    mockLogger.warn.mockClear();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('detects lovable from package.json via lovable-tagger dependency', async () => {
    await writeFile(
      join(tempDir, 'package.json'),
      JSON.stringify({ devDependencies: { 'lovable-tagger': '^1.0.0' } }, null, 2)
    );
    await writeFile(join(tempDir, 'README.md'), '# My App\n');

    const result = await service.detect(tempDir);

    expect(result.detectedSources).toEqual(['lovable']);
    expect(result.matches.some(m => m.file === 'package.json')).toBe(true);
  });

  it('detects lovable from root README.md when package.json is clean', async () => {
    await writeFile(join(tempDir, 'package.json'), JSON.stringify({ name: 'app' }));
    await writeFile(join(tempDir, 'README.md'), '# Built with Lovable\n');

    const result = await service.detect(tempDir);

    expect(result.detectedSources).toEqual(['lovable']);
    expect(result.matches.some(m => m.file === 'README.md')).toBe(true);
  });

  it('returns empty detectedSources when no needles match', async () => {
    await writeFile(join(tempDir, 'package.json'), JSON.stringify({ name: 'clean-app' }));
    await writeFile(join(tempDir, 'README.md'), '# Clean app\n');
    await mkdir(join(tempDir, 'src'), { recursive: true });
    await writeFile(join(tempDir, 'src', 'index.ts'), 'export {};\n');

    const result = await service.detect(tempDir);

    expect(result.detectedSources).toEqual([]);
    expect(result.matches).toEqual([]);
  });

  it('ignores package.json under node_modules', async () => {
    await writeFile(join(tempDir, 'package.json'), JSON.stringify({ name: 'app' }));
    await mkdir(join(tempDir, 'node_modules', 'fake'), { recursive: true });
    await writeFile(
      join(tempDir, 'node_modules', 'fake', 'package.json'),
      JSON.stringify({ name: 'lovable-tagger' })
    );

    const result = await service.detect(tempDir);

    expect(result.detectedSources).toEqual([]);
  });

  it('skips files larger than max size during walk', async () => {
    await writeFile(join(tempDir, 'package.json'), JSON.stringify({ name: 'app' }));
    const largeContent = 'x'.repeat(600 * 1024);
    await writeFile(join(tempDir, 'large.ts'), largeContent);

    const result = await service.detect(tempDir);

    expect(result.detectedSources).toEqual([]);
    expect(result.matches.every(m => m.file !== 'large.ts')).toBe(true);
  });

  it('caps walk at 18 files beyond required package.json and README.md', async () => {
    await writeFile(join(tempDir, 'package.json'), JSON.stringify({ name: 'app' }));
    await writeFile(join(tempDir, 'README.md'), '# App\n');

    for (let i = 0; i < 25; i++) {
      const name = `file-${String(i).padStart(2, '0')}.ts`;
      const content = i === 24 ? 'const lovable = true;\n' : `export const n${i} = ${i};\n`;
      await writeFile(join(tempDir, name), content);
    }

    const result = await service.detect(tempDir);

    expect(result.filesScanned).toBeLessThanOrEqual(20);
    expect(result.filesSkippedDueToCap).toBeGreaterThan(0);
    expect(result.detectedSources).toEqual([]);
  });

  it('always scans root package.json even when walk cap would skip it', async () => {
    await writeFile(
      join(tempDir, 'package.json'),
      JSON.stringify({ devDependencies: { 'lovable-tagger': '1.0.0' } })
    );
    await writeFile(join(tempDir, 'README.md'), '# App\n');

    for (let i = 0; i < 25; i++) {
      await writeFile(
        join(tempDir, `file-${String(i).padStart(2, '0')}.ts`),
        `export const n${i} = ${i};\n`
      );
    }

    const result = await service.detect(tempDir);

    expect(result.detectedSources).toEqual(['lovable']);
    expect(result.matches.some(m => m.file === 'package.json')).toBe(true);
  });

  describe('detectAndLog', () => {
    it('logs project-source.detected when sources match', async () => {
      await writeFile(
        join(tempDir, 'package.json'),
        JSON.stringify({ dependencies: { lovable: '1.0.0' } })
      );

      await service.detectAndLog({
        appId: 'app-1',
        appPath: tempDir,
        jobId: 'job-1',
        trigger: 'zip_import',
      });

      expect(mockLogger.info).toHaveBeenCalledWith(
        'project-source.detected',
        expect.objectContaining({
          appId: 'app-1',
          jobId: 'job-1',
          trigger: 'zip_import',
          detectedSources: 'lovable',
          matches: 'lovable:package.json:1',
        })
      );
    });

    it('formatDetectedSourcesForLog joins multiple sources with commas', () => {
      expect(formatDetectedSourcesForLog(['lovable'])).toBe('lovable');
    });

    it('formatMatchesForLog joins matches with commas and includes line numbers', () => {
      expect(
        formatMatchesForLog([
          { source: 'lovable', file: 'package.json', line: 3 },
          { source: 'lovable', file: 'README.md' },
        ])
      ).toBe('lovable:package.json:3,lovable:README.md');
    });

    it('logs project-source.detect.none when no sources match', async () => {
      await writeFile(join(tempDir, 'package.json'), JSON.stringify({ name: 'app' }));

      await service.detectAndLog({
        appId: 'app-2',
        appPath: tempDir,
        jobId: 'job-2',
        trigger: 'git_pull',
      });

      expect(mockLogger.info).toHaveBeenCalledWith(
        'project-source.detect.none',
        expect.objectContaining({
          appId: 'app-2',
          trigger: 'git_pull',
        })
      );
    });

    it('logs project-source.detect.failed and returns empty on error', async () => {
      const result = await service.detectAndLog({
        appId: 'app-3',
        appPath: '/nonexistent/path/that/does/not/exist',
        jobId: 'job-3',
        trigger: 'zip_import',
      });

      expect(result.detectedSources).toEqual([]);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'project-source.detect.failed',
        expect.objectContaining({ appId: 'app-3', jobId: 'job-3' })
      );
    });
  });

  describe('detectAndLogInBackground', () => {
    it('does not block the caller while detectAndLog is in flight', async () => {
      let resolveDetect!: () => void;
      const detectGate = new Promise<void>((resolve) => {
        resolveDetect = resolve;
      });

      const detectAndLogSpy = vi.spyOn(service, 'detectAndLog').mockImplementation(async () => {
        await detectGate;
        return {
          detectedSources: [],
          matches: [],
          filesScanned: 0,
          filesSkippedDueToCap: 0,
        };
      });

      let continuedBeforeDetect = false;
      const returnValue = service.detectAndLogInBackground({
        appId: 'app-bg',
        appPath: tempDir,
        jobId: 'job-bg',
        trigger: 'zip_import',
      });
      continuedBeforeDetect = true;

      expect(returnValue).toBeUndefined();
      expect(continuedBeforeDetect).toBe(true);
      expect(detectAndLogSpy).toHaveBeenCalledWith({
        appId: 'app-bg',
        appPath: tempDir,
        jobId: 'job-bg',
        trigger: 'zip_import',
      });

      resolveDetect();
      await detectAndLogSpy.mock.results[0]?.value;

      detectAndLogSpy.mockRestore();
    });

    it('logs background-error when detectAndLog rejects unexpectedly', async () => {
      const detectAndLogSpy = vi
        .spyOn(service, 'detectAndLog')
        .mockRejectedValue(new Error('unexpected failure'));

      service.detectAndLogInBackground({
        appId: 'app-bg-err',
        appPath: tempDir,
        jobId: 'job-bg-err',
        trigger: 'git_pull',
      });

      await vi.waitFor(() => {
        expect(mockLogger.warn).toHaveBeenCalledWith(
          'project-source.detect.background-error',
          expect.objectContaining({
            appId: 'app-bg-err',
            jobId: 'job-bg-err',
            trigger: 'git_pull',
            error: 'unexpected failure',
          })
        );
      });

      detectAndLogSpy.mockRestore();
    });
  });
});
