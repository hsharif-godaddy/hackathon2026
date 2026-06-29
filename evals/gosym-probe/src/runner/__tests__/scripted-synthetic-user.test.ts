import { describe, it, expect, vi } from 'vitest';
import { ScriptedSyntheticUser } from '../scripted-synthetic-user.js';
import type { SyntheticUserAgent } from '../synthetic-user.js';
import type { Scenario } from '../../scenarios/types.js';
import type { Turn } from '../transcript.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeDelegate(response: string | null = 'delegate-msg'): SyntheticUserAgent {
  return { nextMessage: vi.fn().mockResolvedValue(response) };
}

function makeScenario(overrides: Partial<Scenario> = {}): Scenario {
  return {
    name: 'test',
    trials: 1,
    persona: { name: 'tester', description: '', systemPrompt: 'You are a tester.' },
    goals: [{ description: 'build a page', assertion: 'positive' }],
    evaluators: [],
    ...overrides,
  };
}

function userTurn(content: string): Turn {
  return { role: 'user', content, toolCalls: [], timestamp: 0 };
}

function assistantTurn(content: string): Turn {
  return { role: 'assistant', content, toolCalls: [], timestamp: 0 };
}

/** A full prior exchange = one user turn + one assistant reply. */
function exchange(n: number): Turn[] {
  return [userTurn(`u${n}`), assistantTurn(`a${n}`)];
}

// ── Pass-through (no script) ────────────────────────────────────────────────────

describe('ScriptedSyntheticUser — pass-through', () => {
  it('delegates when scriptedTurns is undefined', async () => {
    const delegate = makeDelegate('from-llm');
    const user = new ScriptedSyntheticUser(delegate);
    const result = await user.nextMessage([], makeScenario());
    expect(result).toBe('from-llm');
    expect(delegate.nextMessage).toHaveBeenCalledOnce();
  });

  it('delegates when scriptedTurns is an empty array', async () => {
    const delegate = makeDelegate('from-llm');
    const user = new ScriptedSyntheticUser(delegate);
    const result = await user.nextMessage([], makeScenario({ scriptedTurns: [] }));
    expect(result).toBe('from-llm');
    expect(delegate.nextMessage).toHaveBeenCalledOnce();
  });

  it('forwards history, scenario, and goalTracker unchanged to the delegate', async () => {
    const delegate = makeDelegate();
    const user = new ScriptedSyntheticUser(delegate);
    const scenario = makeScenario();
    const history = exchange(1);
    const tracker = {} as never;
    await user.nextMessage(history, scenario, tracker);
    expect(delegate.nextMessage).toHaveBeenCalledWith(history, scenario, tracker);
  });
});

// ── Scripted replay ─────────────────────────────────────────────────────────────

describe('ScriptedSyntheticUser — scripted replay', () => {
  const script = ['first message', 'second message', 'third message'];

  it('replays the nth script entry on the nth user turn, no LLM call', async () => {
    const delegate = makeDelegate();
    const user = new ScriptedSyntheticUser(delegate);
    const scenario = makeScenario({ scriptedTurns: script });

    // turn 0: no prior user turns
    expect(await user.nextMessage([], scenario)).toBe('first message');
    // turn 1: one prior exchange
    expect(await user.nextMessage(exchange(1), scenario)).toBe('second message');
    // turn 2: two prior exchanges
    expect(await user.nextMessage([...exchange(1), ...exchange(2)], scenario))
      .toBe('third message');

    expect(delegate.nextMessage).not.toHaveBeenCalled();
  });

  it('counts only user turns when advancing the script', async () => {
    const delegate = makeDelegate();
    const user = new ScriptedSyntheticUser(delegate);
    const scenario = makeScenario({ scriptedTurns: script });
    // history with one user turn but several assistant turns → still index 1
    const history = [userTurn('u1'), assistantTurn('a1'), assistantTurn('a1b')];
    expect(await user.nextMessage(history, scenario)).toBe('second message');
  });
});

// ── Script exhaustion ───────────────────────────────────────────────────────────

describe('ScriptedSyntheticUser — exhaustion', () => {
  const script = ['only message'];

  it('delegates to the LLM after the script is exhausted by default', async () => {
    const delegate = makeDelegate('llm-continuation');
    const user = new ScriptedSyntheticUser(delegate);
    const scenario = makeScenario({ scriptedTurns: script });
    const result = await user.nextMessage(exchange(1), scenario);
    expect(result).toBe('llm-continuation');
    expect(delegate.nextMessage).toHaveBeenCalledOnce();
  });

  it('ends the conversation when scriptEndsConversation is set', async () => {
    const delegate = makeDelegate('should-not-be-used');
    const user = new ScriptedSyntheticUser(delegate);
    const scenario = makeScenario({
      scriptedTurns: script,
      scriptEndsConversation: true,
    });
    const result = await user.nextMessage(exchange(1), scenario);
    expect(result).toBeNull();
    expect(delegate.nextMessage).not.toHaveBeenCalled();
  });
});
