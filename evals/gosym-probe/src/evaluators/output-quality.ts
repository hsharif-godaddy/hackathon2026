import type { EvalResult, Evaluator } from './evaluator.js';
import type { DOMSnapshot, Transcript } from '../runner/transcript.js';
import type { Scenario } from '../scenarios/types.js';
import type { GocodeClient } from '../clients/gocode-client.js';

const MAX_HTML_CHARS = 10_000;
const BODY_RE = /<body[^>]*>([\s\S]*?)<\/body>/i;

function extractBodyContent(html: string): string {
  const match = BODY_RE.exec(html);
  const body = match ? match[1] : html;
  return body.length > MAX_HTML_CHARS
    ? body.slice(0, MAX_HTML_CHARS) + '... [truncated]'
    : body;
}

function isDOMSnapshot(value: unknown): value is DOMSnapshot {
  return (
    typeof value === 'object' &&
    value !== null &&
    'html' in value
  );
}

export class OutputQualityEvaluator implements Evaluator {
  readonly name = 'output-quality';
  readonly deterministic = false;

  constructor(private readonly gocodeClient: GocodeClient) {}

  async evaluate(
    _transcript: Transcript,
    scenario: Scenario,
    snapshot?: DOMSnapshot,
  ): Promise<EvalResult> {
    if (!snapshot || !snapshot.html.trim()) {
      return {
        evaluator: this.name,
        score: 0,
        verdict: 'unknown',
        reason: 'No DOM snapshot available to evaluate',
      };
    }

    const taskDescription = scenario.goals
      .map((g) => g.description)
      .join('; ');
    const htmlContent = extractBodyContent(snapshot.html);

    let refSection = '';
    if (isDOMSnapshot(scenario.referenceSolution)) {
      const refBody = extractBodyContent(scenario.referenceSolution.html);
      refSection = `\nReference DOM:\n${refBody}\n`;
    }

    const prompt = [
      "You are evaluating the quality of an AI agent's output based on",
      'a DOM snapshot.',
      '',
      `Task: ${taskDescription}`,
      '',
      'DOM Snapshot:',
      htmlContent,
      refSection,
      'Evaluate output quality on a 0.0\u20131.0 scale:',
      '- 1.0: Excellent, fully meets requirements',
      '- 0.7\u20130.9: Good, minor issues',
      '- 0.4\u20130.6: Partial, significant issues',
      '- 0.1\u20130.3: Poor, major issues',
      '- 0.0: Completely failed',
      '',
      'Reply in this format:',
      'SCORE: [0.0-1.0]',
      'VERDICT: [pass|partial|fail|unknown]',
      'REASON: [brief explanation]',
      '',
      'Use VERDICT: unknown if the snapshot is empty or insufficient.',
    ].join('\n');

    const response = await this.gocodeClient.complete([
      { role: 'user', content: prompt },
    ]);

    return this.parseResponse(response);
  }

  private parseResponse(response: string): EvalResult {
    const scoreMatch = /SCORE:\s*([\d.]+)/i.exec(response);
    const verdictMatch =
      /VERDICT:\s*(pass|partial|fail|unknown)/i.exec(response);
    const reasonMatch = /REASON:\s*(.+)/i.exec(response);

    if (!scoreMatch || !verdictMatch) {
      return {
        evaluator: this.name,
        score: 0,
        verdict: 'unknown',
        reason: 'Failed to parse LLM judge response',
      };
    }

    const rawScore = parseFloat(scoreMatch[1]);
    if (isNaN(rawScore)) {
      return {
        evaluator: this.name,
        score: 0,
        verdict: 'unknown',
        reason: 'Failed to parse LLM judge response',
      };
    }

    return {
      evaluator: this.name,
      score: Math.max(0, Math.min(1, rawScore)),
      verdict: verdictMatch[1].toLowerCase() as EvalResult['verdict'],
      reason: reasonMatch ? reasonMatch[1].trim() : 'LLM judge response',
    };
  }
}
