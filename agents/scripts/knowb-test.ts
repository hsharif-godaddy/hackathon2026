#!/usr/bin/env npx tsx
/**
 * KnowB Retrieval Test — mirrors the exact pipeline used by agents/KnowBDriver.
 *
 * Imports KnowBDriver directly so any driver change flows through.
 * Run:
 *   SSO_JWT=... npx tsx scripts/knowb-test.ts
 */
import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: resolve(__dirname, '..', '.env') });

import { KnowBDriver } from '../src/tools/ai-lib-tools/drivers/knowb-driver.js';

const KB_NODE = '/airo_info';

interface TestQuery {
  query: string;
  expected: string | null;
  category: 'media' | 'deploy' | 'models' | 'ambig' | 'irrelevant';
}

const QUERIES: TestQuery[] = [
  // Media
  { query: 'I need a nice header image for my bakery website', expected: 'media_manager', category: 'media' },
  { query: 'can you add a photo gallery to my portfolio page', expected: 'media_manager', category: 'media' },
  { query: 'how do I upload my company logo', expected: 'media_manager', category: 'media' },
  { query: 'I want a background video on my landing page', expected: 'media_manager', category: 'media' },
  { query: 'create an AI generated banner for my homepage', expected: 'media_manager', category: 'media' },

  // Deployment
  { query: 'can people see my website yet', expected: 'deployment', category: 'deploy' },
  { query: 'my site looks good how do I make it live', expected: 'deployment', category: 'deploy' },
  { query: 'publish my changes', expected: 'deployment', category: 'deploy' },
  { query: 'I finished building can you deploy it now', expected: 'deployment', category: 'deploy' },
  { query: 'how long does it take to go live', expected: 'deployment', category: 'deploy' },

  // Models (new doc)
  { query: 'what AI models are available', expected: 'llm-models', category: 'models' },
  { query: 'can I use claude', expected: 'llm-models', category: 'models' },

  // Ambiguous
  { query: 'make my site look more professional', expected: null, category: 'ambig' },
  { query: 'help me build a restaurant website with online ordering', expected: null, category: 'ambig' },

  // Irrelevant
  { query: 'what is the weather today', expected: null, category: 'irrelevant' },
  { query: 'how to fix a leaking faucet', expected: null, category: 'irrelevant' },
  { query: 'best pizza in new york', expected: null, category: 'irrelevant' },
];

function docName(kbNodeId: string): string {
  return kbNodeId.replace(`${KB_NODE}/`, '').replace('.md', '');
}

async function main() {
  if (!process.env.SSO_JWT && process.env.GOCODE_USE_S2S_AUTH !== 'true') {
    console.error('Set SSO_JWT or GOCODE_USE_S2S_AUTH=true');
    process.exit(1);
  }

  const driver = new KnowBDriver();

  console.log('KnowB Retrieval Test — AGENTS driver pipeline (exact)');
  console.log(`Node: ${KB_NODE} | Queries: ${QUERIES.length}`);
  console.log('Config: LEX+SEM + COHERE rerank + overFetch=15 + dedup + topK=3, threshold=0.0');
  console.log('');

  let top1Correct = 0;
  let top1Relevant = 0;
  let irrelevantRejected = 0;
  let irrelevantShown = 0;
  const gaps: number[] = [];

  for (const q of QUERIES) {
    const start = Date.now();
    const result = await driver.search({
      query: q.query,
      kbNodeIds: [KB_NODE],
      // Driver defaults: maxResults=3, scoreThreshold=0.0 — leave unset to match prod
    });
    const ms = Date.now() - start;

    const results = (result.results ?? []).map((r) => ({
      doc: docName(r.kbNodeId),
      score: r.score,
    }));

    console.log(`QUERY: "${q.query}"   expected=${q.expected ?? 'none'}   [${q.category}]`);
    if (!result.success) {
      console.log(`  ERROR: ${result.error}`);
    } else if (results.length === 0) {
      console.log(`  (no results) ${ms}ms`);
    } else {
      const rows = results.map((r, i) => {
        const mark = q.expected && r.doc === q.expected && i === 0 ? ' ✓' : '';
        return `#${i + 1} ${r.doc.padEnd(20)} ${r.score.toFixed(4)}${mark}`;
      });
      console.log(`  ${rows.join('  |  ')}   ${ms}ms`);
    }
    console.log('');

    if (q.category === 'irrelevant') {
      if (results.length === 0) irrelevantRejected++;
      else irrelevantShown++;
    } else if (q.expected) {
      top1Relevant++;
      if (results.length > 0 && results[0].doc === q.expected) top1Correct++;
      if (results.length >= 2) gaps.push(results[0].score - results[1].score);
    }
  }

  const acc = top1Relevant > 0 ? (top1Correct / top1Relevant) * 100 : 0;
  const avgGap = gaps.length > 0 ? gaps.reduce((a, b) => a + b, 0) / gaps.length : 0;
  const totalIrrel = irrelevantRejected + irrelevantShown;
  const rejectRate = totalIrrel > 0 ? (irrelevantRejected / totalIrrel) * 100 : 0;

  console.log('═'.repeat(90));
  console.log('SUMMARY (agents driver)');
  console.log('═'.repeat(90));
  console.log(`  Top-1 accuracy (expected known): ${top1Correct}/${top1Relevant} (${acc.toFixed(1)}%)`);
  console.log(`  Avg gap #1 → #2 (raw Cohere):    ${avgGap.toFixed(4)}`);
  console.log(`  Irrelevant rejected:             ${irrelevantRejected}/${totalIrrel} (${rejectRate.toFixed(1)}%)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
