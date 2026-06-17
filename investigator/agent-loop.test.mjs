import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runInvestigation, stubStaleToolResults } from './agent-loop.mjs';

test('P1-1: system prompt rides as a cached message, not the system param', async () => {
  let seen = null;
  const generateTextImpl = async (opts) => {
    seen = opts;
    return { text: 'done', toolCalls: [], steps: [{ toolCalls: [], toolResults: [] }], response: { messages: [] }, totalUsage: { inputTokens: 1, outputTokens: 1 } };
  };
  await runInvestigation({ model: {}, system: 'BIG STABLE SYSTEM PROMPT', user: 'u', tools: {}, budget: { maxTurns: 3 }, onActivity: () => {}, onPhase: () => {}, generateTextImpl });
  assert.equal(seen.system, undefined); // not passed as a separate param
  assert.equal(seen.messages[0].role, 'system');
  assert.equal(seen.messages[0].content, 'BIG STABLE SYSTEM PROMPT');
  assert.deepEqual(seen.messages[0].providerOptions, { anthropic: { cacheControl: { type: 'ephemeral' } } });
});

test('P1-4: stubStaleToolResults clears old tool-result payloads, keeps recent ones intact', () => {
  const mk = (id, val) => ({ role: 'tool', content: [{ type: 'tool-result', toolCallId: id, toolName: 't', output: { type: 'json', value: val } }] });
  const messages = [
    { role: 'user', content: 'u' },
    mk('1', 'OLD-A'), mk('2', 'OLD-B'), mk('3', 'C'), mk('4', 'D'), mk('5', 'E'), mk('6', 'F'),
  ];
  stubStaleToolResults(messages, 4); // keep last 4 tool msgs (3..6), clear 1 & 2
  assert.match(messages[1].content[0].output.value, /cleared/);
  assert.equal(messages[1].content[0]._cleared, true);
  assert.equal(messages[2].content[0].output.value, '[older tool result cleared to conserve context — its conclusion is captured in the report/hypothesis ledger]');
  // recent ones untouched + pairing fields preserved
  assert.equal(messages[3].content[0].output.value, 'C');
  assert.equal(messages[1].content[0].toolCallId, '1');
});

test('P1-4: stubStaleToolResults is a no-op when shape is unexpected (never throws)', () => {
  const messages = [{ role: 'tool', content: 'not-an-array' }, { role: 'tool', content: null }];
  assert.doesNotThrow(() => stubStaleToolResults(messages, 0));
});

test('P1-5: repeated identical tool call gets a one-time corrective nudge', async () => {
  const seenMessages = [];
  let call = 0;
  const generateTextImpl = async (opts) => {
    seenMessages.push(JSON.stringify(opts.messages));
    call++;
    if (call <= 2) {
      // same tool + args both turns
      return {
        text: '', toolCalls: [{ toolName: 'ripgrepSeed', input: { query: 'foo' } }],
        steps: [{ toolCalls: [{ toolName: 'ripgrepSeed', input: { query: 'foo' } }], toolResults: [] }],
        response: { messages: [{ role: 'assistant', content: 'tc' }] },
        totalUsage: { inputTokens: 1, outputTokens: 1 },
      };
    }
    return { text: 'final', toolCalls: [], steps: [{ toolCalls: [], toolResults: [] }], response: { messages: [] }, totalUsage: { inputTokens: 1, outputTokens: 1 } };
  };
  await runInvestigation({ model: {}, system: 's', user: 'u', tools: { ripgrepSeed: { execute: async () => ({ ok: true }) } }, budget: { maxTurns: 5 }, onActivity: () => {}, onPhase: () => {}, generateTextImpl });
  // by turn 3 the message history must contain the control nudge
  assert.match(seenMessages[2], /investigation-control/);
  assert.match(seenMessages[2], /ripgrepSeed/);
});

