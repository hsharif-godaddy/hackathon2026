import { readFile, readdir, access } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { parse as parseYaml } from 'yaml';

import { CorpusSchema, type Corpus, type TestCase } from './types.js';

/**
 * Expand environment variables in strings
 * Supports ${VAR_NAME} syntax
 */
function expandEnvVariables(value: string): string {
  return value.replace(/\$\{([^}]+)\}/g, (_, envVar) => {
    return process.env[envVar] || '';
  });
}

/**
 * Recursively expand environment variables in an object
 */
function expandEnvInObject(obj: unknown): unknown {
  if (typeof obj === 'string') {
    return expandEnvVariables(obj);
  }
  if (Array.isArray(obj)) {
    return obj.map(expandEnvInObject);
  }
  if (obj !== null && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = expandEnvInObject(value);
    }
    return result;
  }
  return obj;
}

/**
 * Load a single corpus file
 */
export async function loadCorpus(filePath: string): Promise<Corpus> {
  const content = await readFile(filePath, 'utf-8');
  const ext = extname(filePath).toLowerCase();

  let parsed: unknown;
  if (ext === '.yaml' || ext === '.yml') {
    parsed = parseYaml(content);
  } else if (ext === '.json') {
    parsed = JSON.parse(content);
  } else {
    throw new Error(`Unsupported file format: ${ext}. Use .yaml, .yml, or .json`);
  }

  // Expand environment variables
  const expanded = expandEnvInObject(parsed);

  // Validate against schema
  const result = CorpusSchema.safeParse(expanded);
  if (!result.success) {
    const errors = result.error.errors.map(e => `  ${e.path.join('.')}: ${e.message}`).join('\n');
    throw new Error(`Invalid corpus file ${filePath}:\n${errors}`);
  }

  return result.data;
}

/**
 * Load all corpus files from a directory (recursively)
 */
export async function loadAllCorpora(dir: string): Promise<Corpus[]> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  const corpusFiles = entries
    .filter(entry => entry.isFile())
    .filter(entry =>
      entry.name.endsWith('.yaml') || entry.name.endsWith('.yml') || entry.name.endsWith('.json')
    )
    .map(entry => {
      if (!entry.parentPath) {
        throw new Error(`parentPath not available - Node >= 20.12 required`);
      }
      return join(entry.parentPath, entry.name);
    });

  if (corpusFiles.length === 0) {
    throw new Error(`No corpus files found in ${dir}`);
  }

  const corpora: Corpus[] = [];
  for (const file of corpusFiles) {
    const corpus = await loadCorpus(file);
    corpora.push(corpus);
  }

  return corpora;
}

/**
 * Merge multiple corpora into a single corpus
 */
export function mergeCorpora(corpora: Corpus[]): Corpus {
  if (corpora.length === 0) {
    throw new Error('No corpora to merge');
  }

  if (corpora.length === 1) {
    return corpora[0];
  }

  // Validate all corpora target the same agent
  const agents = new Set(corpora.map(c => c.metadata.agent));
  if (agents.size > 1) {
    const agentList = Array.from(agents).join(', ');
    throw new Error(
      `Cannot merge corpora targeting different agents: ${agentList}. ` +
      `All corpus files in a directory must have the same metadata.agent value.`
    );
  }

  // Warn if corpora have different configs (first file's config is used)
  const firstConfig = corpora[0].config;
  for (let i = 1; i < corpora.length; i++) {
    const otherConfig = corpora[i].config;
    if (otherConfig && firstConfig) {
      if (otherConfig.timeoutMs !== firstConfig.timeoutMs ||
          otherConfig.defaultModel !== firstConfig.defaultModel) {
        console.warn(
          `Warning: Corpus "${corpora[i].metadata.name}" has different config than ` +
          `"${corpora[0].metadata.name}". Using first file's config for all cases.`
        );
        break; // Only warn once
      }
    }
  }

  // Use first corpus metadata and config as base
  // Note: When merging, the first file's config (timeoutMs, defaultModel) applies to all cases.
  // If individual files need different configs, run them separately.
  const merged: Corpus = {
    metadata: {
      ...corpora[0].metadata,
      name: `Merged: ${corpora.map(c => c.metadata.name).join(', ')}`,
    },
    config: corpora[0].config,
    cases: [],
  };

  // Collect all cases, checking for duplicate IDs
  const seenIds = new Set<string>();
  for (const corpus of corpora) {
    for (const testCase of corpus.cases) {
      if (seenIds.has(testCase.id)) {
        throw new Error(`Duplicate test case ID: ${testCase.id}`);
      }
      seenIds.add(testCase.id);
      merged.cases.push(testCase);
    }
  }

  return merged;
}

/**
 * Filter test cases by tags
 */
export function filterByTags(corpus: Corpus, includeTags: string[]): Corpus {
  if (includeTags.length === 0) {
    return corpus;
  }

  const includeSet = new Set(includeTags);
  const filteredCases = corpus.cases.filter(testCase =>
    testCase.tags.some(tag => includeSet.has(tag))
  );

  return {
    ...corpus,
    cases: filteredCases,
  };
}

/**
 * Filter out skipped test cases
 */
export function filterSkipped(corpus: Corpus): { corpus: Corpus; skippedCount: number } {
  const skippedCases = corpus.cases.filter(c => c.skip);
  const activeCases = corpus.cases.filter(c => !c.skip);

  return {
    corpus: {
      ...corpus,
      cases: activeCases,
    },
    skippedCount: skippedCases.length,
  };
}

/**
 * Check if a path exists and is accessible
 */
export async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get test cases grouped by a specific tag prefix
 * e.g., groupByTagPrefix(corpus, 'lang:') returns { 'lang:en': [...], 'lang:es': [...] }
 */
export function groupByTagPrefix(
  cases: TestCase[],
  prefix: string
): Record<string, TestCase[]> {
  const groups: Record<string, TestCase[]> = {};

  for (const testCase of cases) {
    for (const tag of testCase.tags) {
      if (tag.startsWith(prefix)) {
        if (!groups[tag]) {
          groups[tag] = [];
        }
        groups[tag].push(testCase);
      }
    }
  }

  return groups;
}
