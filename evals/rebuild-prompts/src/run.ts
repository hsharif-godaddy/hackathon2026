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

import { PagePromptAgent, shouldPreserveDesign } from '@airo/agents/page-prompt-agent';
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
    {
      // AIROBUILD-2241: keep-similar is a faithful clone, so the generated
      // prompt must not direct BUILDING a section the sparse source lacks
      // (three nav links, one paragraph, no screenshot). We inspect section
      // HEADINGS only — the agent structures the page it wants built as
      // `## <Section>`, whereas any echo of the preserve guidance's negative
      // examples ("avoid bento mosaics") lands in prose, not a heading. So this
      // catches real over-generation without false-failing on paraphrased
      // guidance (which a verbatim word blocklist would, since "bento",
      // "gallery", "testimonials" etc. all appear in the guidance we feed in).
      description: 'Preserve mode: no invented content-section headings (gallery / our work / testimonials / …)',
      check: (p) => {
        const headings = p
          .split('\n')
          .filter((line) => /^#{1,4}\s/.test(line))
          .map((line) => line.toLowerCase());
        return !headings.some((h) =>
          /\b(our work|gallery|portfolio|testimonial|reviews?|services? grid|stats|metrics|case stud)/.test(h)
        );
      },
    },
    {
      // Defense in depth: vocabulary that lives ONLY in the redesign brief
      // (design-redesign.md / the old user block), never in the preserve
      // guidance — so its presence means the wrong fragment leaked in. Safe to
      // blocklist verbatim. "Differentiation" matches design-redesign.md's
      // `**Differentiation:**` heading (the phrase "Differentiation Element"
      // was removed from the user block in this PR).
      description: 'Preserve mode: redesign-brief vocabulary did not leak (Differentiation / social proof)',
      check: (p) => !/Differentiation|social proof/i.test(p),
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
  'hero-embedded-text': [
    {
      // AIROBUILD-2430: the hero image has its title text ("Bon Appetito")
      // baked into the pixels. The prompt MUST tell the agent not to overlay
      // its own heading, or the page renders duplicate, overlapping text.
      description: 'Warns against overlaying headings on the embedded-text image',
      check: (p) => /do NOT overlay/i.test(p),
    },
    {
      // The freestyle failure mode: given "don't overlay", the agent routed
      // around the rule by pulling clean images into a fabricated carousel and
      // re-typing the text on top. The directive must forbid that.
      description: 'Forbids substituting images / fabricating a carousel for the embedded-text hero',
      check: (p) => /carousel|slideshow/i.test(p) && /do NOT (substitute|fabricate|invent|replace)/i.test(p),
    },
    {
      description: 'Surfaces the baked-in hero text so the agent treats it as the image’s text',
      check: (p) => p.includes('Bon Appetito'),
    },
    {
      // The constraint is appended deterministically after PagePromptAgent's
      // rewrite (which drops the per-asset note), so this holds regardless of
      // LLM drift — that's the point of the fix.
      description: 'Cites the scraped role (hero) for the embedded-text image',
      check: (p) => /\[hero\]/i.test(p),
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

  // Mirror RebuildPromptBuilder.runPagePromptAgent: derive preserveDesign from
  // the same shared predicate production uses, so the eval can't drift from the
  // real wiring.
  const preserveDesign = shouldPreserveDesign(fixture.generateArgs.stylePreferences);
  const agent = new PagePromptAgent({
    isFirstPage: fixture.agentOptions.isFirstPage,
    useAtlasCrawler: fixture.agentOptions.useAtlasCrawler,
    preserveDesign,
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
