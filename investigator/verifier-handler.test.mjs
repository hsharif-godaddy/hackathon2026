import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runVerifierHandler, buildSingleEventEmitter } from './verifier-handler.mjs';

test('verifier handler patches the analysis sidecar on judge fail (ran:true pass:false)', async () => {
  const s3Written = {};
  const fakeS3 = {
    getObject: async ({ Key }) => {
      if (Key.endsWith('.md')) return { Body: 'The app crashed.' };
      if (Key.endsWith('.analysis.json')) return { Body: JSON.stringify({ appId: 'app1', verdict: 'agent-bug', verdictConfidence: 'high', verified: false }) };
      return { Body: '{}' };
    },
    putObject: async ({ Key, Body }) => { s3Written[Key] = Body; },
  };
  const fakeJudge = async () => ({ ran: true, pass: false, note: 'evidence thin', score: 0.3 });
  const events = [];
  const fakeEmit = async (type, data) => events.push({ type, data });

  await runVerifierHandler({
    event: { resultKey: 'inv/app1.md', analysisKey: 'inv/app1.analysis.json', appId: 'app1', complaint: 'x', startSeq: 5 },
    s3: fakeS3,
    judgeImpl: fakeJudge,
    emitEvent: fakeEmit,
  });

  // sidecar must have been patched
  assert.ok(s3Written['inv/app1.analysis.json']);
  const patched = JSON.parse(s3Written['inv/app1.analysis.json']);
  assert.equal(patched.verified, true);
  assert.equal(patched.verdictConfidence, 'low'); // downgraded
  assert.match(patched.verifierNote || '', /thin/);

  // must emit a refinement event
  assert.ok(events.some((e) => e.type === 'investigation.verdict_refined'));
});

test('buildSingleEventEmitter writes to the zero-padded startSeq key', async () => {
  const sent = [];
  const fakeS3Client = { send: async (cmd) => { sent.push(cmd.input ?? cmd); } };
  const emit = buildSingleEventEmitter(fakeS3Client, 'bkt', 'inv/app/events/', 'inv-1', 5);
  await emit('investigation.verdict_refined', { verifierPassed: true });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].Key, 'inv/app/events/000005.json');
  assert.equal(sent[0].Bucket, 'bkt');
  const body = JSON.parse(sent[0].Body);
  assert.equal(body.seq, 5);
  assert.equal(body.type, 'investigation.verdict_refined');
});

test('buildSingleEventEmitter returns null without eventsPrefix/startSeq (backward compat)', () => {
  assert.equal(buildSingleEventEmitter({}, 'b', undefined, 'i', 5), null);
  assert.equal(buildSingleEventEmitter({}, 'b', 'p/', 'i', undefined), null);
});

test('buildSingleEventEmitter soft-fails when the S3 put throws', async () => {
  const fakeS3Client = { send: async () => { throw new Error('s3 down'); } };
  const emit = buildSingleEventEmitter(fakeS3Client, 'bkt', 'p/', 'i', 7);
  // Must not reject.
  await emit('investigation.verdict_refined', {});
});

test('verifier handler leaves analysis unchanged when judge ran:false', async () => {
  const s3Written = {};
  const fakeS3 = {
    getObject: async ({ Key }) => {
      if (Key.endsWith('.md')) return { Body: 'report' };
      return { Body: JSON.stringify({ appId: 'app1', verdict: 'no-issue', verdictConfidence: 'medium', verified: false }) };
    },
    putObject: async ({ Key, Body }) => { s3Written[Key] = Body; },
  };
  const fakeJudge = async () => ({ ran: false, pass: null });
  const events = [];
  await runVerifierHandler({
    event: { resultKey: 'k.md', analysisKey: 'k.json', appId: 'app1', complaint: 'x', startSeq: 3 },
    s3: fakeS3, judgeImpl: fakeJudge, emitEvent: async (t, d) => events.push({ t, d }),
  });
  const written = s3Written['k.json'] ? JSON.parse(s3Written['k.json']) : null;
  // When judge ran:false, sidecar is still written with verified:false but confidence unchanged
  if (written) {
    assert.equal(written.verdictConfidence, 'medium');
  }
  // No verdict_refined event (judge didn't run)
  assert.ok(!events.some((e) => e.t === 'investigation.verdict_refined'));
});
