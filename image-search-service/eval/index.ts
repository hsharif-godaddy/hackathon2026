import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface ImageNeed {
  slot: string;
  query: string;
  context?: string;
  filters: Record<string, string[]>;
}

interface Scenario {
  name: string;
  prompt: string;
  imageNeeds: ImageNeed[];
}

interface SearchResult {
  id: string;
  title?: string;
  url?: string;
}

interface JudgeScore {
  imageRelevance: number;
  reasoning: string;
}

interface NeedResult {
  slot: string;
  query: string;
  filters: Record<string, string[]>;
  pathA: { results: SearchResult[]; score?: JudgeScore; error?: string };
  pathB: { results: SearchResult[]; score?: JudgeScore; error?: string };
  judgment?: ComparisonJudgment;
}

interface ScenarioResult {
  name: string;
  prompt: string;
  needs: NeedResult[];
}

interface ComparisonJudgment {
  pathA: JudgeScore;
  pathB: JudgeScore;
  preference: 'A' | 'B' | 'tie';
  summary: string;
}

interface EvalReport {
  timestamp: string;
  scenarioCount: number;
  totalNeeds: number;
  results: ScenarioResult[];
  aggregate: {
    pathA: { avgImageRelevance: number };
    pathB: { avgImageRelevance: number };
  };
}

const isDryRun = process.argv.includes('--dry-run');
const limitArg = process.argv.find(a => a.startsWith('--limit='));
const scenarioLimit = limitArg ? parseInt(limitArg.split('=')[1], 10) : Infinity;
const scenariosArg = process.argv.find(a => a.startsWith('--scenarios='));
const scenariosPath = scenariosArg ? scenariosArg.split('=')[1] : 'scenarios';
const filterArg = process.argv.find(a => a.startsWith('--filter='));
const scenarioFilter = filterArg ? filterArg.split('=')[1].split(',') : [];

async function searchGettyDirect(query: string, count: number, filters: Record<string, string[]>): Promise<SearchResult[]> {
  const { GettyMediaDriver } = await import('../../agents/src/tools/ai-lib-tools/drivers/getty-media-driver.js');
  const driver = new GettyMediaDriver();

  const result = await driver.search({
    query,
    mediaType: 'image',
    count,
    ...filters,
  });

  if (!result.success || !result.items) return [];

  return result.items.map(item => ({
    id: item.id,
    title: item.title,
    url: item.urls?.preview || item.urls?.thumbnail,
  }));
}

async function searchViaService(query: string, count: number, filters: Record<string, string[]>, context?: string): Promise<SearchResult[]> {
  const { ImageSearchServiceDriver } = await import('../../agents/src/tools/ai-lib-tools/drivers/image-search-service-driver.js');
  const driver = new ImageSearchServiceDriver();

  const result = await driver.search({
    query,
    count,
    ...(context && { context }),
    ...filters,
  });

  if (!result.success || !result.items) return [];

  return result.items.map(item => ({
    id: item.id,
    title: item.title,
    url: item.urls?.preview || item.urls?.thumbnail,
  }));
}

async function fetchImageAsBase64(url: string): Promise<{ base64: string; mediaType: string } | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const contentType = response.headers.get('content-type') || 'image/jpeg';
    const buffer = await response.arrayBuffer();
    return {
      base64: Buffer.from(buffer).toString('base64'),
      mediaType: contentType.split(';')[0],
    };
  } catch {
    return null;
  }
}

function buildImageContent(label: string, results: SearchResult[], images: Map<string, { base64: string; mediaType: string }>): Array<Record<string, unknown>> {
  const content: Array<Record<string, unknown>> = [];
  content.push({ type: 'text', text: `\n--- ${label} (${results.length} results) ---` });

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const img = r.url ? images.get(r.url) : null;
    content.push({ type: 'text', text: `\n${label} Image ${i + 1} (ID: ${r.id}):` });
    if (img) {
      content.push({
        type: 'image_url',
        image_url: { url: `data:${img.mediaType};base64,${img.base64}` },
      });
    } else {
      content.push({ type: 'text', text: '[image could not be loaded]' });
    }
  }

  return content;
}

