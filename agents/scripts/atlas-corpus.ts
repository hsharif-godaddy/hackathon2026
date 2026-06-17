import { access, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { getS2SToken } from '@airo/ai-lib';

import {
  corpusFixturePaths,
  loadMergedCorpus,
  normalizeCorpusLookupKey,
  type AtlasJobCorpusEntry,
  type AtlasJobCorpusFile,
} from '../src/services/atlas-job-corpus.js';

const { localPath } = corpusFixturePaths();

function usage(): never {
  console.error(`Usage:
  atlas-corpus list
  atlas-corpus set <url> <jobId> [--note "..."] [--max-pages N] [--root-path /]
  atlas-corpus remove <url>
  atlas-corpus refresh <url> [--max-pages 20] [--root-path /] [--note "..."]

Requires agents/.env (S2S + ATLAS_API_BASE_URL) for refresh.
Enable reuse in dev: ATLAS_JOB_CORPUS=true in agents/.env`);
  process.exit(1);
}

async function readLocalCorpus(): Promise<AtlasJobCorpusFile> {
  try {
    await access(localPath);
  } catch {
    return {};
  }
  return JSON.parse(await readFile(localPath, 'utf-8')) as AtlasJobCorpusFile;
}

async function writeLocalCorpus(corpus: AtlasJobCorpusFile): Promise<void> {
  await writeFile(localPath, `${JSON.stringify(corpus, null, 2)}\n`, 'utf-8');
  console.log(`Updated ${localPath}`);
}

function parseFlag(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) {
    return undefined;
  }
  return args[index + 1];
}

async function list(): Promise<void> {
  const merged = await loadMergedCorpus();
  const keys = Object.keys(merged).sort();
  if (keys.length === 0) {
    console.log('Atlas job corpus is empty.');
    console.log(`Add entries with: pnpm --filter @airo/agents atlas-corpus set <url> <jobId>`);
    return;
  }
  for (const key of keys) {
    const entry = merged[key];
    console.log(`${key}`);
    console.log(`  jobId: ${entry.jobId}`);
    if (entry.scrapedAt) console.log(`  scrapedAt: ${entry.scrapedAt}`);
    if (entry.maxPages !== undefined) console.log(`  maxPages: ${String(entry.maxPages)}`);
    if (entry.rootPath) console.log(`  rootPath: ${entry.rootPath}`);
    if (entry.note) console.log(`  note: ${entry.note}`);
  }
}

function parsePositiveIntFlag(args: string[], flag: string, label: string): number | undefined {
  const raw = parseFlag(args, flag);
  if (!raw) {
    return undefined;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer (got "${raw}")`);
  }
  return value;
}

async function set(args: string[]): Promise<void> {
  const url = args[0];
  const jobId = args[1];
  if (!url || !jobId) {
    usage();
  }
  const note = parseFlag(args, '--note');
  const maxPages = parsePositiveIntFlag(args, '--max-pages', '--max-pages');
  const rootPath = parseFlag(args, '--root-path');
  const key = normalizeCorpusLookupKey(url);
  const entry: AtlasJobCorpusEntry = {
    jobId,
    scrapedAt: new Date().toISOString(),
    ...(note ? { note } : {}),
    ...(maxPages !== undefined ? { maxPages } : {}),
    ...(rootPath ? { rootPath } : {}),
  };
  const corpus = await readLocalCorpus();
  corpus[key] = entry;
  await writeLocalCorpus(corpus);
  console.log(`Mapped ${key} → ${jobId}`);
}

async function remove(args: string[]): Promise<void> {
  const url = args[0];
  if (!url) {
    usage();
  }
  const key = normalizeCorpusLookupKey(url);
  const corpus = await readLocalCorpus();
  if (!(key in corpus)) {
    console.log(`No local entry for ${key}`);
    return;
  }
  delete corpus[key];
  await writeLocalCorpus(corpus);
  console.log(`Removed ${key}`);
}

async function refresh(args: string[]): Promise<void> {
  const url = args[0];
  if (!url) {
    usage();
  }
  const maxPages = parsePositiveIntFlag(args, '--max-pages', '--max-pages') ?? 20;
  const rootPath = parseFlag(args, '--root-path') ?? '/';
  const note = parseFlag(args, '--note');
  const baseUrl = process.env.ATLAS_API_BASE_URL ?? 'https://atlas.dev-gdcorp.tools';
  const token = await getS2SToken();
  const auth = `sso-jwt ${token}`;

  const submitResponse = await fetch(`${baseUrl}/crawl`, {
    method: 'POST',
    headers: {
      Authorization: auth,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      url,
      options: {
        maxPages,
        maxDepth: 3,
        concurrency: 3,
        timeout: 30000,
        useSitemap: true,
        headless: true,
        seedPaths: [rootPath],
        output: 'full',
        include: {
          html: true,
          text: true,
          assets: true,
          structuredData: true,
          visual: true,
        },
        screenshot: {
          enabled: true,
          format: 'png',
          fullPage: true,
        },
        downloadAssets: true,
        ssrfProtection: 'strict',
        respectRobotsTxt: true,
      },
    }),
  });
  if (!submitResponse.ok) {
    throw new Error(`Atlas submit failed (${String(submitResponse.status)}): ${await submitResponse.text()}`);
  }
  const submitBody = await submitResponse.json() as { jobId: string };
  const jobId = submitBody.jobId;
  console.log(`Submitted crawl ${jobId} for ${url}`);

  const deadline = Date.now() + 300_000;
  let completed = false;
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 2000));
    const statusResponse = await fetch(`${baseUrl}/jobs/${jobId}`, {
      headers: { Authorization: auth },
    });
    if (!statusResponse.ok) {
      throw new Error(`Atlas status failed (${String(statusResponse.status)}): ${await statusResponse.text()}`);
    }
    const statusBody = await statusResponse.json() as { status: string; error?: string };
    console.log(`  status: ${statusBody.status}`);
    if (statusBody.status === 'completed') {
      completed = true;
      break;
    }
    if (statusBody.status === 'failed') {
      throw new Error(`Atlas crawl failed: ${statusBody.error ?? 'unknown error'}`);
    }
  }
  if (!completed) {
    throw new Error(`Atlas crawl timed out after 300s (jobId: ${jobId})`);
  }

  const key = normalizeCorpusLookupKey(url);
  const corpus = await readLocalCorpus();
  corpus[key] = {
    jobId,
    scrapedAt: new Date().toISOString(),
    maxPages,
    rootPath,
    ...(note ? { note } : {}),
  };
  await writeLocalCorpus(corpus);
  console.log(`Saved ${key} → ${jobId}`);
}

const [command, ...rest] = process.argv.slice(2);
if (!command) {
  usage();
}

try {
  if (command === 'list') {
    await list();
  } else if (command === 'set') {
    await set(rest);
  } else if (command === 'remove') {
    await remove(rest);
  } else if (command === 'refresh') {
    await refresh(rest);
  } else {
    usage();
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
