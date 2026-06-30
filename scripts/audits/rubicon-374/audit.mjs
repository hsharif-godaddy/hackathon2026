#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const USER_AGENT = 'airo-rubicon-374-audit/1.0';
const DEFAULT_INPUT = path.join(os.homedir(), 'Downloads', 'rubicon-374-2026-06-29.csv');

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      out[key] = true;
    } else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else { inQuotes = false; }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c === '\r') { /* skip */ }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  const headers = rows.shift().map(h => h.trim());
  return rows
    .filter(r => r.length >= headers.length)
    .map(r => {
      const obj = {};
      headers.forEach((h, i) => { obj[h] = (r[i] ?? '').trim(); });
      return obj;
    });
}

function isTrue(v) {
  if (!v) return false;
  const s = String(v).toLowerCase();
  return s === 'true' || s === '1' || s === 'y' || s === 'yes' || s === 't';
}

function ensureUrl(s) {
  return /^https?:\/\//i.test(s) ? s : `https://${s}`;
}

function hostOf(publishUrl) {
  return publishUrl.replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
}

function categoryOf(publishUrl) {
  return /\.airoapp\.ai$/i.test(hostOf(publishUrl)) ? 'platform' : 'custom';
}

async function probe(row, timeoutMs) {
  const robotsUrl = new URL('/robots.txt', ensureUrl(row.publish_url)).toString();
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  const category = categoryOf(row.publish_url);
  const base = { app_id: row.app_id, customer_id: row.customer_id, publish_url: row.publish_url, category };
  try {
    const res = await fetch(robotsUrl, {
      headers: { 'User-Agent': USER_AGENT },
      signal: controller.signal,
      redirect: 'follow',
    });
    clearTimeout(t);
    if (!res.ok) return { ...base, verdict: 'inconclusive', reason: `http_${res.status}` };
    const body = await res.text();
    const hasDisallow = /^\s*Disallow:\s*\/\s*$/im.test(body);
    const hasAllow = /^\s*Allow:\s*\/\s*$/im.test(body);
    if (category === 'platform') {
      if (hasDisallow) return { ...base, verdict: 'correctlyDisallowed', reason: 'disallow_root' };
      if (hasAllow) return { ...base, verdict: 'incorrectlyAllowed', reason: 'allow_root_no_disallow' };
      return { ...base, verdict: 'inconclusive', reason: 'no_root_directive' };
    }
    if (hasAllow) return { ...base, verdict: 'correctlyAllowed', reason: 'allow_root' };
    if (hasDisallow) return { ...base, verdict: 'incorrectlyDisallowed', reason: 'disallow_root_on_custom_domain' };
    return { ...base, verdict: 'inconclusive', reason: 'no_root_directive' };
  } catch (err) {
    clearTimeout(t);
    const reason = err.name === 'AbortError' ? 'timeout' : `fetch_error_${err.code || err.cause?.code || err.name}`;
    return { ...base, verdict: 'inconclusive', reason };
  }
}

function toCsv(records, fields) {
  const esc = v => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [fields.join(',')].concat(records.map(r => fields.map(f => esc(r[f])).join(','))).join('\n');
}

