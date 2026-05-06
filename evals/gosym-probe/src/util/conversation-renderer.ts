import type { Turn } from '../runner/transcript.js';

function formatRelativeTime(offsetMs: number): string {
  const seconds = offsetMs / 1000;
  const sign = seconds < 0 ? '-' : '+';
  return `${sign}${Math.abs(seconds).toFixed(1)}s`;
}

export function renderConversation(
  turns: Turn[],
  scenarioName: string,
  trialIndex: number,
): string {
  const header =
    `# Conversation: ${scenarioName}` +
    ` (Trial ${trialIndex + 1})`;

  if (turns.length === 0) {
    return `${header}\n\n*(no turns)*\n`;
  }

  const baseTimestamp =
    turns.find((t) => Number.isFinite(t.timestamp))?.timestamp ?? 0;
  const lines: string[] = [header, ''];

  const contentTurns = turns.filter(
    (t) => t.content.trim() !== '',
  );
  for (const turn of contentTurns) {
    const rawOffset = turn.timestamp - baseTimestamp;
    const offset = Number.isFinite(rawOffset) ? rawOffset : 0;
    const relTime = formatRelativeTime(offset);
    const role = turn.role === 'user' ? 'User' : 'Assistant';

    lines.push('---', '');
    lines.push(`**${role}** [${relTime}]`, '');
    // Content is not sanitized — it may contain legitimate markdown.
    lines.push(turn.content, '');
  }

  const lastContentTimestamp = contentTurns.length > 0
    ? contentTurns[contentTurns.length - 1].timestamp
    : baseTimestamp;
  const rawElapsed = lastContentTimestamp - baseTimestamp;
  const elapsedMs = Number.isFinite(rawElapsed)
    ? Math.max(0, rawElapsed)
    : 0;
  const elapsedStr = (elapsedMs / 1000).toFixed(1);
  const count = contentTurns.length;
  const plural = count === 1 ? 'message' : 'messages';

  lines.push('---', '');
  lines.push(
    `*${count} ${plural}, ${elapsedStr}s elapsed*`,
  );
  lines.push('');

  return lines.join('\n');
}
