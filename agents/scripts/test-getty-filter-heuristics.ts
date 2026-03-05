#!/usr/bin/env tsx
/**
 * Getty Filter Heuristics Test Harness
 *
 * Tests which Getty search filters cause zero results and determines
 * optimal filter-drop order for automatic retries.
 *
 * Usage:
 *   pnpm --filter @airo/agents tsx scripts/test-getty-filter-heuristics.ts
 *
 * Environment:
 *   SSO_JWT or GETTY_TOKEN   Authentication token
 *   GETTY_API_URL             Proxy URL (optional)
 */

import { config } from 'dotenv';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
config({ path: path.resolve(__dirname, '../.env') });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TestCase {
  slot: string;
  query: string;
  orientations?: string[];
  moods?: string[];
  graphicalStyles?: string[];
  advancedFilters?: {
    subjectCategory?: string[];
    numberOfPeople?: string[];
    minimumSize?: string;
  };
  size?: { width: number; height: number; fit: string };
  count: number;
}

interface FilterSet {
  orientations?: string[];
  moods?: string[];
  graphicalStyles?: string[];
  numberOfPeople?: string[];
  minimumSize?: string;
}

interface SearchResult {
  resultCount: number;
  success: boolean;
  error?: string;
}

interface TrialResult {
  label: string;
  droppedFilters: string[];
  resultCount: number;
  success: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// Getty API client (minimal, direct)
// ---------------------------------------------------------------------------

function getAuthHeaders(): Record<string, string> {
  const token = process.env.GETTY_TOKEN;
  const ssoJwt = process.env.SSO_JWT;

  let authorization = '';
  if (token) {
    authorization = 'Bearer ' + token;
  } else if (ssoJwt) {
    authorization = 'sso-jwt ' + ssoJwt;
  }

  if (!authorization) {
    throw new Error('Set GETTY_TOKEN or SSO_JWT environment variable');
  }

  return {
    Authorization: authorization,
    'x-app-key': process.env.GETTY_APP_KEY || 'airo-app-builder',
    Accept: 'application/json',
  };
}

function getBaseUrl(): string {
  const url = process.env.GETTY_API_URL || 'https://getty-images-proxy.api.test-godaddy.com';
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}`;
  } catch {
    return url;
  }
}

async function searchGetty(
  query: string,
  filters: FilterSet,
  count: number,
): Promise<SearchResult> {
  const params = new URLSearchParams({
    phrase: query,
    page: '1',
    page_size: count.toString(),
    sort_order: 'best_match',
  });

  if (filters.orientations) {
    for (const v of filters.orientations) params.append('orientations', v);
  }
  if (filters.moods) {
    for (const v of filters.moods) params.append('moods', v);
  }
  if (filters.graphicalStyles) {
    for (const v of filters.graphicalStyles) params.append('graphical_styles', v);
  }
  if (filters.numberOfPeople) {
    for (const v of filters.numberOfPeople) params.append('number_of_people', v);
  }
  if (filters.minimumSize) {
    params.append('minimum_size', filters.minimumSize);
  }

  const url = `${getBaseUrl()}/v1/search?${params.toString()}`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: getAuthHeaders(),
    });

    if (!response.ok) {
      const text = await response.text();
      return { resultCount: 0, success: false, error: `${response.status}: ${text.slice(0, 200)}` };
    }

    const data = (await response.json()) as { result_count: number; images?: unknown[] };
    return {
      resultCount: data.result_count || 0,
      success: true,
    };
  } catch (err) {
    return { resultCount: 0, success: false, error: String(err) };
  }
}

// ---------------------------------------------------------------------------
// Filter manipulation helpers
// ---------------------------------------------------------------------------

/** All filter keys we test dropping */
const FILTER_KEYS = ['orientations', 'moods', 'graphicalStyles', 'numberOfPeople', 'minimumSize'] as const;
type FilterKey = (typeof FILTER_KEYS)[number];

function extractFilters(tc: TestCase): FilterSet {
  return {
    orientations: tc.orientations,
    moods: tc.moods,
    graphicalStyles: tc.graphicalStyles,
    numberOfPeople: tc.advancedFilters?.numberOfPeople,
    minimumSize: tc.advancedFilters?.minimumSize,
  };
}

function dropFilters(base: FilterSet, toDrop: FilterKey[]): FilterSet {
  const copy = { ...base };
  for (const key of toDrop) {
    delete copy[key];
  }
  return copy;
}

/** Generate all combinations of size k from the given array */
function combinations<T>(arr: T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (arr.length < k) return [];
  const results: T[][] = [];
  for (let i = 0; i <= arr.length - k; i++) {
    const rest = combinations(arr.slice(i + 1), k - 1);
    for (const combo of rest) {
      results.push([arr[i]!, ...combo]);
    }
  }
  return results;
}

/** Get the active filter keys for a test case */
function activeFilterKeys(filters: FilterSet): FilterKey[] {
  return FILTER_KEYS.filter((key) => {
    const val = filters[key];
    if (Array.isArray(val)) return val.length > 0;
    return !!val;
  });
}

// ---------------------------------------------------------------------------
// Test cases
// ---------------------------------------------------------------------------

const TEST_CASES: TestCase[] = [
  {
    slot: 'pages/home/new-arrival-4',
    query: 'women fashion skirt pants luxury boutique editorial',
    orientations: ['vertical'],
    moods: ['bold', 'dramatic'],
    graphicalStyles: ['photography'],
    advancedFilters: { subjectCategory: ['person'], numberOfPeople: ['one'], minimumSize: 'large' },
    size: { width: 600, height: 800, fit: 'cover' },
    count: 4,
  },
  {
    slot: 'pages/home/new-arrival-3',
    query: 'women luxury blouse top fashion editorial studio',
    orientations: ['vertical'],
    moods: ['warm', 'natural'],
    graphicalStyles: ['photography'],
    advancedFilters: { subjectCategory: ['person'], numberOfPeople: ['one'], minimumSize: 'large' },
    size: { width: 600, height: 800, fit: 'cover' },
    count: 4,
  },
  {
    slot: 'pages/home/new-arrival-2',
    query: 'women fashion coat jacket luxury editorial model',
    orientations: ['vertical'],
    moods: ['dramatic', 'cool'],
    graphicalStyles: ['photography'],
    advancedFilters: { subjectCategory: ['person'], numberOfPeople: ['one'], minimumSize: 'large' },
    size: { width: 600, height: 800, fit: 'cover' },
    count: 4,
  },
  {
    slot: 'pages/home/new-arrival-1',
    query: 'women luxury dress fashion editorial clean background',
    orientations: ['vertical'],
    moods: ['cool', 'natural'],
    graphicalStyles: ['photography'],
    advancedFilters: { subjectCategory: ['person'], numberOfPeople: ['one'], minimumSize: 'large' },
    size: { width: 600, height: 800, fit: 'cover' },
    count: 4,
  },
];

// ---------------------------------------------------------------------------
// Main test runner
// ---------------------------------------------------------------------------

async function runTestCase(tc: TestCase): Promise<{ slot: string; trials: TrialResult[] }> {
  const baseFilters = extractFilters(tc);
  const active = activeFilterKeys(baseFilters);
  const trials: TrialResult[] = [];

  // 1. Full filters
  const full = await searchGetty(tc.query, baseFilters, tc.count);
  trials.push({
    label: 'ALL filters',
    droppedFilters: [],
    resultCount: full.resultCount,
    success: full.success,
    error: full.error,
  });

  // 2. Drop each filter individually
  for (const key of active) {
    const filters = dropFilters(baseFilters, [key]);
    const result = await searchGetty(tc.query, filters, tc.count);
    trials.push({
      label: `drop ${key}`,
      droppedFilters: [key],
      resultCount: result.resultCount,
      success: result.success,
      error: result.error,
    });
  }

  // 3. Drop pairs of filters
  if (active.length >= 2) {
    const pairs = combinations(active, 2);
    for (const pair of pairs) {
      const filters = dropFilters(baseFilters, pair);
      const result = await searchGetty(tc.query, filters, tc.count);
      trials.push({
        label: `drop ${pair.join('+')}`,
        droppedFilters: pair,
        resultCount: result.resultCount,
        success: result.success,
        error: result.error,
      });
    }
  }

  // 4. Drop triples of filters
  if (active.length >= 3) {
    const triples = combinations(active, 3);
    for (const triple of triples) {
      const filters = dropFilters(baseFilters, triple);
      const result = await searchGetty(tc.query, filters, tc.count);
      trials.push({
        label: `drop ${triple.join('+')}`,
        droppedFilters: triple,
        resultCount: result.resultCount,
        success: result.success,
        error: result.error,
      });
    }
  }

  // 5. Query only (no filters at all)
  const queryOnly = await searchGetty(tc.query, {}, tc.count);
  trials.push({
    label: 'NO filters (query only)',
    droppedFilters: [...active],
    resultCount: queryOnly.resultCount,
    success: queryOnly.success,
    error: queryOnly.error,
  });

  return { slot: tc.slot, trials };
}

function printResults(results: { slot: string; trials: TrialResult[] }[]) {
  console.log('\n' + '='.repeat(100));
  console.log('GETTY FILTER HEURISTICS RESULTS');
  console.log('='.repeat(100));

  for (const { slot, trials } of results) {
    console.log(`\n${'─'.repeat(80)}`);
    console.log(`SLOT: ${slot}`);
    console.log(`${'─'.repeat(80)}`);
    console.log(`${'Trial'.padEnd(50)} ${'Results'.padStart(10)} ${'Delta'.padStart(10)}`);
    console.log(`${'─'.repeat(50)} ${'─'.repeat(10)} ${'─'.repeat(10)}`);

    const baseCount = trials[0]?.resultCount ?? 0;

    for (const trial of trials) {
      const delta = trial.resultCount - baseCount;
      const deltaStr = delta > 0 ? `+${delta}` : delta === 0 ? '=' : String(delta);
      const countStr = trial.error ? `ERR` : String(trial.resultCount);
      console.log(`${trial.label.padEnd(50)} ${countStr.padStart(10)} ${deltaStr.padStart(10)}`);
    }
  }

  // Summary: aggregate which single filter drops yield the most improvement
  console.log(`\n${'='.repeat(100)}`);
  console.log('SINGLE-FILTER DROP IMPACT SUMMARY');
  console.log('='.repeat(100));
  console.log('(Shows average result count increase when dropping each filter)\n');

  const filterImpact: Record<string, { totalDelta: number; count: number; rescues: number }> = {};

  for (const { trials } of results) {
    const baseCount = trials[0]?.resultCount ?? 0;
    for (const trial of trials) {
      if (trial.droppedFilters.length === 1) {
        const key = trial.droppedFilters[0]!;
        if (!filterImpact[key]) {
          filterImpact[key] = { totalDelta: 0, count: 0, rescues: 0 };
        }
        filterImpact[key]!.totalDelta += trial.resultCount - baseCount;
        filterImpact[key]!.count += 1;
        if (baseCount === 0 && trial.resultCount > 0) {
          filterImpact[key]!.rescues += 1;
        }
      }
    }
  }

  const sorted = Object.entries(filterImpact).sort(
    ([, a], [, b]) => b.totalDelta / b.count - a.totalDelta / a.count,
  );

  console.log(`${'Filter'.padEnd(25)} ${'Avg Delta'.padStart(12)} ${'Rescues'.padStart(10)} ${'Recommendation'.padStart(20)}`);
  console.log(`${'─'.repeat(25)} ${'─'.repeat(12)} ${'─'.repeat(10)} ${'─'.repeat(20)}`);

  for (const [key, data] of sorted) {
    const avgDelta = (data.totalDelta / data.count).toFixed(0);
    const rec =
      data.rescues > 0
        ? 'DROP FIRST'
        : data.totalDelta / data.count > 100
          ? 'DROP EARLY'
          : data.totalDelta / data.count > 0
            ? 'DROP IF NEEDED'
            : 'KEEP';
    console.log(
      `${key.padEnd(25)} ${('+' + avgDelta).padStart(12)} ${String(data.rescues).padStart(10)} ${rec.padStart(20)}`,
    );
  }

  // Suggested drop order
  console.log(`\n${'='.repeat(100)}`);
  console.log('SUGGESTED RETRY DROP ORDER (most impactful first):');
  console.log('='.repeat(100));
  const dropOrder = sorted.map(([key]) => key);
  dropOrder.forEach((key, i) => {
    console.log(`  ${i + 1}. ${key}`);
  });
}

async function main() {
  console.log('Getty Filter Heuristics Test Harness');
  console.log(`Testing ${TEST_CASES.length} search queries with systematic filter removal\n`);
  console.log(`Base URL: ${getBaseUrl()}`);
  console.log(`Auth: ${process.env.GETTY_TOKEN ? 'GETTY_TOKEN' : process.env.SSO_JWT ? 'SSO_JWT' : 'NONE'}`);

  const results: { slot: string; trials: TrialResult[] }[] = [];

  for (const tc of TEST_CASES) {
    console.log(`\nTesting: ${tc.slot} - "${tc.query.slice(0, 50)}..."`);
    const result = await runTestCase(tc);
    results.push(result);
    // Brief delay to avoid rate limiting
    await new Promise((r) => setTimeout(r, 500));
  }

  printResults(results);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
