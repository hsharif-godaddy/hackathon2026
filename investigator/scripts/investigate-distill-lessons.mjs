#!/usr/bin/env node
//
// Distill the investigator lessons inbox into proposed knowledge-base entries.
//
// The DISTILL half of the feedback loop (capture half: ../lessons.mjs). Reads
// every candidate lesson under `s3://$STATE_BUCKET/lessons/`, groups them by
// (verdict · relatesTo · category), and prints proposed entries in the
// references/aab-behaviors.md schema plus the supporting evidence. A human
// reviews the output and appends the worthwhile entries via PR — the agent
// never edits its own knowledge base (that gate prevents memory poisoning).
//
// This is an OPS tool, not part of the Lambda image. Run it locally with AWS
// creds for the investigation account:
//
//   STATE_BUCKET=airo-investigations-dev \
//   node investigator/scripts/investigate-distill-lessons.mjs [--since 2026-06-01]
//
// Read-only against S3. Prints to stdout. Exit 0 even on an empty inbox.

import { S3Client, ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3';
import { LESSONS_PREFIX } from '../lessons.mjs';

const STATE_BUCKET = process.env.STATE_BUCKET;
const REGION = process.env.AWS_REGION || process.env.REGION || 'us-west-2';

if (!STATE_BUCKET) {
  console.error('STATE_BUCKET env var is required (e.g. airo-investigations-dev).');
  process.exit(2);
}

// Optional `--since YYYY-MM-DD` narrows the date-partitioned scan.
function parseSince(argv) {
  const i = argv.indexOf('--since');
  if (i >= 0 && argv[i + 1] && /^\d{4}-\d{2}-\d{2}$/.test(argv[i + 1])) return argv[i + 1];
  return null;
}

const since = parseSince(process.argv.slice(2));
const s3 = new S3Client({ region: REGION });

async function listKeys() {
  const keys = [];
  let token;
  do {
    const out = await s3.send(
      new ListObjectsV2Command({ Bucket: STATE_BUCKET, Prefix: LESSONS_PREFIX, ContinuationToken: token }),
    );
    for (const obj of out.Contents || []) {
      if (!obj.Key || !obj.Key.endsWith('.json')) continue;
      if (since) {
        // Key shape: lessons/YYYY-MM-DD/<id>.<source>.json
        const day = obj.Key.slice(LESSONS_PREFIX.length, LESSONS_PREFIX.length + 10);
        if (day < since) continue;
      }
      keys.push(obj.Key);
    }
    token = out.IsTruncated ? out.NextContinuationToken : undefined;
  } while (token);
  return keys;
}

async function readJson(key) {
  const out = await s3.send(new GetObjectCommand({ Bucket: STATE_BUCKET, Key: key }));
  const text = await out.Body.transformToString();
  return JSON.parse(text);
}

function groupKey(rec) {
  return `${rec.verdict || '?'} · ${rec.relatesTo || '?'} · ${rec.category || '?'}`;
}

async function main() {
  const keys = await listKeys();
  if (keys.length === 0) {
    console.log(`No lessons under s3://${STATE_BUCKET}/${LESSONS_PREFIX}${since ? ` since ${since}` : ''}.`);
    return;
  }

  const records = [];
  for (const key of keys) {
    try {
      records.push(await readJson(key));
    } catch (err) {
      console.error(`! skip ${key}: ${err && err.message ? err.message : err}`);
    }
  }

  const groups = new Map();
  for (const rec of records) {
    const g = groupKey(rec);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(rec);
  }

  // Most-frequent clusters first — those are the highest-value lessons.
  const ordered = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);

  console.log(`# Proposed aab-behaviors.md entries`);
  console.log(`#`);
  console.log(`# ${records.length} candidate lesson(s) across ${ordered.length} cluster(s).`);
  console.log(`# Review each, then append the worthwhile ones to`);
  console.log(`# investigator/skills/airo-log-investigate/references/aab-behaviors.md via PR.`);
  console.log(`# The agent never edits that file itself.\n`);

  for (const [g, recs] of ordered) {
    const notes = recs
      .map((r) => r.verifierNote || r.operatorNote)
      .filter(Boolean);
    const sources = [...new Set(recs.map((r) => r.source))].join(', ');
    const apps = [...new Set(recs.map((r) => r.appId))].slice(0, 5);
    const ids = recs.map((r) => r.investigationId).slice(0, 5);

    console.log(`## Cluster: ${g}  (${recs.length}× · ${sources})`);
    console.log(`Apps: ${apps.join(', ')}${recs.length > apps.length ? ' …' : ''}`);
    console.log(`Investigations: ${ids.join(', ')}${recs.length > ids.length ? ' …' : ''}`);
    if (notes.length) {
      console.log(`Why flagged:`);
      for (const n of [...new Set(notes)].slice(0, 5)) console.log(`  - ${n}`);
    }
    const example = recs[0];
    console.log(`\nProposed entry (edit before merging):\n`);
    console.log('```');
    console.log(`### <name the by-design behavior>`);
    console.log(`- **Looks like:** ${example.rootCause || '<symptom seen in the report/logs>'}`);
    console.log(`- **Actually:** <the by-design behavior — confirm against code before merging>`);
    console.log(`- **Real bug if:** <the signal that means it IS a defect>`);
    console.log(`- **Verdict:** by-design | customer-error | platform-bug-if-<condition>`);
    console.log(`- **Source:** <repo path proving the convention>`);
    console.log('```\n');
  }
}

main().catch((err) => {
  console.error('distill failed:', err && err.message ? err.message : err);
  process.exit(1);
});
