import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseJiraEligibilityConfig,
  shouldCreateJiraTicket,
  DEFAULT_JIRA_ELIGIBILITY,
} from './jira-eligibility.mjs';

const DEFAULT = {
  issue: false,
  support: false,
  feedback: { enabled: true, maxRating: 7 },
};

// ---- parseJiraEligibilityConfig: fallback paths ----

await test('parse: null/undefined/empty → default', () => {
  assert.deepEqual(parseJiraEligibilityConfig(null), DEFAULT);
  assert.deepEqual(parseJiraEligibilityConfig(undefined), DEFAULT);
  assert.deepEqual(parseJiraEligibilityConfig(''), DEFAULT);
});

await test('parse: non-string raw → default', () => {
  assert.deepEqual(parseJiraEligibilityConfig(42), DEFAULT);
  assert.deepEqual(parseJiraEligibilityConfig({ issue: true }), DEFAULT);
});

await test('parse: malformed JSON → default', () => {
  assert.deepEqual(parseJiraEligibilityConfig('{not json'), DEFAULT);
  assert.deepEqual(parseJiraEligibilityConfig('undefined'), DEFAULT);
});

await test('parse: non-object JSON (array / number / string / null) → default', () => {
  assert.deepEqual(parseJiraEligibilityConfig('[1,2,3]'), DEFAULT);
  assert.deepEqual(parseJiraEligibilityConfig('7'), DEFAULT);
  assert.deepEqual(parseJiraEligibilityConfig('"x"'), DEFAULT);
  assert.deepEqual(parseJiraEligibilityConfig('null'), DEFAULT);
});

// ---- parseJiraEligibilityConfig: happy + partial ----

await test('parse: full config respected', () => {
  const raw = JSON.stringify({ issue: true, support: true, feedback: { enabled: false, maxRating: 5 } });
  assert.deepEqual(parseJiraEligibilityConfig(raw), {
    issue: true,
    support: true,
    feedback: { enabled: false, maxRating: 5 },
  });
});

await test('parse: partial config merges per-field with defaults', () => {
  // Only issue provided → support + feedback fall back to default.
  assert.deepEqual(parseJiraEligibilityConfig(JSON.stringify({ issue: true })), {
    issue: true,
    support: false,
    feedback: { enabled: true, maxRating: 7 },
  });
  // feedback present but missing maxRating → maxRating default 7.
  assert.deepEqual(parseJiraEligibilityConfig(JSON.stringify({ feedback: { enabled: true } })), {
    issue: false,
    support: false,
    feedback: { enabled: true, maxRating: 7 },
  });
  // feedback missing enabled → enabled default true.
  assert.deepEqual(parseJiraEligibilityConfig(JSON.stringify({ feedback: { maxRating: 3 } })), {
    issue: false,
    support: false,
    feedback: { enabled: true, maxRating: 3 },
  });
});

await test('parse: wrong-typed fields fall back per-field', () => {
  // issue as string, feedback as array, maxRating as string → all defaulted.
  const raw = JSON.stringify({ issue: 'yes', support: 1, feedback: ['x'] });
  assert.deepEqual(parseJiraEligibilityConfig(raw), DEFAULT);
  // maxRating non-finite (null) → default 7.
  const raw2 = JSON.stringify({ feedback: { enabled: true, maxRating: null } });
  assert.equal(parseJiraEligibilityConfig(raw2).feedback.maxRating, 7);
});

await test('parse: maxRating 0 is a valid finite threshold (not treated as missing)', () => {
  const raw = JSON.stringify({ feedback: { enabled: true, maxRating: 0 } });
  assert.equal(parseJiraEligibilityConfig(raw).feedback.maxRating, 0);
});

await test('DEFAULT_JIRA_ELIGIBILITY is frozen and matches baseline', () => {
  assert.deepEqual(
    { issue: DEFAULT_JIRA_ELIGIBILITY.issue, support: DEFAULT_JIRA_ELIGIBILITY.support, feedback: { ...DEFAULT_JIRA_ELIGIBILITY.feedback } },
    DEFAULT,
  );
  assert.ok(Object.isFrozen(DEFAULT_JIRA_ELIGIBILITY));
});

// ---- shouldCreateJiraTicket: default config (no stamp) ----

