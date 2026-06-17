import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Logger } from '../logging/index.js';

const logger = Logger.create({ component: 'atlas-job-corpus' });

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.resolve(moduleDir, '../../fixtures');
const defaultCorpusPath = path.join(fixturesDir, 'atlas-job-corpus.json');
const localCorpusPath = path.join(fixturesDir, 'atlas-job-corpus.local.json');

/** Atlas S3 results expire after ~90 days; warn before reuse gets flaky. */
const CORPUS_STALE_WARN_DAYS = 80;

export interface AtlasJobCorpusEntry {
  jobId: string;
  scrapedAt?: string;
  note?: string;
  maxPages?: number;
  rootPath?: string;
}

export type AtlasJobCorpusFile = Record<string, AtlasJobCorpusEntry>;

export interface CorpusResolveOptions {
  rootPath?: string;
  maxPages?: number;
}

export interface CorpusResolveResult {
  key: string;
  entry: AtlasJobCorpusEntry;
}

export function isAtlasJobCorpusEnabled(): boolean {
  if (process.env.ATLAS_JOB_CORPUS !== 'true') {
    return false;
  }
  return (process.env.GASKET_ENV ?? '').startsWith('local');
}

export function isAtlasJobCorpusForce(): boolean {
  return process.env.ATLAS_JOB_CORPUS_FORCE === 'true';
}

export function normalizeCorpusLookupKey(sourceUrl: string): string {
  const parsed = new URL(sourceUrl);
  const host = parsed.hostname.toLowerCase();
  const port =
    parsed.port && !isDefaultPort(parsed.protocol, parsed.port) ? `:${parsed.port}` : '';
  let pathname = parsed.pathname || '/';
  if (pathname !== '/' && pathname.endsWith('/')) {
    pathname = pathname.slice(0, -1);
  }
  return `${parsed.protocol}//${host}${port}${pathname === '/' ? '/' : pathname}`;
}

function isDefaultPort(protocol: string, port: string): boolean {
  return (protocol === 'https:' && port === '443') || (protocol === 'http:' && port === '80');
}

function corpusPaths(): string[] {
  const paths = [defaultCorpusPath, localCorpusPath];
  const custom = process.env.ATLAS_JOB_CORPUS_PATH?.trim();
  if (custom) {
    paths.push(path.resolve(custom));
  }
  return paths;
}

async function readCorpusFile(filePath: string): Promise<AtlasJobCorpusFile> {
  try {
    await access(filePath);
  } catch {
    return {};
  }
  try {
    const raw = await readFile(filePath, 'utf-8');
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      logger.warn('atlas-job-corpus.file-invalid', {
        filePath,
        message: 'Expected JSON object; skipping file',
      });
      return {};
    }
    return parsed as AtlasJobCorpusFile;
  } catch (error) {
    logger.warn('atlas-job-corpus.file-unreadable', {
      filePath,
      error: error instanceof Error ? error.message : String(error),
      message: 'Skipping unreadable corpus file',
    });
    return {};
  }
}

export async function loadMergedCorpus(): Promise<AtlasJobCorpusFile> {
  const merged: AtlasJobCorpusFile = {};
  for (const filePath of corpusPaths()) {
    Object.assign(merged, await readCorpusFile(filePath));
  }
  return merged;
}

function entryMatchesRequest(
  entry: AtlasJobCorpusEntry,
  options: CorpusResolveOptions,
): boolean {
  const requestRoot = (options.rootPath ?? '/').replace(/\/$/, '') || '/';
  if (entry.rootPath !== undefined) {
    const entryRoot = entry.rootPath.replace(/\/$/, '') || '/';
    if (entryRoot !== requestRoot) {
      return false;
    }
  }
  if (
    entry.maxPages !== undefined
    && options.maxPages !== undefined
    && options.maxPages > entry.maxPages
  ) {
    return false;
  }
  return true;
}

function warnIfStale(entry: AtlasJobCorpusEntry, key: string): void {
  if (!entry.scrapedAt) {
    return;
  }
  const scrapedMs = Date.parse(entry.scrapedAt);
  if (Number.isNaN(scrapedMs)) {
    return;
  }
  const ageDays = (Date.now() - scrapedMs) / (1000 * 60 * 60 * 24);
  if (ageDays >= CORPUS_STALE_WARN_DAYS) {
    logger.warn('atlas-job-corpus.entry-stale', {
      key,
      jobId: entry.jobId,
      scrapedAt: entry.scrapedAt,
      ageDays: Math.floor(ageDays),
      message: 'Atlas S3 results expire after ~90 days; refresh the corpus entry',
    });
  }
}

export async function resolveCorpusEntry(
  sourceUrl: string,
  options: CorpusResolveOptions = {},
): Promise<CorpusResolveResult | null> {
  if (!isAtlasJobCorpusEnabled() || isAtlasJobCorpusForce()) {
    return null;
  }

  try {
    const key = normalizeCorpusLookupKey(sourceUrl);
    const corpus = await loadMergedCorpus();
    const entry = corpus[key];
    if (!entry?.jobId) {
      return null;
    }

    if (!entryMatchesRequest(entry, options)) {
      logger.info('atlas-job-corpus.entry-skipped', {
        key,
        jobId: entry.jobId,
        reason: 'options-mismatch',
        requestRootPath: options.rootPath ?? '/',
        entryRootPath: entry.rootPath,
        requestMaxPages: options.maxPages,
        entryMaxPages: entry.maxPages,
      });
      return null;
    }

    warnIfStale(entry, key);
    return { key, entry };
  } catch (error) {
    logger.warn('atlas-job-corpus.resolve-failed', {
      sourceUrl,
      error: error instanceof Error ? error.message : String(error),
      message: 'Corpus lookup failed; falling back to live Atlas crawl',
    });
    return null;
  }
}

export function corpusFixturePaths(): { defaultPath: string; localPath: string } {
  return { defaultPath: defaultCorpusPath, localPath: localCorpusPath };
}
