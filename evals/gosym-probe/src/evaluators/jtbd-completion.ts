import type { EvalResult, Evaluator } from './evaluator.js';
import type { DOMSnapshot, Transcript } from '../runner/transcript.js';
import type { Scenario } from '../scenarios/types.js';
import type { GocodeClient } from '../clients/gocode-client.js';

function buildTranscriptText(transcript: Transcript): string {
  return transcript.turns
    .map((t) => `[${t.role.toUpperCase()}]: ${t.content}`)
    .join('\n');
}

function buildGoalsText(scenario: Scenario): string {
  return scenario.goals
    .map((g, i) => {
      const prefix =
        g.assertion === 'positive'
          ? 'Did the agent accomplish'
          : 'Did the agent correctly avoid';
      return `${i + 1}. ${prefix}: "${g.description}"`;
    })
    .join('\n');
}

function verdictToScore(verdict: EvalResult['verdict']): number {
  switch (verdict) {
    case 'pass':    return 1.0;
    case 'partial': return 0.5;
    case 'fail':    return 0.0;
    case 'unknown':  return 0.0;
    case 'observed': return 0.0;
    default: {
      const _exhaustive: never = verdict;
      return _exhaustive;
    }
  }
}

function parseVerdict(response: string): EvalResult['verdict'] {
  const lower = response.trim().toLowerCase();
  if (lower.includes('partial')) return 'partial';
  if (lower.includes('pass'))    return 'pass';
  if (lower.includes('fail'))    return 'fail';
  if (lower.includes('unknown')) return 'unknown';
  return 'unknown';
}

export class JTBDCompletionEvaluator implements Evaluator {
  readonly name = 'jtbd-completion';

  constructor(private readonly gocodeClient: GocodeClient) {}

  async evaluate(
    transcript: Transcript,
    scenario: Scenario,
    _snapshot?: DOMSnapshot,
  ): Promise<EvalResult> {
    if (scenario.goals.length === 0) {
      return {
        evaluator: this.name,
        score: 0,
        verdict: 'unknown',
        reason: 'No goals defined for scenario',
      };
    }

    const transcriptText = buildTranscriptText(transcript);
    const goalsText = buildGoalsText(scenario);

    let refSection = '';
    if (
      scenario.referenceSolution &&
      typeof scenario.referenceSolution === 'string'
    ) {
      refSection =
        `\nReference Solution:\n${scenario.referenceSolution}\n`;
    }

    const prompt = [
      'You are an evaluator assessing whether an AI agent completed',
      'its assigned goals. Review the conversation transcript and goals.',
      '',
      'Transcript:',
      transcriptText,
      '',
      'Goals:',
      goalsText,
      refSection,
      'Reply with exactly one word: pass, partial, fail, or unknown.',
      'Use "unknown" if the transcript provides insufficient information',
      'to make a determination.',
    ].join('\n');

    const response = await this.gocodeClient.complete([
      { role: 'user', content: prompt },
    ]);

    const verdict = parseVerdict(response);
    const score = verdictToScore(verdict);

    return {
      evaluator: this.name,
      score,
      verdict,
      reason: `LLM judge verdict: ${verdict}`,
    };
  }
}
