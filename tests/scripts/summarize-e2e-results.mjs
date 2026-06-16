#!/usr/bin/env node
// Aggregate Playwright JSON reports across all shards into one per-suite
// summary, and emit it three ways from a single source of truth:
//
//   1. Slack mrkdwn   -> $GITHUB_OUTPUT `message` (consumed by the slack-notify
//                        job; only sent when something failed)
//   2. Markdown table -> $GITHUB_STEP_SUMMARY (the run page the release
//                        approver clicks through to via "View Run")
//   3. Compact JSON   -> summary.json (uploaded as the `e2e-summary` artifact;
//                        the release-manager downloads + renders it in the
//                        release Slack thread)
//
// Suite grouping is by Playwright `projectName` ("e2e" / "regression"), which
// is authoritative regardless of how the matrix sharded the work. host-paas is
// an external reusable workflow with no per-test data, so it is reported
// pass/fail only from its job conclusion (HOSTPAAS_RESULT).
//
// This script is deliberately dependency-free (Node built-ins only) and
// defensive: it never exits non-zero, so a parsing hiccup degrades the report
// rather than turning the summarize job red. When a test job reported failure
// but produced no parseable per-test results (a shard that crashed during
// setup), it says so explicitly instead of implying "0 failures".
//
// Env inputs (all optional; sensible defaults for local runs):
//   RESULTS_DIR        dir holding downloaded `test-results-*` artifacts
//   TEST_RESULT        needs.test.result        (success|failure|cancelled|skipped)
//   MERGE_RESULT       needs.merge-reports.result
//   HOSTPAAS_RESULT    needs.host-paas-e2e.result
//   ENVIRONMENT        prod|test|...
//   TRIGGER            human-readable trigger label
//   ACTOR              github.actor
//   RUN_URL            link to the workflow run
//   SUMMARY_JSON_OUT   path to write summary.json (default e2e-summary/summary.json)
//   GITHUB_OUTPUT      set by Actions; receives `message` + `notify`
//   GITHUB_STEP_SUMMARY set by Actions; receives the markdown table

import {
  readFileSync,
  readdirSync,
  writeFileSync,
  appendFileSync,
  mkdirSync,
  statSync,
} from 'node:fs';
import { join, dirname } from 'node:path';

const RESULTS_DIR = process.env.RESULTS_DIR || 'downloaded-results';
const TEST_RESULT = process.env.TEST_RESULT || '';
const MERGE_RESULT = process.env.MERGE_RESULT || '';
const HOSTPAAS_RESULT = process.env.HOSTPAAS_RESULT || '';
const ENVIRONMENT = process.env.ENVIRONMENT || 'unknown';
const TRIGGER = process.env.TRIGGER || '';
const ACTOR = process.env.ACTOR || '';
const RUN_URL = process.env.RUN_URL || '';
const SUMMARY_JSON_OUT = process.env.SUMMARY_JSON_OUT || 'e2e-summary/summary.json';
const MAX_FAILED_NAMES = 10;

// Display labels + a stable display order for known projects.
const SUITE_LABELS = { e2e: 'AAB e2e', 'e2e-v2': 'AAB e2e-v2', regression: 'AAB regression' };
const SUITE_ORDER = { e2e: 0, 'e2e-v2': 1, regression: 2 };

const labelFor = (key) => SUITE_LABELS[key] || `AAB ${key}`;

