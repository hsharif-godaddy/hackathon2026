import type { EvalResult, Evaluator } from './evaluator.js';
import type { DOMSnapshot, ToolCall, Transcript, Turn } from '../runner/transcript.js';
import type { Scenario } from '../scenarios/types.js';
import type { IGocodeClient } from '../clients/gocode-client.js';

const RELEVANT_TOOLS = new Set([
  'todoList',
  'askQuestion',
  'suggestedResponse',
  'setProjectName',
  'handoff',
]);

function hasCreateList(transcript: Transcript): boolean {
  for (const turn of transcript.turns) {
    for (const tc of turn.toolCalls) {
      if (tc.name === 'todoList') {
        const input = tc.input as Record<string, unknown> | undefined;
        if (input?.operation === 'create_list') {
          return true;
        }
      }
    }
  }
  return false;
}

const MAX_FIELD_CHARS = 500;

function summarizeInput(name: string, input: unknown): unknown {
  if (!input || typeof input !== 'object') return input;
  const obj = input as Record<string, unknown>;

  if (name === 'handoff') {
    return { targetAgent: obj.targetAgent, planTitle: obj.planTitle };
  }
  if (name === 'todoList' && obj.operation === 'create_list') {
    const items = Array.isArray(obj.items)
      ? (obj.items as Array<Record<string, unknown>>).map(
        (it) => ({ id: it.id, title: it.title }),
      )
      : obj.items;
    return { operation: obj.operation, listName: obj.listName, items };
  }
  return input;
}

function summarizeOutput(name: string, output: unknown): unknown {
  if (typeof output === 'string') {
    return output.length > MAX_FIELD_CHARS
      ? output.slice(0, MAX_FIELD_CHARS) + '...'
      : output;
  }
  if (!output || typeof output !== 'object') return output;
  const obj = output as Record<string, unknown>;

  if (name === 'todoList') {
    const list = obj.list as Record<string, unknown> | undefined;
    if (list && Array.isArray(list.items)) {
      const items = (list.items as Array<Record<string, unknown>>).map(
        (it) => ({ id: it.id, title: it.title, completed: it.completed }),
      );
      return { success: obj.success, operation: obj.operation, items };
    }
    if (Array.isArray(obj.items)) {
      const items = (obj.items as Array<Record<string, unknown>>).map(
        (it) => ({ id: it.id, completed: it.completed }),
      );
      return { success: obj.success, operation: obj.operation, items };
    }
    return { success: obj.success, operation: obj.operation };
  }
  if (name === 'handoff') {
    return { success: obj.success };
  }
  return output;
}

function truncate(str: string): string {
  return str.length > MAX_FIELD_CHARS
    ? str.slice(0, MAX_FIELD_CHARS) + '... [truncated]'
    : str;
}

function formatToolCall(tc: ToolCall, index: number): string {
  const summarizedInput = summarizeInput(tc.name, tc.input);
  const summarizedOutput = summarizeOutput(tc.name, tc.output);
  const inputStr = truncate(JSON.stringify(summarizedInput ?? {}));
  const outputStr = truncate(JSON.stringify(summarizedOutput ?? {}));
  const errorStr = tc.error ? ` ERROR: ${tc.error}` : '';
  return `[${index}] ${tc.name}(${inputStr}) → ${outputStr}${errorStr}`;
}

function formatTurn(turn: Turn, turnIndex: number): string {
  const relevantCalls = turn.toolCalls.filter((tc) =>
    RELEVANT_TOOLS.has(tc.name),
  );

  const header = `=== TURN ${turnIndex + 1} | role=${turn.role} ===`;

  if (turn.role === 'user') {
    return `${header}\n"${turn.content}"`;
  }

  if (relevantCalls.length === 0) {
    return '';
  }

  const toolLines = relevantCalls.map((tc) => {
    const originalIndex = turn.toolCalls.indexOf(tc);
    return formatToolCall(tc, originalIndex);
  });

  return `${header}\n${toolLines.join('\n')}`;
}

export function serializeTraceForTodo(transcript: Transcript): string {
  const parts: string[] = [];
  for (let i = 0; i < transcript.turns.length; i++) {
    const formatted = formatTurn(transcript.turns[i], i);
    if (formatted) {
      parts.push(formatted);
    }
  }
  return parts.join('\n\n');
}

interface ChecklistQuestion {
  id: string;
  question: string;
  flagIf: string;
}

interface ChecklistSection {
  section: string;
  questions: ChecklistQuestion[];
}

