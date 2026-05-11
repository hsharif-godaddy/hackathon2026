import type { DOMSnapshot, Transcript, Turn, ToolCall } from '../../runner/transcript.js';

const MAX_TEXT_CHARS = 20_000;
const MAX_HTML_CHARS = 20_000;

const BODY_RE = /<body[^>]*>([\s\S]*?)<\/body>/i;

export function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

export function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}... [truncated]`;
}

export function extractBodyHtml(html: string): string {
  const match = BODY_RE.exec(html);
  const body = match ? match[1] : html;
  return truncate(body, MAX_HTML_CHARS);
}

export function htmlToText(html: string): string {
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return truncate(stripped, MAX_TEXT_CHARS);
}

export function buildConversationText(turns: Turn[]): string {
  return truncate(
    turns.map(turnToLine).join('\n'),
    MAX_TEXT_CHARS,
  );
}

function turnToLine(turn: Turn): string {
  return `${turn.role.toUpperCase()}: ${(turn.content ?? '').trim()}`;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return '[unserializable]';
  }
}

export function summarizeToolCalls(toolCalls: ToolCall[]): string {
  if (toolCalls.length === 0) return '(none)';
  return truncate(
    toolCalls
      .map(function summarize(toolCall) {
        const status = toolCall.error ? `error=${toolCall.error}` : 'ok';
        const output = toolCall.output !== undefined
          ? safeStringify(toolCall.output)
          : '(no output)';
        return `- ${toolCall.name} (${status}) input=${safeStringify(toolCall.input)} output=${truncate(output, 600)}`;
      })
      .join('\n'),
    MAX_TEXT_CHARS,
  );
}

export function lastSnapshotSection(snapshot?: DOMSnapshot): string {
  if (!snapshot) return '(no snapshot)';

  const inlineHtml = 'html' in snapshot && typeof snapshot.html === 'string'
    ? snapshot.html
    : '';
  const body = extractBodyHtml(inlineHtml);
  const text = htmlToText(body);
  const consoleLogs = (snapshot.consoleLogs ?? [])
    .slice(-30)
    .map((log) => `${log.type}: ${log.text}`)
    .join('\n');

  return [
    `URL: ${snapshot.url}`,
    'htmlPath' in snapshot ? `HTML_PATH: ${snapshot.htmlPath}` : '',
    '',
    'BODY_HTML:',
    body || '(empty)',
    '',
    'BODY_TEXT:',
    text || '(empty)',
    '',
    'CONSOLE_LOGS (tail):',
    consoleLogs || '(none)',
  ].join('\n');
}

export function buildEvidence(
  transcript: Transcript,
  snapshot?: DOMSnapshot,
): {
  conversation: string;
  tools: string;
  finalSite: string;
  totalToolCalls: number;
} {
  const toolCalls = transcript.turns.flatMap((turn) => turn.toolCalls);
  return {
    conversation: buildConversationText(transcript.turns),
    tools: summarizeToolCalls(toolCalls),
    finalSite: lastSnapshotSection(snapshot),
    totalToolCalls: toolCalls.length,
  };
}
