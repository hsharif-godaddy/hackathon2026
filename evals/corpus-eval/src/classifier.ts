#!/usr/bin/env node

/**
 * Classifier accuracy eval.
 *
 * Verifies that the chat-upload classifier produces the correct
 * `placementIntent` (display_on_site | reference_only | unclear) for a given
 * user prompt. placementIntent is the high-stakes field that drives whether an
 * uploaded image is placed on the site, used only as design reference, or
 * deferred — so it deserves direct measurement, separate from skill routing.
 *
 * The image content is held constant (a neutral placeholder) on purpose: this
 * corpus isolates the *prompt-driven* intent decision, which is the part most
 * likely to regress. Image-content-dependent cases can be added later by
 * pointing a case at a real fixture via `imageBase64`.
 *
 * Run (needs GoCode creds, like the skill-loader eval):
 *   pnpm --filter corpus-eval eval:classifier
 *   pnpm --filter corpus-eval eval:classifier:run corpora/classifier/upload-intent.yaml --verbose
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { deflateSync } from 'node:zlib';

import { Command } from 'commander';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { classifyUploadImage } from '@airo/agents';

const PlacementIntentSchema = z.enum(['display_on_site', 'reference_only', 'unclear']);

const ClassifierCaseSchema = z.object({
  id: z.string(),
  prompt: z.string(),
  expectedPlacementIntent: PlacementIntentSchema,
  // Optional stricter assertion on the placed-asset role.
  expectedAssetRole: z.enum(['logo', 'hero_image', 'background']).nullable().optional(),
  // Optional real-image fixture (base64, no data-url prefix). Defaults to the
  // neutral placeholder when omitted.
  imageBase64: z.string().optional(),
  tags: z.array(z.string()).optional().default([]),
  rationale: z.string().optional(),
  skip: z.boolean().optional().default(false),
});

const ClassifierCorpusSchema = z.object({
  metadata: z.object({ name: z.string(), version: z.string() }),
  cases: z.array(ClassifierCaseSchema),
});

type ClassifierCase = z.infer<typeof ClassifierCaseSchema>;
type ClassifierCorpus = z.infer<typeof ClassifierCorpusSchema>;

// A 1x1 image is rejected by the GoCode image pipeline ("Could not process
// image"), so we synthesize a real, decodable solid-color PNG with pure zlib
// (no extra deps). Content is neutral on purpose — intent is read from the
// prompt, not the pixels.
const CRC_TABLE: number[] = (() => {
  const table: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([len, typeAndData, crc]);
}

function solidPng(size = 64, rgb: [number, number, number] = [136, 136, 136]): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: RGB
  const pixel = Buffer.from(rgb);
  const row = Buffer.concat([Buffer.from([0]), ...Array(size).fill(pixel)]); // filter byte + pixels
  const raw = Buffer.concat(Array(size).fill(row));
  const idat = deflateSync(raw);
  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

const NEUTRAL_PNG_BASE64 = solidPng().toString('base64');

async function loadCorpusFile(filePath: string): Promise<ClassifierCorpus> {
  const content = await readFile(filePath, 'utf-8');
  const ext = extname(filePath).toLowerCase();
  const raw = ext === '.json' ? JSON.parse(content) : parseYaml(content);
  return ClassifierCorpusSchema.parse(raw);
}

async function loadCorpora(corpusPath: string): Promise<ClassifierCorpus[]> {
  const info = await stat(corpusPath);
  if (info.isFile()) {
    return [await loadCorpusFile(corpusPath)];
  }
  const entries = await readdir(corpusPath, { withFileTypes: true });
  const yamlFiles = entries
    .filter((e) => e.isFile() && (e.name.endsWith('.yaml') || e.name.endsWith('.yml')))
    .map((e) => join(corpusPath, e.name));
  if (yamlFiles.length === 0) {
    throw new Error(`No corpus files found in ${corpusPath}`);
  }
  return Promise.all(yamlFiles.map(loadCorpusFile));
}

interface CaseResult {
  id: string;
  passed: boolean;
  expected: string;
  actual: string;
  failures: string[];
  tags: string[];
}

async function evaluateCase(c: ClassifierCase): Promise<CaseResult> {
  const buffer = Buffer.from(c.imageBase64 ?? NEUTRAL_PNG_BASE64, 'base64');
  const classification = await classifyUploadImage(buffer, 'upload.png', c.prompt);

  const actualIntent = classification?.placementIntent ?? 'none';
  const failures: string[] = [];

  if (actualIntent !== c.expectedPlacementIntent) {
    failures.push(`placementIntent: expected '${c.expectedPlacementIntent}', got '${actualIntent}'`);
  }
  if (c.expectedAssetRole !== undefined) {
    const actualRole = classification?.assetRole ?? null;
    if (actualRole !== c.expectedAssetRole) {
      failures.push(`assetRole: expected '${c.expectedAssetRole}', got '${actualRole}'`);
    }
  }

  return {
    id: c.id,
    passed: failures.length === 0,
    expected: c.expectedPlacementIntent,
    actual: actualIntent,
    failures,
    tags: c.tags,
  };
}

async function run(corpusPath: string, options: { verbose?: boolean }): Promise<boolean> {
  const corpora = await loadCorpora(corpusPath);
  let total = 0;
  let passed = 0;

  for (const corpus of corpora) {
    const active = corpus.cases.filter((c) => !c.skip);
    console.log(`\nRunning "${corpus.metadata.name}" (${active.length} cases)...`);

    for (const c of active) {
      total += 1;
      let result: CaseResult;
      try {
        result = await evaluateCase(c);
      } catch (err) {
        result = {
          id: c.id,
          passed: false,
          expected: c.expectedPlacementIntent,
          actual: 'error',
          failures: [`Error: ${err instanceof Error ? err.message : String(err)}`],
          tags: c.tags,
        };
      }
      if (result.passed) passed += 1;
      if (options.verbose || !result.passed) {
        const status = result.passed ? 'PASS' : 'FAIL';
        console.log(`  [${status}] ${result.id}`);
        for (const f of result.failures) console.log(`    - ${f}`);
      }
    }
  }

  const accuracy = total > 0 ? Math.round((passed / total) * 100) : 0;
  console.log(`\nTotal: ${total}  Passed: ${passed}  Failed: ${total - passed}  Accuracy: ${accuracy}%`);
  return passed === total;
}

const program = new Command();

program
  .name('classifier')
  .description('Evaluate chat-upload placementIntent classification accuracy')
  .version('1.0.0');

program
  .command('run')
  .description('Run classifier accuracy evaluation')
  .argument('<corpus>', 'Path to a YAML corpus file or directory of YAML files')
  .option('-v, --verbose', 'Show per-case results')
  .action(async (corpusPath: string, options: { verbose?: boolean }) => {
    console.log('\nClassifier Accuracy Evaluation');
    console.log(`Corpus: ${corpusPath}`);
    const ok = await run(corpusPath, options);
    if (!ok) {
      console.log('\n❌ Some cases failed');
      process.exit(1);
    }
    console.log('\n✅ All cases passed');
  });

program.parseAsync().catch((err) => {
  console.error('Error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
