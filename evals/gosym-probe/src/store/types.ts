import type {
  SanitizedConfig,
} from '../util/sanitize.js';
import type { RegressionResult } from '../baselines/types.js';
import type { Persona } from '../personas/types.js';
import type {
  ScenarioGoal,
  ToolCallAssertion,
} from '../scenarios/types.js';
import type { Turn } from '../runner/transcript.js';

export interface RunMetadata {
  runId: string;
  timestamp: string;
  gitSha: string | null;
  scenarios: string[];
  config: SanitizedConfig;
  trialsOverride?: number;
  concurrencyOverride?: number;
  maxTurnsOverride?: number;
  kind?: 'eval' | 'graduation';
}

export interface StoredScenarioConfig {
  name: string;
  trials: number;
  executionMode?: 'parallel' | 'sequential';
  persona: Omit<Persona, 'systemPrompt'>;
  goals: ScenarioGoal[];
  evaluators: string[];
  expectedTools?: ToolCallAssertion[];
}

export interface StoredTranscript {
  scenarioName: string;
  trialIndex: number;
  turns: Turn[];
  snapshotCount: number;
  errors: string[];
}

export interface StoredSnapshotMeta {
  index: number;
  url: string;
  timestamp: string;
}

export interface ScoreStats {
  min: number;
  max: number;
  mean: number;
  median: number;
  stddev: number;
}

export interface EvaluatorSummary {
  /** Absent when regressionMode === 'score'. */
  passAtK?: boolean;
  /** Absent when regressionMode === 'score'. */
  passToTheK?: boolean;
  passingTrials: number;
  totalTrials: number;
  scores: ScoreStats;
  verdicts: Record<string, number>;
  /** Median score excluding unknown-verdict trials; present only for score-mode evaluators. */
  medianScore?: number;
  evalVersion?: string;
  /** When true, score increase = regression. Present only for score-mode evaluators. */
  lowerIsBetter?: boolean;
}

export interface TimingStats {
  totalDurationMs: number;
  avgTrialDurationMs: number;
  avgTurnsPerTrial: number;
}

export interface StoredAggregated {
  scenarioName: string;
  evaluators: Record<string, EvaluatorSummary>;
  timing: TimingStats;
  regressionStatus?: RegressionResult;
}

export interface RunIndex {
  runs: Array<{
    runId: string;
    timestamp: string;
    dir: string;
    kind?: 'eval' | 'graduation';
  }>;
}

export interface ToolCallEntry {
  index: number;
  turnIndex: number;
  agentId?: string;
  name: string;
  hasError: boolean;
  startTime: number;
  endTime: number;
}

export interface ToolCallSummary {
  sequence: ToolCallEntry[];
  totalCount: number;
  failedCount: number;
  uniqueTools: string[];
  uniqueCount: number;
  countByTool: Record<string, number>;
}

export interface StoredToolCallSummary
  extends Omit<ToolCallSummary, 'failedCount'> {
  failedCount?: number;
}

export interface ArtifactEntry {
  index: number;
  turnIndex: number;
  toolName: string;
  filename: string;
  agentId?: string;
}

export interface StoredArtifactManifest {
  artifacts: ArtifactEntry[];
  totalCount: number;
}