async function judgeComparison(
  siteType: string,
  slot: string,
  query: string,
  resultsA: SearchResult[],
  resultsB: SearchResult[],
): Promise<ComparisonJudgment> {
  const empty: ComparisonJudgment = {
    pathA: { imageRelevance: 0, reasoning: '' },
    pathB: { imageRelevance: 0, reasoning: '' },
    preference: 'tie',
    summary: '',
  };

  if (isDryRun) {
    empty.summary = 'dry-run';
    return empty;
  }

  if (resultsA.length === 0 && resultsB.length === 0) {
    empty.summary = 'no results from either path';
    return empty;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    empty.summary = 'No API key';
    return empty;
  }

  // Fetch images in parallel (top 5 from each path)
  const topA = resultsA.slice(0, 5);
  const topB = resultsB.slice(0, 5);
  const allUrls = [...topA, ...topB].map(r => r.url).filter(Boolean) as string[];

  const imageEntries = await Promise.all(
    allUrls.map(async (url) => [url, await fetchImageAsBase64(url)] as const)
  );
  const images = new Map(imageEntries.filter(([, img]) => img !== null) as Array<[string, { base64: string; mediaType: string }]>);

  console.log(`    Judge: fetched ${images.size}/${allUrls.length} images`);

  const messageContent: Array<Record<string, unknown>> = [
    {
      type: 'text',
      text: `You are evaluating image search results for a ${siteType} website.

The intended use is: slot "${slot}" — the image(s) will be used in this part of the website.
The search query was: "${query}"

You will see images from two search systems (Path A and Path B). For each path, score the relevance of the returned images on a 0-10 scale:
- 10: Every image is highly relevant and appropriate for this website slot
- 7-9: Most images are relevant with minor misses
- 4-6: Mixed relevance, some good results but also clearly wrong ones
- 1-3: Mostly irrelevant results
- 0: No results or completely wrong

Consider: Does the image match the query intent? Would it look appropriate on a ${siteType} website in the "${slot}" position?

Respond ONLY with JSON (no markdown):
{"pathA": {"imageRelevance": N, "reasoning": "brief"}, "pathB": {"imageRelevance": N, "reasoning": "brief"}, "preference": "A"|"B"|"tie", "summary": "one sentence comparing the two"}`,
    },
  ];

  // Add Path A images
  if (topA.length > 0) {
    messageContent.push(...buildImageContent('Path A', topA, images));
  } else {
    messageContent.push({ type: 'text', text: '\n--- Path A: no results ---' });
  }

  // Add Path B images
  if (topB.length > 0) {
    messageContent.push(...buildImageContent('Path B', topB, images));
  } else {
    messageContent.push({ type: 'text', text: '\n--- Path B: no results ---' });
  }

  try {
    const baseUrl = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
    const model = process.env.EVAL_JUDGE_MODEL || 'claude-opus-4-6';

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: messageContent }],
        max_tokens: 500,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      empty.summary = `Judge API error: ${response.status} ${text.slice(0, 200)}`;
      return empty;
    }

    const data = await response.json() as any;
    const content = data.choices?.[0]?.message?.content || '';

    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        pathA: {
          imageRelevance: Math.min(10, Math.max(0, parsed.pathA?.imageRelevance || 0)),
          reasoning: parsed.pathA?.reasoning || '',
        },
        pathB: {
          imageRelevance: Math.min(10, Math.max(0, parsed.pathB?.imageRelevance || 0)),
          reasoning: parsed.pathB?.reasoning || '',
        },
        preference: ['A', 'B', 'tie'].includes(parsed.preference) ? parsed.preference : 'tie',
        summary: parsed.summary || '',
      };
    }

    empty.summary = 'Could not parse judge response';
    return empty;
  } catch (error) {
    empty.summary = `Judge error: ${error}`;
    return empty;
  }
}

/**
 * Load scenarios from a file or directory.
 * - If path is a .json file, load it directly.
 * - If path is a directory, load all .json files in it (sorted by name).
 * - Deduplicates by scenario name (last file wins).
 */
function loadScenarios(path: string): Scenario[] {
  const resolved = join(__dirname, path);

  let files: string[];
  if (existsSync(resolved) && statSync(resolved).isDirectory()) {
    files = readdirSync(resolved)
      .filter(f => f.endsWith('.json'))
      .sort()
      .map(f => join(resolved, f));
  } else if (resolved.endsWith('.json') && existsSync(resolved)) {
    files = [resolved];
  } else if (existsSync(resolved + '.json')) {
    files = [resolved + '.json'];
  } else {
    console.error(`Scenarios not found: ${path}`);
    console.error(`  Looked for directory: ${resolved}`);
    console.error(`  Looked for file: ${resolved}.json`);
    process.exit(1);
  }

  const seen = new Map<string, Scenario>();
  for (const file of files) {
    const scenarios: Scenario[] = JSON.parse(readFileSync(file, 'utf-8'));
    const basename = file.split('/').pop() || file;
    console.log(`  ${basename}: ${scenarios.length} scenarios`);
    for (const s of scenarios) {
      seen.set(s.name, s);
    }
  }

  return Array.from(seen.values());
}

