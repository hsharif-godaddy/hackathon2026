import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildLessonRecord, lessonKey, LESSONS_PREFIX } from './lessons.mjs';

describe('buildLessonRecord', () => {
  const base = {
    investigationId: 'inv-2026-06-03-abc',
    appId: 't1ilkvwm8o',
    customerId: 'cust-1',
    ts: '2026-06-03T05:26:46.000Z',
  };

  it('pulls verdict fields off the analysis sidecar (verifier source)', () => {
    const rec = buildLessonRecord({
      ...base,
      source: 'verifier',
      analysis: {
        verdict: 'agent-bug',
        relatesTo: 'preview-build',
        category: 'route-missing',
        rootCause: 'links to /schedule but route not registered',
        verdictRationale: 'high confidence customer-error',
      },
      verifierNote: 'over-claimed: customer never requested /schedule',
      score: 0.4,
      feedback: 'no feedback given',
      timeWindow: '24h',
    });
    assert.equal(rec.v, 1);
    assert.equal(rec.source, 'verifier');
    assert.equal(rec.verdict, 'agent-bug');
    assert.equal(rec.relatesTo, 'preview-build');
    assert.equal(rec.category, 'route-missing');
    assert.equal(rec.rootCause, 'links to /schedule but route not registered');
    assert.equal(rec.verifierNote, 'over-claimed: customer never requested /schedule');
    assert.equal(rec.score, 0.4);
    assert.equal(rec.operatorNote, null);
    assert.equal(rec.feedback, 'no feedback given');
  });

  it('supports an operator-sourced lesson with a free-text note', () => {
    const rec = buildLessonRecord({
      ...base,
      source: 'operator',
      analysis: { verdict: 'agent-bug', relatesTo: 'routing' },
      operatorNote: 'false positive — pages are built on demand',
    });
    assert.equal(rec.source, 'operator');
    assert.equal(rec.operatorNote, 'false positive — pages are built on demand');
    assert.equal(rec.verifierNote, null);
    assert.equal(rec.score, null);
  });

  it('coerces missing / wrong-typed fields to null (never undefined)', () => {
    const rec = buildLessonRecord({ ...base, source: 'operator', analysis: null });
    assert.equal(rec.verdict, null);
    assert.equal(rec.relatesTo, null);
    assert.equal(rec.rootCause, null);
    assert.equal(rec.score, null);
    assert.equal(rec.feedback, null);
    // No undefined values survive (clean JSON).
    for (const value of Object.values(rec)) assert.notEqual(value, undefined);
  });

  it('drops a non-finite score', () => {
    const rec = buildLessonRecord({ ...base, source: 'verifier', analysis: {}, score: Number.NaN });
    assert.equal(rec.score, null);
  });
});

describe('lessonKey', () => {
  it('date-partitions and is unique per (investigation, source)', () => {
    const key = lessonKey({ ts: '2026-06-03T05:26:46.000Z', investigationId: 'inv-x', source: 'verifier' });
    assert.equal(key, `${LESSONS_PREFIX}2026-06-03/inv-x.verifier.json`);
  });

  it('separates operator and verifier captures of the same run', () => {
    const ts = '2026-06-03T05:26:46.000Z';
    const a = lessonKey({ ts, investigationId: 'inv-x', source: 'verifier' });
    const b = lessonKey({ ts, investigationId: 'inv-x', source: 'operator' });
    assert.notEqual(a, b);
  });
});
