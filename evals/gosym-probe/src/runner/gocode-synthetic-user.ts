import type { SyntheticUserAgent } from './synthetic-user.js';
import type { IGocodeClient } from '../clients/gocode-client.js';
import type { GoalTracker } from './goal-tracker.js';
import type { Scenario } from '../scenarios/types.js';
import type { Turn } from './transcript.js';

const DONE_SIGNAL = 'DONE';

interface AskQuestionOutput {
  widgetType: 'ask-question';
  widgetData: {
    questions: Array<{
      question: string;
      suggestions?: Array<{ text: string }>;
      allowOther?: boolean;
    }>;
  };
}

export class GocodeSyntheticUser implements SyntheticUserAgent {
  constructor(private readonly client: IGocodeClient) {}

  async nextMessage(
    history: Turn[],
    scenario: Scenario,
    goalTracker?: GoalTracker,
  ): Promise<string | null> {
    const userTurns = history.filter(
      (t) => t.role === 'user',
    ).length;

    // Bypass LLM for scenarios with a fixed first message.
    if (
      userTurns === 0 &&
      scenario.staticFirstMessage !== undefined
    ) {
      return scenario.staticFirstMessage;
    }

    const systemPrompt = goalTracker
      ? this.buildTrackerSystemPrompt(scenario, goalTracker)
      : this.buildFlatSystemPrompt(scenario);

    const userContent =
      history.length === 0
        ? 'Start the conversation by introducing your goal to the agent.'
        : this.buildHistoryPrompt(history);

    const response = await this.client.complete([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ]);

    const trimmed = response.trim();
    return trimmed === DONE_SIGNAL ? null : trimmed;
  }

  private buildFlatSystemPrompt(scenario: Scenario): string {
    const goalLines = scenario.goals
      .map((g) => {
        const verb = g.assertion === 'positive' ? 'ACHIEVE' : 'AVOID';
        return `- ${verb}: ${g.description}`;
      })
      .join('\n');

    return (
      `${scenario.persona.systemPrompt}\n\n` +
      `Your goals:\n${goalLines}\n\n` +
      `Respond ONLY with your next message to the agent. ` +
      `Do not include any prefix like "User:" or extra explanation. ` +
      `Do not summarize or describe what the agent built — react as a real user would (brief acknowledgment and your next request). ` +
      `If you believe all goals are accomplished, respond with exactly: ` +
      `${DONE_SIGNAL}`
    );
  }

  private buildTrackerSystemPrompt(
    scenario: Scenario,
    goalTracker: GoalTracker,
  ): string {
    return (
      `${scenario.persona.systemPrompt}\n\n` +
      `${goalTracker.buildGoalPrompt()}\n\n` +
      `Respond ONLY with your next message to the agent. ` +
      `Do not include any prefix like "User:" or extra explanation. ` +
      `Do not summarize or describe what the agent built — react as a real user would (brief acknowledgment and your next request). ` +
      `Continue engaging naturally after each request. ` +
      `If all requests have been made, respond with exactly: ` +
      `${DONE_SIGNAL}`
    );
  }

  private buildHistoryPrompt(history: Turn[]): string {
    const historyText = history
      .map((t) => this.formatTurn(t))
      .join('\n\n');
    return (
      `Conversation so far:\n\n${historyText}\n\n` +
      `What is your next message?`
    );
  }

  private formatTurn(turn: Turn): string {
    const lines: string[] = [
      `${turn.role.toUpperCase()}: ${turn.content}`,
    ];
    for (const tc of turn.toolCalls) {
      if (this.isAskQuestion(tc.output)) {
        lines.push(this.formatAskQuestion(tc.output));
      } else {
        const detail = tc.output !== undefined ? tc.output : tc.input;
        if (detail !== undefined) {
          lines.push(`[tool: ${tc.name}] ${JSON.stringify(detail)}`);
        } else {
          lines.push(`[tool: ${tc.name}]`);
        }
      }
    }
    return lines.join('\n');
  }

  private isAskQuestion(output: unknown): output is AskQuestionOutput {
    if (typeof output !== 'object' || output === null) return false;
    const o = output as Record<string, unknown>;
    const widgetData = o.widgetData;
    if (
      o.widgetType !== 'ask-question' ||
      typeof widgetData !== 'object' ||
      widgetData === null
    ) {
      return false;
    }
    const questions = (widgetData as Record<string, unknown>).questions;
    return Array.isArray(questions) && questions.length > 0;
  }

  private formatAskQuestion(output: AskQuestionOutput): string {
    const lines = [
      '[AGENT IS ASKING YOU — answer these questions in your next message]:',
    ];
    for (let i = 0; i < output.widgetData.questions.length; i++) {
      const q = output.widgetData.questions[i];
      lines.push(`Q${i + 1}: ${q.question}`);
      if (q.suggestions && q.suggestions.length > 0) {
        lines.push(
          `    Options: ${q.suggestions.map(s => s.text).join(' | ')}` +
          `${q.allowOther !== false ? ' | or your own answer' : ''}`,
        );
      }
    }
    return lines.join('\n');
  }
}