await test('gate (default): issue → false (Bug auto-filing OFF by default)', () => {
  assert.equal(shouldCreateJiraTicket({ feedback_category: 'issue' }), false);
});

await test('gate (default): support → false (SOS auto-filing OFF by default)', () => {
  assert.equal(shouldCreateJiraTicket({ feedback_category: 'support' }), false);
});

await test('gate (default): feedback rating < 7 → true', () => {
  assert.equal(shouldCreateJiraTicket({ feedback_category: 'feedback', rating: 0 }), true);
  assert.equal(shouldCreateJiraTicket({ feedback_category: 'feedback', rating: 6 }), true);
});

await test('gate (default): feedback rating boundary 7 → false', () => {
  assert.equal(shouldCreateJiraTicket({ feedback_category: 'feedback', rating: 7 }), false);
});

await test('gate (default): feedback rating null/undefined → false', () => {
  assert.equal(shouldCreateJiraTicket({ feedback_category: 'feedback', rating: null }), false);
  assert.equal(shouldCreateJiraTicket({ feedback_category: 'feedback' }), false);
});

await test('gate (default): unknown category → false', () => {
  assert.equal(shouldCreateJiraTicket({ feedback_category: 'wat', rating: 1 }), false);
  assert.equal(shouldCreateJiraTicket({ feedback_category: null, rating: 1 }), false);
});

// ---- shouldCreateJiraTicket: config-driven (re-enable / retune) ----

await test('gate (config): issue enabled → true', () => {
  const cfg = JSON.stringify({ issue: true });
  assert.equal(shouldCreateJiraTicket({ feedback_category: 'issue', jira_eligibility_config: cfg }), true);
});

await test('gate (config): support enabled → true', () => {
  const cfg = JSON.stringify({ support: true });
  assert.equal(shouldCreateJiraTicket({ feedback_category: 'support', jira_eligibility_config: cfg }), true);
});

await test('gate (config): feedback disabled → false even when rating below threshold', () => {
  const cfg = JSON.stringify({ feedback: { enabled: false, maxRating: 7 } });
  assert.equal(shouldCreateJiraTicket({ feedback_category: 'feedback', rating: 2, jira_eligibility_config: cfg }), false);
});

await test('gate (config): custom maxRating retunes the strict-less-than threshold', () => {
  const cfg = JSON.stringify({ feedback: { enabled: true, maxRating: 5 } });
  assert.equal(shouldCreateJiraTicket({ feedback_category: 'feedback', rating: 4, jira_eligibility_config: cfg }), true);
  assert.equal(shouldCreateJiraTicket({ feedback_category: 'feedback', rating: 5, jira_eligibility_config: cfg }), false);
});

await test('gate (config): malformed stamp falls back to default behavior', () => {
  // Malformed config → default: issue OFF, feedback<7 ON.
  assert.equal(shouldCreateJiraTicket({ feedback_category: 'issue', jira_eligibility_config: '{bad' }), false);
  assert.equal(shouldCreateJiraTicket({ feedback_category: 'feedback', rating: 3, jira_eligibility_config: '{bad' }), true);
});

// ---- parse: feedback sub-object edge cases ----

await test('parse: feedback null → default feedback block', () => {
  assert.deepEqual(parseJiraEligibilityConfig(JSON.stringify({ feedback: null })), DEFAULT);
});

await test('parse: feedback non-object (string) → default feedback block', () => {
  assert.deepEqual(parseJiraEligibilityConfig(JSON.stringify({ feedback: 'off' })), DEFAULT);
});

await test('parse: feedback.enabled wrong type defaults, maxRating kept (per-field, no cross-pollution)', () => {
  assert.deepEqual(
    parseJiraEligibilityConfig(JSON.stringify({ feedback: { enabled: 'no', maxRating: 4 } })),
    { issue: false, support: false, feedback: { enabled: true, maxRating: 4 } },
  );
});

await test('parse: unknown keys ignored, output unchanged (typo silently defaults)', () => {
  // `enbaled` typo → enabled stays default true; output equals default.
  assert.deepEqual(parseJiraEligibilityConfig(JSON.stringify({ feedback: { enbaled: false } })), DEFAULT);
  // Unknown top-level key ignored.
  assert.deepEqual(parseJiraEligibilityConfig(JSON.stringify({ isseu: true })), DEFAULT);
});