async function main() {
  const flags = [
    isDryRun && 'DRY RUN',
    isFinite(scenarioLimit) && `LIMIT=${scenarioLimit}`,
    scenarioFilter.length > 0 && `FILTER=${scenarioFilter.join(',')}`,
  ].filter(Boolean).join(', ');
  console.log(`Image Search Eval${flags ? ` (${flags})` : ''}`);
  console.log('='.repeat(50));

  const allScenarios = loadScenarios(scenariosPath);
  let scenarios = allScenarios;

  // Filter by scenario name (supports comma-separated list, substring match)
  if (scenarioFilter.length > 0) {
    scenarios = scenarios.filter(s =>
      scenarioFilter.some(f => s.name.includes(f))
    );
  }

  scenarios = scenarios.slice(0, scenarioLimit);
  console.log(`Loaded ${allScenarios.length} scenarios (using ${scenarios.length})`);
  console.log();

  const results: ScenarioResult[] = [];
  let totalNeeds = 0;

  for (const scenario of scenarios) {
    console.log(`\nScenario: ${scenario.name}`);
    const needResults: NeedResult[] = [];

    for (const need of scenario.imageNeeds) {
      totalNeeds++;
      console.log(`  Need: ${need.slot} — "${need.query}"`);

      const needResult: NeedResult = {
        slot: need.slot,
        query: need.query,
        filters: need.filters,
        pathA: { results: [] },
        pathB: { results: [] },
      };

      // Path A: Direct Getty
      try {
        if (!isDryRun) {
          needResult.pathA.results = await searchGettyDirect(need.query, 5, need.filters);
        }
        console.log(`    Path A (Getty): ${needResult.pathA.results.length} results`);
      } catch (error) {
        needResult.pathA.error = String(error);
        console.log(`    Path A (Getty): ERROR - ${error}`);
      }

      // Path B: Image Search Service
      try {
        if (!isDryRun) {
          needResult.pathB.results = await searchViaService(need.query, 5, need.filters, need.context);
        }
        console.log(`    Path B (Service): ${needResult.pathB.results.length} results`);
      } catch (error) {
        needResult.pathB.error = String(error);
        console.log(`    Path B (Service): ERROR - ${error}`);
      }

      // Judge both paths side-by-side with actual images
      if (!isDryRun) {
        const judgment = await judgeComparison(scenario.name, need.slot, need.query, needResult.pathA.results, needResult.pathB.results);
        needResult.pathA.score = judgment.pathA;
        needResult.pathB.score = judgment.pathB;
        needResult.judgment = judgment;
        console.log(`    Scores — A: ${judgment.pathA.imageRelevance} | B: ${judgment.pathB.imageRelevance} | Winner: ${judgment.preference}`);
        console.log(`    ${judgment.summary}`);
      }

      needResults.push(needResult);
    }

    results.push({
      name: scenario.name,
      prompt: scenario.prompt,
      needs: needResults,
    });
  }

  // Calculate aggregates
  const pathAScores = results.flatMap(r => r.needs.filter(n => n.pathA.score).map(n => n.pathA.score!));
  const pathBScores = results.flatMap(r => r.needs.filter(n => n.pathB.score).map(n => n.pathB.score!));

  const avg = (scores: JudgeScore[]) =>
    scores.length > 0 ? scores.reduce((sum, s) => sum + s.imageRelevance, 0) / scores.length : 0;

  const report: EvalReport = {
    timestamp: new Date().toISOString(),
    scenarioCount: scenarios.length,
    totalNeeds,
    results,
    aggregate: {
      pathA: {
        avgImageRelevance: Math.round(avg(pathAScores) * 100) / 100,
      },
      pathB: {
        avgImageRelevance: Math.round(avg(pathBScores) * 100) / 100,
      },
    },
  };

  // Write report
  const resultsDir = join(__dirname, 'results');
  if (!existsSync(resultsDir)) {
    mkdirSync(resultsDir, { recursive: true });
  }

  const now = new Date();
  const dateStr = now.toISOString().replace(/[:.]/g, '-').replace('Z', '');
  const reportPath = join(resultsDir, `${dateStr}-run.json`);
  writeFileSync(reportPath, JSON.stringify(report, null, 2));

  console.log('\n' + '='.repeat(50));
  console.log('AGGREGATE RESULTS');
  console.log(`Path A (Direct Getty):     Image Relevance: ${report.aggregate.pathA.avgImageRelevance}`);
  console.log(`Path B (Search Service):   Image Relevance: ${report.aggregate.pathB.avgImageRelevance}`);
  console.log(`\nReport saved to: ${reportPath}`);
}

main().catch(console.error);
