import type { SetupContext } from '../scenarios/types.js';

export interface ToolInfo {
  id: string;
  name: string;
  input?: unknown;
  output?: unknown;
  error?: string;
}

export type AgentEvent =
  | { type: 'chunk'; content: string }
  | { type: 'tool_start'; tool: ToolInfo }
  | { type: 'tool_call'; tool: ToolInfo }
  | { type: 'tool_input_delta'; tool: ToolInfo; delta: string }
  | { type: 'tool_result'; tool: ToolInfo }
  | { type: 'complete'; content: string; data?: Record<string, unknown> }
  | { type: 'step_complete'; content: string; data?: Record<string, unknown> }
  | { type: 'step_start'; agentName: string }
  | { type: 'error'; error: string }
  // AAB-specific diagnostic events. The evaluator
  // degrades gracefully when these are absent.
  // Adding a new diagnostic type requires changes
  // in three files:
  //   1. This union (AgentEvent)
  //   2. src/clients/aab-client.ts (socket handler)
  //   3. src/evaluators/latency-evaluator.ts
  //      (ChunkTimingCollector handler) or
  //      src/evaluators/token-usage-collector.ts
  //      (TokenUsageCollector handler)
  | {
      // Per-skill load/unload, emitted by the AAB agents service only
      // when SKILL_DIAGNOSTICS=true. Captured by Simulation into
      // Transcript.loadedSkills for the skill-selection evaluator.
      type: 'skill_diagnostics';
      event: 'load' | 'unload';
      skill: string;
    }
  | {
      // Liveness sentinel emitted once per turn when SKILL_DIAGNOSTICS=true,
      // before any skill loads. Proves instrumentation is on so the harness can
      // record loadedSkills as [] (a scorable zero-skill run) rather than
      // leaving it absent (unknown). Carries no skill name.
      type: 'skill_diagnostics';
      event: 'ready';
    }
  | {
      type: 'stream_timing_summary';
      timeToStreamStartMs: number;
      timeToFirstTextChunkMs: number | null;
      maxChunkGapMs: number;
      chunksRead: number;
      streamDurationMs: number;
    }
  | {
      type: 'stream_chunk_slow_gap';
      gapMs: number;
      chunksRead: number;
      streamElapsedMs: number;
    }
  | {
      type: 'stream_chunk_timeout';
      chunksRead: number;
      streamElapsedMs: number;
      timeToFirstTextChunkMs: number;
      maxChunkGapMs: number;
      error: string;
    }
  | {
      type: 'token_usage_summary';
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
      cachedInputTokensRead: number;
      cachedInputTokensWrite: number;
      modelName: string;
      totalCost: number;
      inputCost: number;
      outputCost: number;
      cachedInputCost: number;
      savings: number;
      currency: string;
    };

export interface AgentClient {
  configure(ctx: SetupContext): void;
  send(message: string): void;
  onMessage(handler: (event: AgentEvent) => void): void;
  disconnect(): void;
}