/** Recursively collect file paths under dir whose basename matches `results*.json`. */
function findResultFiles(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out; // dir absent (e.g. no artifacts downloaded) — handled by caller
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...findResultFiles(full));
    } else if (/^results.*\.json$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/** Pull the shard number out of an artifact path like `.../test-results-regression-shard-6/...`. */
function shardFromPath(p) {
  const m = p.match(/-shard-(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

/**
 * Walk a Playwright JSON report, invoking cb({ projectName, status, file, title })
 * for every test result. Playwright nests `suites` arbitrarily deep; each spec
 * carries a `file` and `title`, and each of its `tests` carries `projectName`
 * and a rolled-up `status` (expected|unexpected|flaky|skipped).
 */
function walkReport(report, cb) {
  const visit = (suites, fileFallback) => {
    for (const suite of suites || []) {
      const file = suite.file || fileFallback || '';
      for (const spec of suite.specs || []) {
        for (const test of spec.tests || []) {
          cb({
            projectName: test.projectName || 'unknown',
            status: test.status || 'unknown',
            file: spec.file || file,
            title: spec.title || '(untitled)',
          });
        }
      }
      if (suite.suites) visit(suite.suites, file);
    }
  };
  visit(report.suites, '');
}

/** Aggregate every result file into per-suite tallies keyed by projectName. */
function aggregate(files) {
  const suites = new Map(); // key -> { total, passed, failed, skipped, failedTests[], failedShards:Set, shards:Set }
  const getSuite = (key) => {
    let s = suites.get(key);
    if (!s) {
      s = { key, total: 0, passed: 0, failed: 0, skipped: 0, failedTests: [], failedShards: new Set(), shards: new Set() };
      suites.set(key, s);
    }
    return s;
  };

  for (const file of files) {
    const shard = shardFromPath(file);
    let report;
    try {
      report = JSON.parse(readFileSync(file, 'utf8'));
    } catch (err) {
      console.error(`summarize: skipping unreadable report ${file}: ${err.message}`);
      continue;
    }
    walkReport(report, ({ projectName, status, file: specFile, title }) => {
      const s = getSuite(projectName);
      s.total += 1;
      if (shard != null) s.shards.add(shard);
      if (status === 'skipped') {
        s.skipped += 1;
      } else if (status === 'unexpected') {
        s.failed += 1;
        s.failedTests.push(`${specFile} › ${title}`);
        if (shard != null) s.failedShards.add(shard);
      } else {
        // expected + flaky both ended green.
        s.passed += 1;
      }
    });
  }

  return [...suites.values()].sort(
    (a, b) => (SUITE_ORDER[a.key] ?? 99) - (SUITE_ORDER[b.key] ?? 99) || a.key.localeCompare(b.key),
  );
}

/** host-paas ran when its job concluded success/failure/cancelled (not skipped/empty). */
function hostPaasInfo() {
  const r = HOSTPAAS_RESULT;
  if (r === 'success') return { present: true, status: 'passed' };
  if (r === 'failure' || r === 'cancelled') return { present: true, status: 'failed' };
  return { present: false, status: r || 'skipped' };
}

function buildModel() {
  const suiteRows = aggregate(findResultFiles(RESULTS_DIR));
  const hostPaas = hostPaasInfo();

  const totalFailed = suiteRows.reduce((n, s) => n + s.failed, 0);
  const totalParsed = suiteRows.reduce((n, s) => n + s.total, 0);

  // A test job that failed without producing any parseable results is an
  // infra/setup crash (e.g. SSO throttle before the first test ran).
  const infraFailure = TEST_RESULT === 'failure' && totalParsed === 0;

  const failed =
    TEST_RESULT === 'failure' ||
    MERGE_RESULT === 'failure' ||
    hostPaas.status === 'failed' ||
    totalFailed > 0;

  const suites = suiteRows.map((s) => {
    const multiShard = s.shards.size > 1 || (s.failedShards.size > 0 && Math.max(0, ...s.shards) > 1);
    const failedTests = s.failedTests.slice(0, MAX_FAILED_NAMES);
    return {
      key: s.key,
      label: labelFor(s.key),
      status: s.failed > 0 ? 'failed' : 'passed',
      total: s.total,
      passed: s.passed,
      failed: s.failed,
      skipped: s.skipped,
      failedShards: multiShard ? [...s.failedShards].sort((a, b) => a - b) : [],
      failedTests,
      failedTestsOverflow: Math.max(0, s.failedTests.length - failedTests.length),
    };
  });

  return {
    environment: ENVIRONMENT,
    overall: failed ? 'failure' : 'success',
    testJobResult: TEST_RESULT,
    mergeResult: MERGE_RESULT,
    hostPaasResult: HOSTPAAS_RESULT,
    infraFailure,
    suites,
    hostPaas,
  };
}

function countsText(s) {
  if (s.failed > 0) {
    return `${s.failed} failed, ${s.passed} passed, ${s.skipped} skipped (${s.total} total)`;
  }
  const skip = s.skipped > 0 ? `, ${s.skipped} skipped` : '';
  return `${s.passed} passed${skip} (${s.total} total)`;
}

/** Slack mrkdwn body (single-asterisk bold, :emoji: codes). */
function slackMessage(model) {
  const lines = [];
  if (ENVIRONMENT) lines.push(`*Environment:* ${ENVIRONMENT}`);
  if (TRIGGER) lines.push(`*Trigger:* ${TRIGGER}`);
  if (ACTOR) lines.push(`*Actor:* ${ACTOR}`);
  lines.push('');
  lines.push('*Suite results:*');

  if (model.infraFailure && model.suites.length === 0) {
    lines.push(':x: E2E — run failed before tests produced results (setup/infra)');
  }

  for (const s of model.suites) {
    const emoji = s.status === 'failed' ? ':x:' : ':white_check_mark:';
    let line = `${emoji} ${s.label} — ${countsText(s)}`;
    if (s.failedShards.length > 0) {
      line += ` · failed shard(s): ${s.failedShards.join(', ')}`;
    }
    lines.push(line);
    for (const t of s.failedTests) lines.push(`    • ${t}`);
    if (s.failedTestsOverflow > 0) lines.push(`    • …and ${s.failedTestsOverflow} more`);
  }

  if (model.hostPaas.present) {
    const emoji = model.hostPaas.status === 'failed' ? ':x:' : ':white_check_mark:';
    lines.push(`${emoji} Host-PaaS e2e — ${model.hostPaas.status}`);
  }

  if (TEST_RESULT === 'failure' && !model.infraFailure && model.suites.every((s) => s.failed === 0)) {
    lines.push('');
    lines.push('_Test job reported failure but no failing tests were parsed — a shard may have failed during setup; check the run._');
  }

  if (RUN_URL) {
    lines.push('');
    lines.push(`*Run:* <${RUN_URL}|View Details>`);
  }
  return lines.join('\n');
}

/** GitHub Actions step-summary markdown (rendered on the run page). */
function stepSummary(model) {
  const u = (status) => (status === 'failed' ? '❌' : '✅');
  const lines = [];
  lines.push(`## E2E Test Summary — ${model.environment}`);
  lines.push('');
  lines.push('| Suite | Result | Failed | Passed | Skipped | Total |');
  lines.push('| --- | :---: | ---: | ---: | ---: | ---: |');
  for (const s of model.suites) {
    lines.push(`| ${s.label} | ${u(s.status)} | ${s.failed} | ${s.passed} | ${s.skipped} | ${s.total} |`);
  }
  if (model.hostPaas.present) {
    lines.push(`| Host-PaaS e2e | ${u(model.hostPaas.status)} | — | — | — | — |`);
  }
  lines.push('');

  if (model.infraFailure && model.suites.length === 0) {
    lines.push('> ⚠️ The test job failed before any tests produced results (setup/infra failure).');
    lines.push('');
  }

  const withFailures = model.suites.filter((s) => s.failedTests.length > 0);
  if (withFailures.length > 0) {
    lines.push('**Failed tests**');
    lines.push('');
    for (const s of withFailures) {
      const shardNote = s.failedShards.length > 0 ? ` (shard ${s.failedShards.join(', ')})` : '';
      for (const t of s.failedTests) lines.push(`- ${s.label}${shardNote}: ${t}`);
      if (s.failedTestsOverflow > 0) lines.push(`- ${s.label}: …and ${s.failedTestsOverflow} more`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

function writeGithubOutput(model, message) {
  const out = process.env.GITHUB_OUTPUT;
  if (!out) return;
  const delim = 'E2E_SUMMARY_MSG_EOF';
  let block = `notify=${model.overall === 'failure' ? 'true' : 'false'}\n`;
  block += `overall=${model.overall}\n`;
  block += `message<<${delim}\n${message}\n${delim}\n`;
  appendFileSync(out, block);
}

function writeStepSummary(md) {
  const out = process.env.GITHUB_STEP_SUMMARY;
  if (!out) return;
  appendFileSync(out, md + '\n');
}

function writeSummaryJson(model) {
  try {
    mkdirSync(dirname(SUMMARY_JSON_OUT), { recursive: true });
    writeFileSync(SUMMARY_JSON_OUT, JSON.stringify(model, null, 2));
  } catch (err) {
    console.error(`summarize: could not write ${SUMMARY_JSON_OUT}: ${err.message}`);
  }
}

function main() {
  // Surface what we found so the job log is self-explanatory.
  try {
    statSync(RESULTS_DIR);
  } catch {
    console.error(`summarize: results dir ${RESULTS_DIR} not found — emitting an empty/infra summary`);
  }

  const model = buildModel();
  const message = slackMessage(model);
  const md = stepSummary(model);

  console.log(message);
  writeGithubOutput(model, message);
  writeStepSummary(md);
  writeSummaryJson(model);
}

// Never let a reporting hiccup fail the job.
try {
  main();
} catch (err) {
  console.error(`summarize: unexpected error: ${err && err.stack ? err.stack : err}`);
  const out = process.env.GITHUB_OUTPUT;
  if (out) {
    appendFileSync(out, `notify=true\noverall=failure\nmessage<<E2E_SUMMARY_MSG_EOF\n:warning: E2E summary could not be generated — check the run.\nE2E_SUMMARY_MSG_EOF\n`);
  }
  // Keep the e2e-summary artifact honest even on a total failure, so the
  // release-manager renders an explicit infra note rather than silently
  // showing nothing.
  try {
    mkdirSync(dirname(SUMMARY_JSON_OUT), { recursive: true });
    writeFileSync(
      SUMMARY_JSON_OUT,
      JSON.stringify(
        {
          environment: ENVIRONMENT,
          overall: 'failure',
          testJobResult: TEST_RESULT,
          mergeResult: MERGE_RESULT,
          hostPaasResult: HOSTPAAS_RESULT,
          infraFailure: true,
          suites: [],
          hostPaas: hostPaasInfo(),
        },
        null,
        2,
      ),
    );
  } catch (e) {
    console.error(`summarize: could not write fallback ${SUMMARY_JSON_OUT}: ${e.message}`);
  }
}