function parseSnapshotDate(filename) {
  const m = filename.match(/(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

function rate(numer, denom) {
  return denom > 0 ? +(numer / denom).toFixed(4) : 0;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const inputPath = args.input ? path.resolve(String(args.input).replace(/^~/, os.homedir())) : DEFAULT_INPUT;
  const dryRun = args['dry-run'] === true;
  const concurrency = parseInt(args.concurrency || '30', 10);
  const timeoutMs = parseInt(args.timeout || '10000', 10);

  if (!fs.existsSync(inputPath)) {
    console.error(`Input CSV not found: ${inputPath}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(inputPath, 'utf8');
  const rows = parseCsv(raw);

  const cohort = rows.filter(r =>
    !isTrue(r.tla_flag) &&
    !isTrue(r.hibernation_flag) &&
    isTrue(r.publish_flag) &&
    r.publish_url && r.publish_url.length > 0,
  );

  const platformCount = cohort.filter(r => categoryOf(r.publish_url) === 'platform').length;
  const customCount = cohort.length - platformCount;

  console.log(`Total rows:        ${rows.length}`);
  console.log(`Cohort size:       ${cohort.length}  (publish_flag=true, tla_flag=false, hibernation_flag=false, publish_url present)`);
  console.log(`  platform host:   ${platformCount}  (*.airoapp.ai — expect Disallow: /)`);
  console.log(`  custom domain:   ${customCount}  (expect Allow: /)`);

  if (dryRun) {
    console.log(`\nFirst 10 cohort rows:`);
    cohort.slice(0, 10).forEach(r => console.log(`  [${categoryOf(r.publish_url).padEnd(8)}] ${r.app_id}\t${r.publish_url}`));
    return;
  }

  console.log(`\nProbing /robots.txt  concurrency=${concurrency}  timeout=${timeoutMs}ms  ua="${USER_AGENT}"\n`);

  const buckets = {
    platform: { correctlyDisallowed: [], incorrectlyAllowed: [], inconclusive: [] },
    custom: { correctlyAllowed: [], incorrectlyDisallowed: [], inconclusive: [] },
  };
  let idx = 0;
  let done = 0;
  const total = cohort.length;
  async function worker() {
    while (idx < cohort.length) {
      const my = idx++;
      const r = await probe(cohort[my], timeoutMs);
      buckets[r.category][r.verdict].push(r);
      done++;
      if (done % 500 === 0 || done === total) {
        const p = buckets.platform;
        const c = buckets.custom;
        process.stderr.write(
          `  ${done}/${total}  ` +
          `platform[ok=${p.correctlyDisallowed.length} bad=${p.incorrectlyAllowed.length} inc=${p.inconclusive.length}]  ` +
          `custom[ok=${c.correctlyAllowed.length} bad=${c.incorrectlyDisallowed.length} inc=${c.inconclusive.length}]\n`,
        );
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  const ranAt = new Date().toISOString();
  const stamp = ranAt.replace(/[:.]/g, '-');
  const outDir = path.join(SCRIPT_DIR, 'results');
  fs.mkdirSync(outDir, { recursive: true });

  const p = buckets.platform;
  const c = buckets.custom;
  const platformChecked = p.correctlyDisallowed.length + p.incorrectlyAllowed.length + p.inconclusive.length;
  const customChecked = c.correctlyAllowed.length + c.incorrectlyDisallowed.length + c.inconclusive.length;

  const filename = path.basename(inputPath);
  const summary = {
    ranAt,
    runDate: ranAt.slice(0, 10),
    input: {
      path: inputPath,
      filename,
      snapshotDate: parseSnapshotDate(filename),
    },
    probedHostPattern: {
      platform: '*.airoapp.ai (publish_url as-is)',
      custom: 'customer domain (publish_url as-is)',
    },
    totalRows: rows.length,
    cohortSize: cohort.length,
    platformDomains: {
      description: 'publish_url on *.airoapp.ai — should serve Disallow: /',
      checked: platformChecked,
      correctlyDisallowed: p.correctlyDisallowed.length,
      incorrectlyAllowed: p.incorrectlyAllowed.length,
      inconclusive: p.inconclusive.length,
      correctRate: rate(p.correctlyDisallowed.length, platformChecked - p.inconclusive.length),
    },
    customDomains: {
      description: 'publish_url is a customer domain — should serve Allow: /',
      checked: customChecked,
      correctlyAllowed: c.correctlyAllowed.length,
      incorrectlyDisallowed: c.incorrectlyDisallowed.length,
      inconclusive: c.inconclusive.length,
      correctRate: rate(c.correctlyAllowed.length, customChecked - c.inconclusive.length),
    },
  };

  fs.writeFileSync(path.join(outDir, `summary-${stamp}.json`), JSON.stringify(summary, null, 2));

  const incorrectPlatform = p.incorrectlyAllowed;
  const incorrectCustom = c.incorrectlyDisallowed;
  const allInconclusive = [...p.inconclusive, ...c.inconclusive];
  const fields = ['app_id', 'customer_id', 'publish_url', 'category', 'verdict', 'reason'];
  fs.writeFileSync(path.join(outDir, `platform-incorrect-${stamp}.csv`), toCsv(incorrectPlatform, fields));
  fs.writeFileSync(path.join(outDir, `custom-incorrect-${stamp}.csv`), toCsv(incorrectCustom, fields));
  fs.writeFileSync(path.join(outDir, `inconclusive-${stamp}.csv`), toCsv(allInconclusive, fields));
  fs.appendFileSync(path.join(outDir, 'runs.jsonl'), JSON.stringify(summary) + '\n');

  console.log('\n' + JSON.stringify(summary, null, 2));
  console.log(`\nResults: ${outDir}`);
}

main().catch(err => { console.error(err); process.exit(1); });
