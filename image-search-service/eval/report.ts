import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface SearchResult {
  id: string;
  title?: string;
  url?: string;
}

interface JudgeScore {
  imageRelevance: number;
  reasoning: string;
}

interface ComparisonJudgment {
  pathA: JudgeScore;
  pathB: JudgeScore;
  preference: 'A' | 'B' | 'tie';
  summary: string;
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

function bar(value: number, max: number = 10, width: number = 20): string {
  const filled = Math.round((value / max) * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

function scoreColor(value: number): string {
  if (value >= 7) return '\x1b[32m'; // green
  if (value >= 4) return '\x1b[33m'; // yellow
  return '\x1b[31m'; // red
}

const reset = '\x1b[0m';
const bold = '\x1b[1m';
const dim = '\x1b[2m';
const cyan = '\x1b[36m';
const white = '\x1b[37m';
const green = '\x1b[32m';
const red = '\x1b[31m';
const yellow = '\x1b[33m';

function formatScore(label: string, score: number): string {
  const color = scoreColor(score);
  return `${label}: ${color}${bar(score)} ${score.toFixed(1)}${reset}`;
}

function resolveReportPath(): string {
  const arg = process.argv[2];
  const resultsDir = join(__dirname, 'results');

  if (arg) {
    if (arg.includes('/') || arg.includes('\\')) return arg;
    return join(resultsDir, arg);
  }

  const files = readdirSync(resultsDir)
    .filter(f => f.endsWith('.json'))
    .sort()
    .reverse();

  if (files.length === 0) {
    console.error('No result files found in results/');
    process.exit(1);
  }

  return join(resultsDir, files[0]);
}

function prefLabel(pref: string): string {
  if (pref === 'A') return `${red}← Path A wins${reset}`;
  if (pref === 'B') return `${green}→ Path B wins${reset}`;
  return `${yellow}= Tie${reset}`;
}

function main() {
  const reportPath = resolveReportPath();
  const report: EvalReport = JSON.parse(readFileSync(reportPath, 'utf-8'));

  const date = new Date(report.timestamp);
  const dateStr = date.toLocaleString();

  console.log('');
  console.log(`${bold}╔══════════════════════════════════════════════════════════════╗${reset}`);
  console.log(`${bold}║              Image Search Eval Report                        ║${reset}`);
  console.log(`${bold}╚══════════════════════════════════════════════════════════════╝${reset}`);
  console.log('');
  console.log(`  ${dim}Date:${reset}      ${dateStr}`);
  console.log(`  ${dim}Scenarios:${reset} ${report.scenarioCount}    ${dim}Needs:${reset} ${report.totalNeeds}`);
  console.log('');

  // Aggregate summary
  console.log(`${bold}  AGGREGATE IMAGE RELEVANCE${reset}`);
  console.log(`${dim}  ${'─'.repeat(58)}${reset}`);
  console.log(`  ${cyan}Path A (Direct Getty)${reset}`);
  console.log(`    ${formatScore('Image Relevance ', report.aggregate.pathA.avgImageRelevance)}`);
  console.log('');
  console.log(`  ${cyan}Path B (Search Service)${reset}`);
  console.log(`    ${formatScore('Image Relevance ', report.aggregate.pathB.avgImageRelevance)}`);
  console.log('');

  const diffRelevance = report.aggregate.pathB.avgImageRelevance - report.aggregate.pathA.avgImageRelevance;
  console.log(`  ${bold}Delta (B - A):${reset}  ${formatDelta(diffRelevance)}`);

  // Win/loss tally
  const judgments = report.results.flatMap(r => r.needs.filter(n => n.judgment).map(n => n.judgment!));
  const wins = { A: 0, B: 0, tie: 0 };
  for (const j of judgments) wins[j.preference]++;
  if (judgments.length > 0) {
    console.log(`  ${bold}Wins:${reset}           A: ${wins.A}  B: ${wins.B}  Tie: ${wins.tie}`);
  }
  console.log('');

  // Per-scenario details
  console.log(`${bold}  SCENARIO DETAILS${reset}`);

  for (const scenario of report.results) {
    console.log(`${dim}  ${'─'.repeat(58)}${reset}`);
    console.log(`  ${bold}${scenario.name}${reset} ${dim}— "${scenario.prompt}"${reset}`);
    console.log('');

    for (const need of scenario.needs) {
      const filterStr = Object.entries(need.filters)
        .map(([k, v]) => `${k}=${v.join(',')}`)
        .join('  ');

      console.log(`    ${white}${need.slot}${reset}`);
      console.log(`    ${dim}Query:${reset}   "${need.query}"`);
      console.log(`    ${dim}Filters:${reset} ${filterStr}`);
      console.log('');

      // Path A
      if (need.pathA.error) {
        console.log(`    ${cyan}Path A:${reset} ${red}ERROR — ${need.pathA.error}${reset}`);
      } else {
        const a = need.pathA;
        console.log(`    ${cyan}Path A (Getty):${reset}   ${a.results.length} results`);
        if (a.score) {
          console.log(`      ${formatScore('Image Relevance ', a.score.imageRelevance)}`);
          if (a.score.reasoning) {
            console.log(`      ${dim}${wordWrap(a.score.reasoning, 54).map((l, i) => i === 0 ? `→ ${l}` : `  ${l}`).join('\n      ')}${reset}`);
          }
        }
      }
      console.log('');

      // Path B
      if (need.pathB.error) {
        console.log(`    ${cyan}Path B:${reset} ${red}ERROR — ${need.pathB.error}${reset}`);
      } else {
        const b = need.pathB;
        console.log(`    ${cyan}Path B (Service):${reset} ${b.results.length} results`);
        if (b.score) {
          console.log(`      ${formatScore('Image Relevance ', b.score.imageRelevance)}`);
          if (b.score.reasoning) {
            console.log(`      ${dim}${wordWrap(b.score.reasoning, 54).map((l, i) => i === 0 ? `→ ${l}` : `  ${l}`).join('\n      ')}${reset}`);
          }
        }
      }

      // Judgment summary
      if (need.judgment) {
        console.log('');
        console.log(`    ${bold}Verdict:${reset} ${prefLabel(need.judgment.preference)}`);
        if (need.judgment.summary) {
          console.log(`    ${dim}${wordWrap(need.judgment.summary, 56).join('\n    ')}${reset}`);
        }
      }

      // Top results comparison
      const topA = need.pathA.results.slice(0, 3);
      const topB = need.pathB.results.slice(0, 3);

      if (topA.length > 0 || topB.length > 0) {
        console.log('');
        console.log(`    ${dim}Top results:${reset}`);
        const maxRows = Math.max(topA.length, topB.length);
        for (let i = 0; i < maxRows; i++) {
          const aTitle = topA[i]?.title || topA[i]?.id || '';
          const bTitle = topB[i]?.title || topB[i]?.id || '';
          const aStr = truncate(aTitle, 26);
          const bStr = truncate(bTitle, 26);
          console.log(`      ${dim}${String(i + 1)}.${reset} A: ${aStr.padEnd(28)} B: ${bStr}`);
        }
      }

      console.log('');
    }
  }

  console.log(`${dim}  Report: ${reportPath}${reset}`);
  console.log('');
}

function formatDelta(delta: number): string {
  const sign = delta > 0 ? '+' : '';
  const color = delta > 0 ? '\x1b[32m' : delta < 0 ? '\x1b[31m' : '\x1b[33m';
  return `${color}${sign}${delta.toFixed(2)}${reset}`;
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 1) + '…';
}

function wordWrap(text: string, width: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let line = '';

  for (const word of words) {
    if (line.length + word.length + 1 > width && line.length > 0) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

main();
