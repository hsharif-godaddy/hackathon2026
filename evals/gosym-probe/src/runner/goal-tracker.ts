import type { ScenarioGoal } from '../scenarios/types.js';

interface IndexedGoal {
  index: number;
  goal: ScenarioGoal;
}

export class GoalTracker {
  private readonly positiveGoals: IndexedGoal[];
  private readonly negativeGoals: IndexedGoal[];
  private readonly requestedIndices: Set<number>;

  constructor(goals: ScenarioGoal[]) {
    this.positiveGoals = [];
    this.negativeGoals = [];
    this.requestedIndices = new Set();

    goals.forEach((goal, index) => {
      if (goal.assertion === 'positive') {
        this.positiveGoals.push({ index, goal });
      } else {
        this.negativeGoals.push({ index, goal });
      }
    });
  }

  nextGoal(): ScenarioGoal | null {
    const next = this.positiveGoals.find(
      ({ index }) => !this.requestedIndices.has(index),
    );
    return next?.goal ?? null;
  }

  markRequested(index: number): void {
    this.requestedIndices.add(index);
  }

  allPositiveRequested(): boolean {
    return this.positiveGoals.every(
      ({ index }) => this.requestedIndices.has(index),
    );
  }

  buildGoalPrompt(): string {
    if (this.allPositiveRequested()) {
      return this.buildAllRequestedPrompt();
    }
    return this.buildUnrequestedRemainingPrompt();
  }

  private buildAllRequestedPrompt(): string {
    const sections: string[] = [];

    if (this.positiveGoals.length > 0) {
      const lines = this.positiveGoals
        .map(({ goal }) => `- ${goal.description}`)
        .join('\n');
      sections.push(`All goals have been requested:\n${lines}`);
    }

    if (this.negativeGoals.length > 0) {
      sections.push(this.buildConstraintsSection());
    }

    return sections.join('\n\n');
  }

  private buildUnrequestedRemainingPrompt(): string {
    const sections: string[] = [];

    const current = this.positiveGoals.find(
      ({ index }) => !this.requestedIndices.has(index),
    );
    const requested = this.positiveGoals.filter(
      ({ index }) => this.requestedIndices.has(index),
    );
    const pending = this.positiveGoals.filter(
      ({ index }) =>
        !this.requestedIndices.has(index) && index !== current?.index,
    );

    if (current) {
      sections.push(
        `Your current goal to request:\n- ${current.goal.description}`,
      );
    }

    if (requested.length > 0) {
      const lines = requested
        .map(({ goal }) => `- ${goal.description}`)
        .join('\n');
      sections.push(`Goals already requested:\n${lines}`);
    }

    if (pending.length > 0) {
      const lines = pending
        .map(({ goal }) => `- ${goal.description}`)
        .join('\n');
      sections.push(
        `Goals still pending (request in future turns):\n${lines}`,
      );
    }

    if (this.negativeGoals.length > 0) {
      sections.push(this.buildConstraintsSection());
    }

    return sections.join('\n\n');
  }

  private buildConstraintsSection(): string {
    const lines = this.negativeGoals
      .map(({ goal }) => `- AVOID: ${goal.description}`)
      .join('\n');
    return `Constraints (always apply):\n${lines}`;
  }
}
