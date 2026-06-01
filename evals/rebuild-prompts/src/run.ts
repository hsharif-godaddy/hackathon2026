/**
 * rebuild-prompts eval runner.
 *
 * For each fixture under fixtures/:
 *  1. Load input.json (agent options + generate args)
 *  2. Instantiate PagePromptAgent with the agent options
 *  3. Call .generate(...) to produce a markdown prompt
 *  4. Run the contracts registered for that fixture against the output
 *  5. Diff against the stored baseline.md (informational only — not asserted)
 *
 * Pass --update-baselines to overwrite each fixture's baseline.md with the
 * fresh generation. Use after an intentional prompt change.
 */
import { readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PagePromptAgent } from '@airo/agents/page-prompt-agent';
import type {
  AssetManifest,
  PageContent,
  SiteMetadata,
  StylePreferences,
} from '@airo/agents/rebuild-types';

interface AgentOptions {
  isFirstPage: boolean;
  useAtlasCrawler: boolean;
}

interface GenerateArgs {
  siteMetadata: SiteMetadata;
  pageContent: PageContent;
  stylePreferences: StylePreferences;
  assetManifest: AssetManifest;
  screenshotBase64?: string | null;
}

interface Fixture {
  agentOptions: AgentOptions;
  generateArgs: GenerateArgs;
}

interface Contract {
  description: string;
  check: (prompt: string, fixture: Fixture) => boolean;
}

interface ContractResult {
  description: string;
  passed: boolean;
}

interface FixtureResult {
  name: string;
  prompt: string;
  contracts: ContractResult[];
  baselineDiffSummary: string;
}

const FIXTURES_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');