const CHECKLIST_SECTIONS: ChecklistSection[] = [
  {
    section: 'Todo list lifecycle',
    questions: [
      { id: 'A1', question: 'Was todoList create_list called in this trace?', flagIf: 'No' },
      { id: 'A2', question: 'How many items did create_list put in the list?', flagIf: '0 or unknown' },
      { id: 'A3', question: 'How many distinct item IDs were passed to mark_done across all turns?', flagIf: 'Never — this is informational' },
      { id: 'A4', question: 'Do the mark_done item IDs cover every item from create_list?', flagIf: 'No, Partial, or None' },
      { id: 'A5', question: 'Was mark_done ever called at all in this trace?', flagIf: 'No' },
    ],
  },
  {
    section: 'Ordering — mark_done vs stop-after tools',
    questions: [
      { id: 'B1', question: 'In the final build turn, was todoList mark_done present?', flagIf: 'No or Not called' },
      { id: 'B2', question: 'In the final build turn, what tool call index was mark_done?', flagIf: 'absent' },
      { id: 'B3', question: 'In the final build turn, what tool call index was askQuestion or suggestedResponse (whichever appeared)?', flagIf: 'Never — this is informational' },
      { id: 'B4', question: 'Was mark_done called BEFORE askQuestion/suggestedResponse in that turn? (lower index = earlier)', flagIf: 'No, askQuestion first, suggestedResponse first, or Not called' },
      { id: 'B5', question: 'Was there any turn where askQuestion fired but no mark_done ran, despite the list having incomplete items at that point?', flagIf: 'Yes' },
    ],
  },
  {
    section: 'Post-build question quality',
    questions: [
      { id: 'C1', question: 'Was a post-build askQuestion or suggestedResponse called?', flagIf: 'No' },
      { id: 'C2', question: 'Was setProjectName called at any point before the post-build question? (Answer N/A if setProjectName was never called in the trace at all)', flagIf: 'No (means name context exists — any naming question is wrong)' },
      { id: 'C3', question: 'Does the post-build question text ask about the project/app name?', flagIf: 'Yes, Name question, or Asks for name' },
      { id: 'C4', question: 'What topic does the post-build question cover?', flagIf: 'name, branding, setup info, business type, or any information-gathering that predates the build' },
      { id: 'C5', question: 'Are all post-build suggestions concrete build modifications (not information requests)?', flagIf: 'No, Partial, or Info gathering' },
    ],
  },
];

function buildChecklistPrompt(serializedTrace: string): string {
  const questionsBlock = CHECKLIST_SECTIONS.map((s) => {
    const header = `── ${s.section} ──`;
    const items = s.questions.map(
      (q) => `  - id: "${q.id}" | question: "${q.question}" | FLAG if: ${q.flagIf}`,
    ).join('\n');
    return `${header}\n${items}`;
  }).join('\n\n');

  return `You are a strict trace auditor for an AI web builder agent. Your job is to answer a static checklist about how the agent managed its todo list during a build session. You are looking for specific failure modes: items never marked done, mark_done skipped because a stop-after tool fired first, and an incorrect post-build question (e.g., asking for the project name after it was already set).

Answer EVERY question. For each question, provide:
1. "reasoning" — a brief explanation (1-2 sentences) of what you observed in the trace that led to your answer.
2. "answer" — a short answer (5 words or fewer): "Yes", "No", a number, or "N/A".
3. "result" — "PASS" or "FLAG" based on the FLAG-if criteria.

Respond with a single JSON object. Do NOT output anything outside the JSON.

{
  "questions": [
    { "id": "A1", "reasoning": "...", "answer": "...", "result": "PASS" or "FLAG" },
    ...one entry per question in order...
  ],
  "overall": "pass" or "flag"  // "flag" if ANY question has result "FLAG"
}

════════════════════════════════════════════
TRACE
════════════════════════════════════════════

A "turn" is one agent response. Tool calls within a turn are listed in call order (index 0 = first called). startTime/endTime are ms epoch.

${serializedTrace}

════════════════════════════════════════════
CHECKLIST
════════════════════════════════════════════

${questionsBlock}`;
}

interface ParsedQuestion {
  id: string;
  question: string;
  reasoning: string;
  answer: string;
  result: 'PASS' | 'FLAG';
}

