import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  isAtlasJobCorpusEnabled,
  isAtlasJobCorpusForce,
  loadMergedCorpus,
  normalizeCorpusLookupKey,
  resolveCorpusEntry,
} from '../atlas-job-corpus.js';

describe('atlas-job-corpus', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'atlas-corpus-'));
    delete process.env.ATLAS_JOB_CORPUS;
    delete process.env.ATLAS_JOB_CORPUS_FORCE;
    delete process.env.GASKET_ENV;
    delete process.env.ATLAS_JOB_CORPUS_PATH;
  });

  afterEach(() => {
    delete process.env.ATLAS_JOB_CORPUS_PATH;
  });

  describe('#normalizeCorpusLookupKey', () => {
    it('lowercases host and normalizes root trailing slash', function rootSlash() {
      expect(normalizeCorpusLookupKey('https://Example.COM')).toBe('https://example.com/');
      expect(normalizeCorpusLookupKey('https://example.com/')).toBe('https://example.com/');
    });

    it('preserves sub-path without trailing slash', function subPath() {
      expect(normalizeCorpusLookupKey('https://showin.bio/my3blife/')).toBe('https://showin.bio/my3blife');
    });
  });

  describe('#isAtlasJobCorpusEnabled', () => {
    it('requires local gasket env and ATLAS_JOB_CORPUS=true', function gating() {
      process.env.ATLAS_JOB_CORPUS = 'true';
      process.env.GASKET_ENV = 'local.dev';
      expect(isAtlasJobCorpusEnabled()).toBe(true);

      process.env.GASKET_ENV = 'prod';
      expect(isAtlasJobCorpusEnabled()).toBe(false);

      process.env.GASKET_ENV = 'local.dev';
      delete process.env.ATLAS_JOB_CORPUS;
      expect(isAtlasJobCorpusEnabled()).toBe(false);
    });
  });

  describe('#isAtlasJobCorpusForce', () => {
    it('is true only when ATLAS_JOB_CORPUS_FORCE=true', function forceFlag() {
      expect(isAtlasJobCorpusForce()).toBe(false);
      process.env.ATLAS_JOB_CORPUS_FORCE = 'true';
      expect(isAtlasJobCorpusForce()).toBe(true);
    });
  });

  describe('#resolveCorpusEntry', () => {
    async function writeTempCorpus(data: Record<string, unknown>): Promise<void> {
      process.env.ATLAS_JOB_CORPUS_PATH = path.join(tempDir, 'corpus.json');
      await writeFile(process.env.ATLAS_JOB_CORPUS_PATH, JSON.stringify(data, null, 2));
    }

    it('returns null when corpus is disabled', async function disabled() {
      await expect(resolveCorpusEntry('https://example.com')).resolves.toBeNull();
    });

    it('returns null when force flag is set', async function forced() {
      process.env.ATLAS_JOB_CORPUS = 'true';
      process.env.GASKET_ENV = 'local.dev';
      process.env.ATLAS_JOB_CORPUS_FORCE = 'true';
      await writeTempCorpus({
        'https://example.com/': { jobId: 'job-123' },
      });
      await expect(resolveCorpusEntry('https://example.com')).resolves.toBeNull();
    });

    it('skips entry when maxPages exceeds corpus cap', async function maxPagesMismatch() {
      process.env.ATLAS_JOB_CORPUS = 'true';
      process.env.GASKET_ENV = 'local.dev';
      await writeTempCorpus({
        'https://example.com/': {
          jobId: 'job-123',
          maxPages: 5,
        },
      });
      await expect(
        resolveCorpusEntry('https://example.com', { maxPages: 20 }),
      ).resolves.toBeNull();
    });

    it('returns entry when enabled and key matches', async function hit() {
      process.env.ATLAS_JOB_CORPUS = 'true';
      process.env.GASKET_ENV = 'local.dev';
      await writeTempCorpus({
        'https://example.com/': {
          jobId: 'job-456',
          maxPages: 20,
          rootPath: '/',
        },
      });
      await expect(
        resolveCorpusEntry('https://Example.com', { maxPages: 20, rootPath: '/' }),
      ).resolves.toEqual({
        key: 'https://example.com/',
        entry: {
          jobId: 'job-456',
          maxPages: 20,
          rootPath: '/',
        },
      });
    });
    it('returns null on malformed source URL', async function badUrl() {
      process.env.ATLAS_JOB_CORPUS = 'true';
      process.env.GASKET_ENV = 'local.dev';
      await expect(resolveCorpusEntry('not-a-url')).resolves.toBeNull();
    });

    it('returns null when corpus file contains invalid JSON', async function corruptFile() {
      process.env.ATLAS_JOB_CORPUS = 'true';
      process.env.GASKET_ENV = 'local.dev';
      process.env.ATLAS_JOB_CORPUS_PATH = path.join(tempDir, 'corrupt.json');
      await writeFile(process.env.ATLAS_JOB_CORPUS_PATH, '{not json');
      await expect(
        resolveCorpusEntry('https://example.com', { maxPages: 20 }),
      ).resolves.toBeNull();
    });
  });

  describe('#loadMergedCorpus', () => {
    it('merges custom ATLAS_JOB_CORPUS_PATH entries', async function customPath() {
      process.env.ATLAS_JOB_CORPUS_PATH = path.join(tempDir, 'custom.json');
      await writeFile(
        process.env.ATLAS_JOB_CORPUS_PATH,
        JSON.stringify({
          'https://example.com/': { jobId: 'custom-job' },
        }),
      );
      const corpus = await loadMergedCorpus();
      expect(corpus['https://example.com/']?.jobId).toBe('custom-job');
    });
  });
});