test('runInvestigation loops tools then returns the final report + activity events', async () => {
  const activity = [];
  const phases = [];
  let call = 0;
  const generateTextImpl = async () => {
    call++;
    if (call === 1) {
      return {
        text: '',
        toolCalls: [{ toolName: 'logDigest', input: {} }],
        steps: [{ toolCalls: [{ toolName: 'logDigest', input: {} }], toolResults: [{ result: { ok: true, templates: [] } }] }],
        response: { messages: [{ role: 'assistant', content: 'used tool' }] },
        totalUsage: { inputTokens: 10, outputTokens: 5 },
      };
    }
    return {
      text: 'ROOT CAUSE: the route was missing.',
      toolCalls: [],
      steps: [{ toolCalls: [], toolResults: [] }],
      response: { messages: [{ role: 'assistant', content: 'ROOT CAUSE: the route was missing.' }] },
      totalUsage: { inputTokens: 8, outputTokens: 4 },
    };
  };
  const r = await runInvestigation({
    model: {},
    system: 'sys',
    user: 'investigate app1',
    tools: { logDigest: { execute: async () => ({ ok: true, templates: [] }) } },
    budget: { maxTurns: 10 },
    onActivity: (a) => activity.push(a),
    onPhase: (p) => phases.push(p),
    generateTextImpl,
  });
  assert.match(r.report, /ROOT CAUSE/);
  assert.ok(activity.some((a) => a.tool === 'logDigest'));
  assert.ok(r.usage.inputTokens >= 18);
});

test('runInvestigation stops at maxTurns and returns a forced partial report', async () => {
  let call = 0;
  const generateTextImpl = async () => {
    call++;
    return {
      text: '',
      toolCalls: [{ toolName: 'astGrep', input: { pattern: 'foo' } }],
      steps: [{ toolCalls: [{ toolName: 'astGrep', input: {} }], toolResults: [] }],
      response: { messages: [{ role: 'assistant', content: 'tool call' }] },
      totalUsage: { inputTokens: 1, outputTokens: 1 },
    };
  };
  const r = await runInvestigation({
    model: {},
    system: 's',
    user: 'u',
    tools: {},
    budget: { maxTurns: 3 },
    onActivity: () => {},
    onPhase: () => {},
    generateTextImpl,
  });
  assert.equal(typeof r.report, 'string');
  assert.ok(r.report.length > 0);
  assert.equal(r.coverage.partial, true);
});

test('runInvestigation RETRIES a transient throw and recovers (no partial)', async () => {
  let call = 0;
  const generateTextImpl = async () => {
    call++;
    if (call === 1) {
      return {
        text: 'INTERIM: checking the route table.',
        toolCalls: [{ toolName: 'logDigest', input: {} }],
        steps: [{ toolCalls: [{ toolName: 'logDigest', input: {} }], toolResults: [] }],
        response: { messages: [{ role: 'assistant', content: 'interim' }] },
        totalUsage: { inputTokens: 5, outputTokens: 3 },
      };
    }
    if (call === 2) throw new Error('transient upstream 529'); // one blip
    return { text: 'ROOT CAUSE found.', toolCalls: [], steps: [{ toolCalls: [], toolResults: [] }], response: { messages: [] }, totalUsage: { inputTokens: 1, outputTokens: 1 } };
  };
  const r = await runInvestigation({
    model: {}, system: 's', user: 'u',
    tools: { logDigest: { execute: async () => ({ ok: true }) } },
    budget: { maxTurns: 10 },
    onActivity: () => {}, onPhase: () => {},
    generateTextImpl,
  });
  assert.match(r.report, /ROOT CAUSE/); // recovered after the retry
  assert.ok(!r.coverage.partial);
});

