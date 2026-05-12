import type { Turn } from '../runner/transcript.js';

export interface ConversationTurn {
  role: Turn['role'];
  content: string;
  durationSeconds: number;
}

export interface ConversationJson {
  scenarioName: string;
  trial: number;
  turns: ConversationTurn[];
  summary: {
    messageCount: number;
    totalElapsedSeconds: number;
  };
}

export function renderConversation(
  turns: Turn[],
  scenarioName: string,
  trialIndex: number,
): ConversationJson {
  const contentTurns = turns.filter(
    (t) => t.content.trim() !== '',
  );

  const baseTimestamp =
    turns.find((t) => Number.isFinite(t.timestamp))?.timestamp ?? 0;

  const jsonTurns: ConversationTurn[] = contentTurns.map(
    (turn, i) => {
      let durationMs: number;
      if (i === 0) {
        durationMs = 0;
      } else {
        const prevTimestamp = contentTurns[i - 1].timestamp;
        const raw = turn.timestamp - prevTimestamp;
        durationMs = Number.isFinite(raw) ? Math.max(0, raw) : 0;
      }

      return {
        role: turn.role,
        content: turn.content,
        durationSeconds: parseFloat(
          (durationMs / 1000).toFixed(1),
        ),
      };
    },
  );

  const lastContentTimestamp =
    contentTurns.length > 0
      ? contentTurns[contentTurns.length - 1].timestamp
      : baseTimestamp;
  const rawElapsed = lastContentTimestamp - baseTimestamp;
  const elapsedMs = Number.isFinite(rawElapsed)
    ? Math.max(0, rawElapsed)
    : 0;

  return {
    scenarioName,
    trial: trialIndex + 1,
    turns: jsonTurns,
    summary: {
      messageCount: contentTurns.length,
      totalElapsedSeconds: parseFloat(
        (elapsedMs / 1000).toFixed(1),
      ),
    },
  };
}
