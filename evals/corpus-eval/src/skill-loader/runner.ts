import { readFile, readdir, stat } from 'node:fs/promises';
import { join, extname, basename } from 'node:path';

import { parse as parseYaml } from 'yaml';

import { SkillCorpusSchema, type SkillCase, type SkillCaseResult } from './types.js';
import { SkillLoaderEvaluator } from './evaluator.js';

interface RunOptions {
  verbose?: boolean;
}

async function loadCasesFromFile(filePath: string): Promise<{ name: string; cases: SkillCase[] }> {
  const content = await readFile(filePath, 'utf-8');
  const ext = extname(filePath).toLowerCase();

  const raw = ext === '.json' ? JSON.parse(content) : parseYaml(content);
  const result = SkillCorpusSchema.safeParse(raw);

  if (!result.success) {
    const issues = result.error.issues.map(i => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid corpus file ${filePath}:\n${issues}`);
  }

  return { name: result.data.metadata.name, cases: result.data.cases };
}

async function loadAllCases(corpusPath: string): Promise<{ name: string; cases: SkillCase[] }[]> {
  const info = await stat(corpusPath);

  if (info.isFile()) {
    return [await loadCasesFromFile(corpusPath)];
  }

  const entries = await readdir(corpusPath, { withFileTypes: true });
  const yamlFiles = entries
    .filter(e => e.isFile() && (e.name.endsWith('.yaml') || e.name.endsWith('.yml')))
    .map(e => join(corpusPath, e.name));

  if (yamlFiles.length === 0) {
    throw new Error(`No YAML files found in ${corpusPath}`);
  }

  return Promise.all(yamlFiles.map(loadCasesFromFile));
}

function printSummary(
  corpusName: string,
  results: SkillCaseResult[]
): void {
  const total = results.length;
  const passed = results.filter(r => r.passed).length;
  const failed = total - passed;
  const accuracy = total > 0 ? Math.round((passed / total) * 100) : 0;

  const latencies = results.map(r => r.latencyMs).sort((a, b) => a - b);
  const avgLatency = latencies.length > 0
    ? Math.round(latencies.reduce((s, v) => s + v, 0) / latencies.length)
    : 0;
  const p95Latency = latencies.length > 0
    ? latencies[Math.min(Math.floor(latencies.length * 0.95), latencies.length - 1)]
    : 0;

  console.log(`\n${corpusName}`);
  console.log('='.repeat(Math.min(corpusName.length, 60)));
  console.log(`Total: ${total}  Passed: ${passed}  Failed: ${failed}  Accuracy: ${accuracy}%`);
  console.log(`Avg latency: ${avgLatency}ms  p95: ${p95Latency}ms`);

  const failures = results.filter(r => !r.passed);
  if (failures.length > 0) {
    console.log('');
    for (const r of failures) {
      console.log(`  FAIL  [${r.caseId}] ${r.failures.join('; ')}`);
    }
  }
}

export interface SkillRunResult {
  passed: boolean;
  totalCases: number;
  passedCases: number;
  failedCases: number;
}

export async function runSkillLoader(corpusPath: string, options: RunOptions = {}): Promise<SkillRunResult> {
  const allCorpora = await loadAllCases(corpusPath);

  const evaluator = new SkillLoaderEvaluator();
  await evaluator.initialize();

  let totalCases = 0;
  let passedCases = 0;
  let failedCases = 0;

  try {
    for (const { name, cases } of allCorpora) {
      const active = cases.filter(c => !c.skip);
      const skipped = cases.length - active.length;

      if (options.verbose && skipped > 0) {
        console.log(`\nSkipping ${skipped} case(s) in "${name}"`);
      }

      if (active.length === 0) {
        console.log(`\nNo active cases in "${name}" — skipped entirely`);
        continue;
      }

      if (options.verbose) {
        console.log(`\nRunning "${name}" (${active.length} cases)...`);
      }

      const results = await evaluator.run(active, options);
      printSummary(name, results);

      totalCases += results.length;
      passedCases += results.filter(r => r.passed).length;
      failedCases += results.filter(r => !r.passed).length;
    }
  } finally {
    await evaluator.cleanup();
  }

  return { passed: failedCases === 0, totalCases, passedCases, failedCases };
}
