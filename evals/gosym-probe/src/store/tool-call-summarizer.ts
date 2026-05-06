import type { Turn } from '../runner/transcript.js';
import type {
  ToolCallEntry,
  ToolCallSummary,
} from './types.js';

export function summarizeToolCalls(
  turns: Turn[],
): ToolCallSummary {
  const sequence: ToolCallEntry[] = [];
  const countByTool: Record<string, number> = {};
  let failedCount = 0;

  for (let turnIndex = 0; turnIndex < turns.length; turnIndex++) {
    const turn = turns[turnIndex];
    for (const tc of turn.toolCalls) {
      const hasError = tc.error !== undefined;
      const entry: ToolCallEntry = {
        index: sequence.length,
        turnIndex,
        name: tc.name,
        hasError,
        startTime: tc.startTime,
        endTime: tc.endTime,
        ...(tc.agentId !== undefined && { agentId: tc.agentId }),
      };
      sequence.push(entry);
      countByTool[tc.name] = (countByTool[tc.name] ?? 0) + 1;
      if (hasError) failedCount++;
    }
  }

  const uniqueTools = Object.keys(countByTool).sort();

  return {
    sequence,
    totalCount: sequence.length,
    failedCount,
    uniqueTools,
    uniqueCount: uniqueTools.length,
    countByTool,
  };
}
