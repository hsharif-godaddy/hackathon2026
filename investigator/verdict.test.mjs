import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VERDICT_SCHEMA, synthesizeVerdict, preResolveCitations, quoteMatchesTemplate } from './verdict.mjs';

const VALID_AGENT_BUG = {
  v: 1, sentiment: 'negative', confidence: 0.8, rootCause: 'The agent omitted a route registration',
  category: 'missing-route', verdict: 'agent-bug', relatesTo: 'app-code',
  verdictConfidence: 'high', verdictRationale: 'Log template + code location cited',
  fixKind: 'app-prompt', fixPrompt: 'Add the route in src/routes.tsx', engNote: null,
};

test('VERDICT_SCHEMA accepts a well-formed agent-bug verdict', () => {
  const r = VERDICT_SCHEMA.safeParse(VALID_AGENT_BUG);
  assert.equal(r.success, true);
});

test('VERDICT_SCHEMA rejects an unknown verdict enum', () => {
  const r = VERDICT_SCHEMA.safeParse({ ...VALID_AGENT_BUG, verdict: 'made-up-verdict' });
  assert.equal(r.success, false);
});

test('VERDICT_SCHEMA rejects fixPrompt non-null when fixKind is not app-prompt', () => {
  const r = VERDICT_SCHEMA.safeParse({ ...VALID_AGENT_BUG, fixKind: 'none', fixPrompt: 'oops' });
  assert.equal(r.success, false);
});

test('VERDICT_SCHEMA rejects engNote non-null when verdict is not platform-bug', () => {
  const r = VERDICT_SCHEMA.safeParse({ ...VALID_AGENT_BUG, engNote: 'some note' });
  assert.equal(r.success, false);
});

test('VERDICT_SCHEMA accepts a valid platform-bug verdict with engNote', () => {
  const r = VERDICT_SCHEMA.safeParse({
    v: 1, sentiment: 'negative', confidence: 0.9, rootCause: 'publish container OOM',
    category: 'publish-failure', verdict: 'platform-bug', relatesTo: 'publish-pipeline',
    verdictConfidence: 'medium', verdictRationale: 'OOM log confirmed',
    fixKind: 'eng-note', fixPrompt: null, engNote: 'publish service: OOM on large assets',
  });
  assert.equal(r.success, true);
});

test('synthesizeVerdict returns the model output when generateTextImpl returns valid JSON', async () => {
  const fakeImpl = async () => ({ text: JSON.stringify(VALID_AGENT_BUG) });
  const r = await synthesizeVerdict({ model: {}, system: 's', report: 'r', generateTextImpl: fakeImpl });
  assert.equal(r.verdict, 'agent-bug');
});

test('synthesizeVerdict retries once on parse error then returns benign fallback', async () => {
  let calls = 0;
  const fakeImpl = async () => {
    calls++;
    return { text: 'not json at all' };
  };
  const r = await synthesizeVerdict({ model: {}, system: 's', report: 'r', generateTextImpl: fakeImpl });
  assert.equal(r.verdict, 'no-issue');
  assert.equal(r.verdictConfidence, 'low');
  assert.ok(calls <= 2);
});

test('preResolveCitations returns verdict unchanged when no dangling citations', async () => {
  const logIndex = { templates: [{ template: 'request from <:IP:> took <:NUM:> ms' }] };
  const { verdict: v, dangling } = await preResolveCitations(VALID_AGENT_BUG, 'no log citations here', { logIndex });
  assert.equal(dangling.length, 0);
  assert.equal(v.verdictConfidence, VALID_AGENT_BUG.verdictConfidence);
});

test('quoteMatchesTemplate matches a quote covered by a Drain-wildcarded template (H2)', () => {
  // Template was generalized by Drain at the status position (`<:*:>`).
  const templates = ['POST /checkout <:*:> error fatal'];
  // The model quoted the raw line; LogMasker turned 500 into <:NUM:>.
  assert.equal(quoteMatchesTemplate('POST /checkout <:NUM:> error', templates), true);
});

test('quoteMatchesTemplate rejects a quote no template covers', () => {
  assert.equal(quoteMatchesTemplate('GET /nope <:NUM:> denied', ['POST /checkout <:*:> error fatal']), false);
});

test('preResolveCitations does NOT flag a citation that matches via a Drain wildcard (H2)', async () => {
  // Regression for the false-positive dangling flag: a well-grounded citation
  // against a wildcarded template must resolve, leaving confidence untouched.
  const logIndex = { templates: [{ template: 'POST /checkout <:*:> error fatal' }] };
  const report = 'Root cause: `POST /checkout 500 error fatal` on every request.';
  const { verdict: v, dangling } = await preResolveCitations(
    { ...VALID_AGENT_BUG, verdictConfidence: 'high' },
    report,
    { logIndex },
  );
  assert.equal(dangling.length, 0);
  assert.equal(v.verdictConfidence, 'high');
});

test('preResolveCitations downgrades confidence when a log-template citation does not resolve', async () => {
  const logIndex = { templates: [{ template: 'memory: snapshot' }] };
  const report = 'Root cause: `<:IP:> error fatal missing route`.';
  const { verdict: v, dangling } = await preResolveCitations(
    { ...VALID_AGENT_BUG, verdictConfidence: 'high' },
    report,
    { logIndex },
  );
  assert.ok(dangling.length >= 1);
  assert.notEqual(v.verdictConfidence, 'high'); // downgraded
});