test('runInvestigation marks partialReason=error after exhausting retries (H4 + honest label)', async () => {
  let call = 0;
  const generateTextImpl = async () => {
    call++;
    if (call === 1) {
      return {
        text: 'INTERIM: checking the route table.',
        toolCalls: [{ toolName: 'logDigest', input: {} }],
        steps: [{ toolCalls: [{ toolName: 'logDigest', input: {} }], toolResults: [] }],
        response: { messages: [{ role: 'assistant', content: 'interim' }] },
        totalUsage: { inputTokens: 5, outputTokens: 3 },
      };
    }
    throw new Error('persistent upstream 500'); // every retry fails
  };
  const r = await runInvestigation({
    model: {}, system: 's', user: 'u',
    tools: { logDigest: { execute: async () => ({ ok: true }) } },
    budget: { maxTurns: 10 },
    onActivity: () => {}, onPhase: () => {},
    generateTextImpl,
  });
  assert.equal(r.coverage.partial, true);
  assert.equal(r.coverage.partialReason, 'error'); // NOT 'deadline'/timeout
  assert.match(r.report, /INTERIM/); // turn-1 evidence preserved
  assert.match(r.coverage.errorMessage, /500/);
  assert.equal(call, 4); // 1 ok + 3 attempts (initial + 2 retries) on turn 2
});

test('runInvestigation does NOT retry a deadline AbortError and labels it deadline', async () => {
  let call = 0;
  const generateTextImpl = async () => {
    call++;
    const e = new Error('aborted'); e.name = 'AbortError'; throw e;
  };
  const r = await runInvestigation({
    model: {}, system: 's', user: 'u', tools: {},
    budget: { maxTurns: 5 },
    onActivity: () => {}, onPhase: () => {},
    generateTextImpl,
  });
  assert.equal(r.coverage.partial, true);
  assert.equal(r.coverage.partialReason, 'deadline');
  assert.equal(call, 1); // abort is not retried
  assert.match(r.report, /aborted/i);
});

test('runInvestigation passes an abortSignal when a future deadline is set (I1)', async () => {
  let sawSignal = false;
  const generateTextImpl = async (opts) => {
    sawSignal = opts.abortSignal instanceof AbortSignal;
    return {
      text: 'done', toolCalls: [], steps: [{ toolCalls: [], toolResults: [] }],
      response: { messages: [] }, totalUsage: { inputTokens: 1, outputTokens: 1 },
    };
  };
  await runInvestigation({
    model: {}, system: 's', user: 'u', tools: {},
    budget: { maxTurns: 5, deadline: Date.now() + 60_000 },
    onActivity: () => {}, onPhase: () => {},
    generateTextImpl,
  });
  assert.equal(sawSignal, true);
});

test('runInvestigation emits activity with correct label for crgQuery', async () => {
  const activity = [];
  const generateTextImpl = async () => ({
    text: 'done',
    toolCalls: [],
    steps: [{ toolCalls: [{ toolName: 'crgQuery', input: { op: 'callers_of', target: 'myFn' } }], toolResults: [] }],
    response: { messages: [] },
    totalUsage: { inputTokens: 1, outputTokens: 1 },
  });
  await runInvestigation({ model: {}, system: 's', user: 'u', tools: {}, budget: { maxTurns: 5 }, onActivity: (a) => activity.push(a), onPhase: () => {}, generateTextImpl });
  const crg = activity.find((a) => a.tool === 'crgQuery');
  assert.ok(crg);
  assert.match(crg.label, /Querying code graph/);
  assert.match(crg.label, /callers_of/);
});

test('runInvestigation stops and marks partial when deadline exceeded', async () => {
  let call = 0;
  const generateTextImpl = async () => {
    call++;
    return {
      text: '',
      toolCalls: [{ toolName: 'astGrep', input: {} }],
      steps: [{ toolCalls: [{ toolName: 'astGrep', input: {} }], toolResults: [] }],
      response: { messages: [] },
      totalUsage: { inputTokens: 1, outputTokens: 1 },
    };
  };
  // deadline in the past → stops immediately
  const r = await runInvestigation({
    model: {}, system: 's', user: 'u', tools: {},
    budget: { maxTurns: 20, deadline: Date.now() - 1 },
    onActivity: () => {}, onPhase: () => {},
    generateTextImpl,
  });
  assert.equal(r.coverage.partial, true);
  assert.equal(call, 0); // deadline checked before first turn
});
