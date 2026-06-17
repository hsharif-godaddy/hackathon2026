/**
 * Rebuild design-direction eval (headless NL, first-touch Initial Agent).
 *
 * - Static: pins rebuild-intent.md + websiteRebuild tool contract (CI, no keys).
 * - Live: drives Initial Agent over the phrase matrix; asserts tool args (needs provider keys).
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

import {
  LIVE_EVAL_MIN_DETECTION_RATE,
  REBUILD_DESIGN_DIRECTION_MATRIX,
} from './rebuild-design-direction-matrix.js';
import {
  hasLiveRebuildDesignDirectionCredentials,
  runInitialAgentRebuildTurn,
} from './rebuild-design-direction-live-harness.js';

const here = dirname(fileURLToPath(import.meta.url));
const agentsSrc = resolve(here, '..');

function readPrompt(relPath: string): string {
  return readFileSync(resolve(agentsSrc, relPath), 'utf-8');
}

const rebuildIntent = readPrompt('prompts/initial/3.0/rebuild-intent.md');
const websiteRebuildSource = readPrompt('tools/ai-lib-tools/website-rebuild.ts');

describe('rebuild design-direction eval', function rebuildDesignDirectionEval() {
  describe('static prompt + tool contract', function staticContract() {
    it('documents all four designDirection values and LLM inference rules', function directionTable() {
      expect(rebuildIntent).toContain('### Design direction');
      for (const value of ['keep-similar', 'modernize', 'simplify', 'bold']) {
        expect(rebuildIntent).toContain(value);
      }
      expect(rebuildIntent).toContain('Infer from meaning, not just English keywords');
      expect(rebuildIntent).toContain('paraphrases and non-English prompts count');
      expect(rebuildIntent).toContain('defaults to modernize');
    });

    it('exposes designDirection on the websiteRebuild tool schema', function toolSchema() {
      expect(websiteRebuildSource).toContain('designDirection: z');
      expect(websiteRebuildSource).toContain("'keep-similar', 'modernize', 'simplify', 'bold'");
    });

    it.each(REBUILD_DESIGN_DIRECTION_MATRIX.map((row) => [row.id, row.promptAnchors] as const))(
      'rebuild-intent anchors case %s',
      function promptAnchors(_id, anchors) {
        for (const anchor of anchors) {
          expect(rebuildIntent).toContain(anchor);
        }
      },
    );
  });

  describe.runIf(hasLiveRebuildDesignDirectionCredentials())(
    'live Initial Agent inference',
    function liveInference() {
      const results: { id: string; pass: boolean }[] = [];

      it.each(
        REBUILD_DESIGN_DIRECTION_MATRIX.map((row) => [row.id, row] as const),
      )(
        '%s emits websiteRebuild with expected designDirection',
        async function liveCase(_id, row) {
          const call = await runInitialAgentRebuildTurn(row.userMessage);
          expect(call, `expected websiteRebuild tool call for: ${row.userMessage}`).toBeDefined();
          expect(call!.url).toMatch(/example\.com/);

          if (row.expectedDirection === undefined) {
            expect(call!.designDirection).toBeUndefined();
            results.push({ id: row.id, pass: !call!.designDirection });
          } else {
            const pass = call!.designDirection === row.expectedDirection;
            results.push({ id: row.id, pass });
            expect(call!.designDirection).toBe(row.expectedDirection);
          }
        },
        120_000,
      );

      afterAll(function detectionRate() {
        const total = results.length;
        if (total === 0) return;
        const passed = results.filter((r) => r.pass).length;
        const rate = passed / total;
        console.log(`rebuild-design-direction live detection: ${passed}/${total} (${(rate * 100).toFixed(0)}%)`);
        expect(rate).toBeGreaterThanOrEqual(LIVE_EVAL_MIN_DETECTION_RATE);
      });
    },
  );
});