function extractJsonObject(text: string): string | null {
  const stripped = text.replace(/```(?:json)?\s*\n?/g, '').trim();
  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  return stripped.slice(start, end + 1);
}

export class TodoLifecycleEvaluator implements Evaluator {
  readonly name = 'todo-lifecycle';
  readonly deterministic = false;

  constructor(private readonly gocodeClient: IGocodeClient) {}

  async evaluate(
    transcript: Transcript,
    _scenario: Scenario,
    _snapshot?: DOMSnapshot,
  ): Promise<EvalResult> {
    if (!hasCreateList(transcript)) {
      return {
        evaluator: this.name,
        score: 0,
        verdict: 'unknown',
        reason: 'No todoList create_list call found in transcript',
      };
    }

    const serializedTrace = serializeTraceForTodo(transcript);
    const prompt = buildChecklistPrompt(serializedTrace);

    const response = await this.gocodeClient.complete([
      { role: 'user', content: prompt },
    ]);

    return this.parseResponse(response);
  }

  private parseResponse(response: string): EvalResult {
    const jsonText = extractJsonObject(response);
    if (!jsonText) {
      return {
        evaluator: this.name,
        score: 0,
        verdict: 'unknown',
        reason: 'No JSON object found in LLM judge response',
        details: { rawResponse: response.slice(0, 800) },
        evaluatorFailed: true,
      };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      return {
        evaluator: this.name,
        score: 0,
        verdict: 'unknown',
        reason: 'LLM judge response contained malformed JSON',
        details: { rawResponse: response.slice(0, 800) },
        evaluatorFailed: true,
      };
    }

    const obj = parsed as Record<string, unknown>;
    if (!obj || typeof obj !== 'object' || !Array.isArray(obj.questions)) {
      return {
        evaluator: this.name,
        score: 0,
        verdict: 'unknown',
        reason: 'LLM judge JSON missing "questions" array',
        details: { rawResponse: response.slice(0, 800) },
        evaluatorFailed: true,
      };
    }

    const questions = obj.questions as unknown[];
    const overall = typeof obj.overall === 'string' ? obj.overall : undefined;
    const questionLookup = new Map(
      CHECKLIST_SECTIONS.flatMap((s) => s.questions).map((q) => [q.id, q.question]),
    );

    const flags: string[] = [];
    const passes: string[] = [];
    const parsedQuestions: ParsedQuestion[] = [];

    for (const entry of questions) {
      if (!entry || typeof entry !== 'object') continue;
      const e = entry as Record<string, unknown>;
      const id = typeof e.id === 'string' ? e.id : '';
      const reasoning = typeof e.reasoning === 'string' ? e.reasoning : '';
      const answer = typeof e.answer === 'string' ? e.answer : String(e.answer ?? '');
      const result = (typeof e.result === 'string' ? e.result.toUpperCase() : '') as 'PASS' | 'FLAG';

      if (!id || (result !== 'PASS' && result !== 'FLAG')) continue;

      const question = questionLookup.get(id) ?? '';
      parsedQuestions.push({ id, question, reasoning, answer, result });

      if (result === 'FLAG') {
        flags.push(id);
      } else {
        passes.push(id);
      }
    }

    const totalExpected = CHECKLIST_SECTIONS.flatMap((s) => s.questions).length;

    if (parsedQuestions.length === 0) {
      return {
        evaluator: this.name,
        score: 0,
        verdict: 'unknown',
        reason: 'Failed to parse LLM judge response — no valid questions in JSON',
        details: { rawResponse: response.slice(0, 800) },
        evaluatorFailed: true,
      };
    }

    const answeredIds = new Set(parsedQuestions.map((q) => q.id));
    const missingIds = CHECKLIST_SECTIONS
      .flatMap((s) => s.questions)
      .filter((q) => !answeredIds.has(q.id))
      .map((q) => q.id);

    const overallVerdict = overall !== undefined
      ? overall.toLowerCase()
      : (flags.length > 0 || missingIds.length > 0 ? 'flag' : 'pass');

    const score = passes.length / totalExpected;
    const verdict: EvalResult['verdict'] = overallVerdict === 'pass' && missingIds.length === 0
      ? 'pass'
      : 'fail';

    const flagSummary = [...flags, ...missingIds.map((id) => `${id}(missing)`)];
    const reason = verdict === 'pass'
      ? `All ${totalExpected} checklist questions passed`
      : `${flagSummary.length}/${totalExpected} questions flagged: ${flagSummary.join(', ')}`;

    return {
      evaluator: this.name,
      score: Math.max(0, Math.min(1, score)),
      verdict,
      reason,
      details: {
        flags,
        missingIds,
        passes,
        totalExpected,
        checklist: parsedQuestions,
      },
    };
  }
}