// Contracts per fixture name. Each contract is one invariant we expect to
// hold given the fixture's input shape. Keep them small and specific —
// "preserve detected forms" is one contract, not "preserve everything Atlas
// extracted." Failures should be surgical, not bulk regressions.
const CONTRACTS: Record<string, Contract[]> = {
  minimal: [
    {
      description: 'No DETECTED INTERACTIVE PATTERNS block (input has none)',
      check: (p) => !/DETECTED INTERACTIVE PATTERNS/i.test(p),
    },
    {
      description: 'No DETECTED FORMS block (input has none)',
      check: (p) => !/DETECTED FORMS/i.test(p),
    },
    {
      description: 'Mentions the brand name from sitePurpose',
      // sitePurpose is "ACME Studio — independent design practice"; we just need the
      // brand name "ACME Studio" to land somewhere — the LLM frequently rephrases the
      // descriptive tail ("an independent design practice serving small businesses…").
      check: (p, f) => {
        const brand = f.generateArgs.siteMetadata.sitePurpose.split(/[—\-:]/)[0]?.trim();
        return !!brand && p.includes(brand);
      },
    },
  ],
  'with-carousel': [
    {
      description: 'Prompt directs a carousel/slideshow, not a static hero',
      check: (p) => /carousel|slideshow|slider/i.test(p),
    },
    {
      description: 'References the detected pattern as load-bearing / required / preserve',
      // The directive says "preserve" / "load-bearing" / "REQUIRED" / "MUST" — the
      // LLM may phrase it as any of these. Capture the family, not the wording.
      check: (p) => /\b(preserve|load[- ]?bearing|required|must|do not (replace|flatten|remove)|don'?t (replace|flatten|remove))\b/i.test(p),
    },
    {
      description: 'Does NOT instruct stock-image search for the detected slide imagery',
      check: (p) => !/search for (additional |new |stock )?(images?|photography|photos?) (for|to fill) (slides?|the carousel)/i.test(p),
    },
  ],
  'with-newsletter-form': [
    {
      description: 'Prompt directs a real <form> element',
      check: (p) => /<form/i.test(p) || /real form|real `<form>`/i.test(p),
    },
    {
      description: 'Preserves source field name verbatim',
      check: (p, f) => {
        const name = f.generateArgs.pageContent.structure.forms?.[0]?.fields?.[0]?.name;
        return !!name && p.includes(name);
      },
    },
    {
      description: 'Preserves source submit-button text verbatim',
      check: (p, f) => {
        const text = f.generateArgs.pageContent.structure.forms?.[0]?.submitButton?.text;
        return !!text && p.includes(text);
      },
    },
  ],
  'inner-page': [
    {
      description: 'No instruction to set the project name (homepage-only)',
      check: (p) => !/set(ting)? (the )?project name/i.test(p),
    },
    {
      description: 'No design-redesign / "Let Airo Decide" section',
      check: (p) => !/DESIGN REDESIGN GUIDANCE|Let Airo Decide/i.test(p),
    },
    {
      description: 'No homepage structure rules (header/footer requirements)',
      check: (p) => !/homepage structure requirements/i.test(p),
    },
  ],
  'with-typography-scale': [
    {
      description: 'Prompt mentions the source heading font (Playfair Display)',
      check: (p) => /Playfair Display/i.test(p),
    },
    {
      description: 'Prompt mentions the source body font (Source Sans Pro)',
      check: (p) => /Source Sans Pro/i.test(p),
    },
    {
      description: 'Prompt includes heading font size from scale (56px)',
      check: (p, f) => {
        const headingScale = f.generateArgs.siteMetadata.typography?.scale
          ?.find((s: { role: string }) => s.role === 'heading');
        return !!headingScale && p.includes(headingScale.fontSize);
      },
    },
    {
      description: 'Prompt includes a preservation/keep directive for typography',
      check: (p) => /preserve|must use|use these exact|use.*exactly|keep.*font|import.*font/i.test(p),
    },
    {
      description: 'Prompt does NOT contain AVOID system fonts directive',
      check: (p) => !/AVOID:.*Inter|AVOID:.*Roboto|AVOID:.*Arial|AVOID:.*system fonts/i.test(p),
    },
  ],
};

async function listFixtureNames(): Promise<string[]> {
  const entries = await readdir(FIXTURES_DIR, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
}

async function loadFixture(name: string): Promise<Fixture> {
  const inputPath = path.join(FIXTURES_DIR, name, 'input.json');
  return JSON.parse(await readFile(inputPath, 'utf-8')) as Fixture;
}

async function readBaseline(name: string): Promise<string | null> {
  try {
    return await readFile(path.join(FIXTURES_DIR, name, 'baseline.md'), 'utf-8');
  } catch {
    return null;
  }
}

async function writeBaseline(name: string, content: string): Promise<void> {
  await writeFile(path.join(FIXTURES_DIR, name, 'baseline.md'), content, 'utf-8');
}

function summarizeDiff(baseline: string | null, prompt: string): string {
  if (baseline === null) return '(no baseline yet — will be written on --update-baselines)';
  if (baseline === prompt) return 'identical to baseline';
  const baselineLines = baseline.split('\n');
  const promptLines = prompt.split('\n');
  return `${Math.abs(promptLines.length - baselineLines.length)} line-count delta, ${prompt.length - baseline.length} byte delta`;
}

async function runFixture(name: string, updateBaseline: boolean): Promise<FixtureResult> {
  const fixture = await loadFixture(name);

  const agent = new PagePromptAgent({
    isFirstPage: fixture.agentOptions.isFirstPage,
    useAtlasCrawler: fixture.agentOptions.useAtlasCrawler,
  });
  await agent.initialize();
  const prompt = await agent.generate(
    fixture.generateArgs.siteMetadata,
    fixture.generateArgs.pageContent,
    fixture.generateArgs.stylePreferences,
    fixture.generateArgs.assetManifest,
    fixture.agentOptions.isFirstPage,
    fixture.generateArgs.screenshotBase64 ?? undefined
  );
  await agent.cleanup();

  const baseline = await readBaseline(name);
  const baselineDiffSummary = summarizeDiff(baseline, prompt);

  if (updateBaseline) {
    await writeBaseline(name, prompt);
  }

  const fixtureContracts = CONTRACTS[name] ?? [];
  const contracts: ContractResult[] = fixtureContracts.map((c) => ({
    description: c.description,
    passed: c.check(prompt, fixture),
  }));

  return { name, prompt, contracts, baselineDiffSummary };
}

async function main(): Promise<void> {
  const updateBaselines = process.argv.includes('--update-baselines');
  const names = await listFixtureNames();
  if (names.length === 0) {
    console.error('No fixtures found under', FIXTURES_DIR);
    process.exit(1);
  }

  console.log(`Running ${names.length} fixtures${updateBaselines ? ' (updating baselines)' : ''}\n`);

  let totalContracts = 0;
  let failedContracts = 0;
  for (const name of names) {
    process.stdout.write(`▸ ${name}: `);
    const started = Date.now();
    let result: FixtureResult;
    try {
      result = await runFixture(name, updateBaselines);
    } catch (err) {
      console.error('ERROR\n', err);
      process.exit(2);
    }
    const elapsedMs = Date.now() - started;

    const passed = result.contracts.filter((c) => c.passed).length;
    const total = result.contracts.length;
    totalContracts += total;
    failedContracts += total - passed;
    console.log(`${passed}/${total} contracts (${elapsedMs}ms, baseline: ${result.baselineDiffSummary})`);
    for (const c of result.contracts) {
      console.log(`    ${c.passed ? '✓' : '✗'} ${c.description}`);
    }
  }

  console.log(`\nSummary: ${totalContracts - failedContracts}/${totalContracts} contracts passed`);
  process.exit(failedContracts === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
