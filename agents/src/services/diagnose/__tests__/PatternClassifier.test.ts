import { describe, it, expect } from 'vitest';
import { PatternClassifier } from '../classifiers/PatternClassifier.js';
import { ALL_PATTERNS } from '../classifiers/patterns/index.js';
import type { SanitizedLogEntry } from '../../log-sanitizer.js';
import type { AppContext } from '../types.js';

function logLine(message: string, source: 'stdout' | 'stderr' = 'stderr'): SanitizedLogEntry {
  return {
    timestamp: '2026-04-20T10:30:45Z',
    source,
    message,
    level: 'error',
  };
}

const CTX: AppContext = { appId: 'app-123', target: 'publish' };

function run(c: PatternClassifier, logs: SanitizedLogEntry[]) {
  return c.classify(logs, CTX);
}

describe('PatternClassifier', () => {
  const classifier = new PatternClassifier(ALL_PATTERNS);

  describe('source identity', () => {
    it('reports source as "pattern"', () => {
      expect(classifier.source).toBe('pattern');
    });
  });

  describe('no match cases', () => {
    it('returns handled=false on empty logs', async () => {
      const result = await run(classifier, []);
      expect(result.handled).toBe(false);
      expect(result.issues).toEqual([]);
    });

    it('returns handled=false when no pattern matches', async () => {
      const result = await run(classifier, [
        logLine('Some arbitrary info'),
        logLine('A second unrelated line'),
      ]);
      expect(result.handled).toBe(false);
      expect(result.issues).toEqual([]);
    });
  });

  describe.each([
    {
      name: 'missing module (double quotes)',
      log: `Error: Cannot find module "lodash"`,
      expectedId: 'missing-module',
      expectedCategory: 'Missing Dependency',
      expectedRecommendation: 'Install missing package: npm install lodash',
    },
    {
      name: 'missing module (single quotes)',
      log: `Error: Cannot find module 'react'`,
      expectedId: 'missing-module',
      expectedCategory: 'Missing Dependency',
      expectedRecommendation: 'Install missing package: npm install react',
    },
    {
      name: 'TypeScript error',
      log: `src/index.ts(5,3): error TS2304: Cannot find name 'foo'.`,
      expectedId: 'ts-error',
      expectedCategory: 'TypeScript Error',
    },
    {
      name: 'heap out of memory',
      log: `FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory`,
      expectedId: 'heap-oom',
      expectedCategory: 'Memory Exhaustion',
    },
    {
      name: 'port binding',
      log: `Error: listen EADDRINUSE: address already in use :::3000`,
      expectedId: 'port-binding',
      expectedCategory: 'Port Binding',
    },
    {
      name: 'health check timeout',
      log: `dev-supervisor: health check on /healthz timeout after 30s`,
      expectedId: 'health-check-timeout',
      expectedCategory: 'Health Check Timeout',
    },
    {
      name: 'missing build script',
      log: `npm ERR! missing script: build`,
      expectedId: 'build-script-missing',
      expectedCategory: 'Build Script Missing',
    },
    {
      name: 'missing dist folder',
      log: `Error: dist/ folder not found after build`,
      expectedId: 'dist-missing',
      expectedCategory: 'Dist Folder Missing',
    },
    {
      name: 'undefined env var',
      log: `TypeError: process.env.API_KEY is undefined`,
      expectedId: 'env-var-missing',
      expectedCategory: 'Env Var Missing',
    },
  ])('matches $name', ({ log, expectedId, expectedCategory, expectedRecommendation }) => {
    it(`produces an issue with id=${expectedId}`, async () => {
      const result = await run(classifier, [logLine(log)]);
      expect(result.handled).toBe(true);
      expect(result.issues.length).toBeGreaterThanOrEqual(1);
      const issue = result.issues[0];
      expect(issue!.id === expectedId || issue!.id.startsWith(`${expectedId}:`)).toBe(true);
      expect(issue!.category).toBe(expectedCategory);
      expect(issue!.source).toBe('pattern');
      expect(issue!.severity).toBe('error');
      expect(issue!.confidence).toBeGreaterThan(0);
      if (expectedRecommendation) {
        expect(issue!.recommendation).toBe(expectedRecommendation);
      }
      expect(issue!.relatedLogs).toBeDefined();
      expect(issue!.relatedLogs![0]).toContain(log);
    });
  });

  describe('multiple matches', () => {
    it('deduplicates matches with the same id (first wins)', async () => {
      const result = await run(classifier, [
        logLine(`Error: Cannot find module 'lodash'`),
        logLine(`Error: Cannot find module 'lodash'`),
      ]);
      expect(result.handled).toBe(true);
      const lodashIssues = result.issues.filter((i) => i.id === 'missing-module:lodash');
      expect(lodashIssues).toHaveLength(1);
    });

    it('produces distinct issues when different modules are missing', async () => {
      const result = await run(classifier, [
        logLine(`Error: Cannot find module 'lodash'`),
        logLine(`Error: Cannot find module 'react'`),
      ]);
      const ids = result.issues.map((i) => i.id);
      expect(ids).toContain('missing-module:lodash');
      expect(ids).toContain('missing-module:react');
    });

    it('produces distinct issues across different categories', async () => {
      const result = await run(classifier, [
        logLine(`Error: Cannot find module 'lodash'`),
        logLine(`Error: listen EADDRINUSE: address already in use :::3000`),
      ]);
      const categories = result.issues.map((i) => i.category);
      expect(categories).toContain('Missing Dependency');
      expect(categories).toContain('Port Binding');
    });
  });

  describe('dependency injection', () => {
    it('uses only the patterns provided to the constructor', async () => {
      const minimalClassifier = new PatternClassifier([
        {
          id: 'custom',
          category: 'Custom',
          severity: 'warning',
          confidence: 50,
          pattern: /custom-error-marker/,
          getRecommendation: () => 'do a thing',
        },
      ]);
      const noMatch = await run(minimalClassifier, [
        logLine(`Error: Cannot find module 'lodash'`),
      ]);
      expect(noMatch.handled).toBe(false);

      const match = await run(minimalClassifier, [logLine('something custom-error-marker here')]);
      expect(match.handled).toBe(true);
      expect(match.issues[0]!.id).toBe('custom');
      expect(match.issues[0]!.severity).toBe('warning');
    });
  });
});
