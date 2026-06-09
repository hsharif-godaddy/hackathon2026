/**
 * Measure systematic judge bias across the calibration dataset.
 *
 * Run this after judging completes to compute model-specific bias corrections
 * that can be applied post-hoc without contaminating the raw measurements.
 */

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

interface JudgeScore {
  judgeId: string;
  score: number;
}

interface ConsensusData {
  evaluatorId: string;
  simulationId: string;
  judges: Array<{ judgeId: string; score: number; valid: boolean }>;
  scale: { min: number; max: number };
}

interface RawJudgeData {
  judgeId: string;
  valid?: boolean;
  rawScore?: number | null;  // Original model output before bias correction
  score?: number | null;     // Bias-corrected score (legacy or final)
}

async function loadConsensusFiles(datasetDir: string): Promise<ConsensusData[]> {
  const simDirs = await readdir(datasetDir, { withFileTypes: true });
  const results: ConsensusData[] = [];

  for (const simDir of simDirs) {
    if (!simDir.isDirectory()) continue;

    const judgingDir = path.join(datasetDir, simDir.name, 'judging');
    try {
      const evaluatorDirs = await readdir(judgingDir, { withFileTypes: true });

      for (const evalDir of evaluatorDirs) {
        if (!evalDir.isDirectory()) continue;

        const consensusPath = path.join(judgingDir, evalDir.name, 'consensus.json');
        try {
          const content = await readFile(consensusPath, 'utf-8');
          const data = JSON.parse(content);

          // CRITICAL: Read rawScore (original model output) for bias measurement, not score
          // (which is already bias-corrected). Fall back to score only for legacy records.
          // Without this, we'd measure residual bias after correction (≈0), making the
          // measurement circular and silently dismantling the correction on re-runs.
          const judges = (data.judges as RawJudgeData[])
            .filter((j) => j.valid && ((j.rawScore ?? j.score) != null))
            .map((j) => ({
              judgeId: j.judgeId,
              score: (j.rawScore ?? j.score)!,  // Use rawScore for true empirical bias
              valid: true,
            }));

          results.push({
            evaluatorId: data.evaluatorId,
            simulationId: data.simulationId,
            judges,
            scale: data.scale
          });
        } catch {
          // Skip missing/invalid consensus files
        }
      }
    } catch {
      // Skip simulations without judging directory
    }
  }

  return results;
}

function normalizeScore(score: number, scale: { min: number; max: number }): number {
  return (score - scale.min) / (scale.max - scale.min);
}

function computeBias(consensusData: ConsensusData[]): Record<string, {
  meanBias: number;
  medianBias: number;
  stdDev: number;
  n: number;
  vsBaseline: string;
}> {
  // Use GPT-5.2 as baseline (most common, middle of the road)
  const BASELINE_JUDGE = 'gpt-5.2';

  // Group by judge pair (gemini vs gpt, claude vs gpt, etc.)
  const judgeComparisons = new Map<string, number[]>();

  for (const consensus of consensusData) {
    if (consensus.judges.length < 2) continue;

    const baselineJudge = consensus.judges.find(j => j.judgeId === BASELINE_JUDGE);
    if (!baselineJudge) continue;

    const baselineNormalized = normalizeScore(baselineJudge.score, consensus.scale);

    for (const judge of consensus.judges) {
      if (judge.judgeId === BASELINE_JUDGE) continue;

      const judgeNormalized = normalizeScore(judge.score, consensus.scale);
      const bias = judgeNormalized - baselineNormalized;

      if (!judgeComparisons.has(judge.judgeId)) {
        judgeComparisons.set(judge.judgeId, []);
      }
      judgeComparisons.get(judge.judgeId)!.push(bias);
    }
  }

  // Compute statistics
  const results: Record<string, any> = {};

  for (const [judgeId, biases] of judgeComparisons) {
    const sorted = [...biases].sort((a, b) => a - b);
    const mean = biases.reduce((a, b) => a + b, 0) / biases.length;
    const median = sorted[Math.floor(sorted.length / 2)]!;
    const variance = biases.reduce((acc, x) => acc + (x - mean) ** 2, 0) / (biases.length - 1);
    const stdDev = Math.sqrt(variance);

    results[judgeId] = {
      meanBias: mean * 100,  // Convert back to 0-100 scale
      medianBias: median * 100,
      stdDev: stdDev * 100,
      n: biases.length,
      vsBaseline: BASELINE_JUDGE
    };
  }

  return results;
}

async function main(): Promise<void> {
  const datasetDir = path.resolve(process.cwd(), 'dataset');

  console.log('Loading consensus files...');
  const consensusData = await loadConsensusFiles(datasetDir);
  console.log(`Loaded ${consensusData.length} consensus files`);

  console.log('\nComputing judge bias...');
  const biases = computeBias(consensusData);

  console.log('\n=== Judge Bias Analysis (RAW SCORES) ===\n');
  console.log('Measured on rawScore field (original model output before bias correction).');
  console.log(`Baseline: ${Object.values(biases)[0]?.vsBaseline || 'gpt-5.2'}\n`);

  for (const [judgeId, stats] of Object.entries(biases)) {
    console.log(`${judgeId}:`);
    console.log(`  Mean bias: ${stats.meanBias.toFixed(2)} points`);
    console.log(`  Median bias: ${stats.medianBias.toFixed(2)} points`);
    console.log(`  Std dev: ${stats.stdDev.toFixed(2)}`);
    console.log(`  N: ${stats.n} comparisons`);
    console.log('');
  }

  console.log('\n=== Recommended Corrections (for run.ts JUDGE_BIAS_CORRECTIONS) ===\n');
  console.log('// Copy this into run.ts at line ~520 to update empirical bias corrections');
  console.log('const JUDGE_BIAS_CORRECTIONS: Record<string, number> = {');
  for (const [judgeId, stats] of Object.entries(biases)) {
    // Use negative of median bias (to correct it)
    const correction = -Math.round(stats.medianBias);
    console.log(`  '${judgeId}': ${correction},  // Median bias: ${stats.medianBias.toFixed(1)} pts vs. ${Object.values(biases)[0]?.vsBaseline || 'gpt-5.2'} (n=${stats.n})`);
  }
  console.log('};');
  console.log('\nNOTE: These corrections are derived from RAW model outputs, not bias-corrected scores.');
}

main().catch(console.error);
