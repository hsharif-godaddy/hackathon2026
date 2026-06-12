/**
 * Manual test script for RUBICON-143 — SEO Quality Monitoring.
 * Runs the same code path as captureSeoQuality in publish.ts.
 *
 * Usage:
 *   pnpm --filter @airo/agents tsx scripts/test-seo-quality.ts
 */

import { runSeoAudit } from '../src/services/seo-audit.js';
import { scoreAuditReport, detectRegression } from '../src/services/SeoQualityScorer.js';
import { SeoQualityRepository } from '../src/database/repositories/SeoQualityRepository.js';

const APP_ID = '82olhef6o0';
const APP_PATH = '/tmp/airo-app-builder/82olhef6o0/preview';
const PUBLISHED_URL = 'https://local.gasket.dev-godaddy.com:5000';

process.env.DB_PATH = new URL('../data/apps.db', import.meta.url).pathname;

const repo = new SeoQualityRepository();

console.log('--- RUBICON-143 SEO Quality Test ---');
console.log(`App:          ${APP_ID}`);
console.log(`Published URL: ${PUBLISHED_URL}`);
console.log('');

console.log('Step 1: Running SEO audit...');
const report = await runSeoAudit({
  appId: APP_ID,
  appPath: APP_PATH,
  publishedUrl: PUBLISHED_URL,
  isPublished: true,
  includeSourceScan: false,
});
console.log(`  Pages audited: ${report.pages.length}`);
console.log(`  Pages with issues: ${report.summary.pagesWithIssues}`);
console.log('');

console.log('Step 2: Scoring...');
const result = scoreAuditReport(report);
console.log(`  Score: ${result.score}/100`);
console.log(`  Page scores:`, result.pageScores);
console.log(`  Missing elements:`, result.missingElements);
console.log('');

if (result.pageCount === 0) {
  console.log('No pages returned — audit returned empty report. Skipping save.');
  process.exit(0);
}

console.log('Step 3: Checking existing baseline...');
const baseline = repo.findBaseline(APP_ID);
console.log(`  Baseline exists: ${!!baseline}`);
if (baseline) {
  console.log(`  Baseline score: ${baseline.score} (id: ${baseline.id})`);
}
console.log('');

console.log('Step 4: Saving snapshot...');
const snapshot = repo.save({
  appId: APP_ID,
  score: result.score,
  pageScores: result.pageScores,
  missingElements: result.missingElements,
  triggeredBy: 'manual',
});
console.log(`  Saved: ${snapshot.id}`);
console.log(`  isBaseline: ${snapshot.isBaseline}`);
console.log('');

if (baseline && !snapshot.isBaseline) {
  console.log('Step 5: Regression detection...');
  const baselineMissing: Record<string, string[]> = JSON.parse(baseline.missingElements);
  const regression = detectRegression(result, { score: baseline.score, missingElements: baselineMissing });
  console.log(`  isRegression: ${regression.isRegression}`);
  console.log(`  scoreDelta:   ${regression.scoreDelta}`);
  if (regression.regressions.length > 0) {
    console.log(`  Affected pages:`, regression.regressions);
  }
  console.log('');
}

console.log('Step 6: Recent history...');
const history = repo.findRecent(APP_ID, 5);
console.log(`  Snapshots in DB: ${history.length}`);
history.forEach((s, i) => {
  console.log(`  [${i + 1}] score=${s.score} isBaseline=${s.isBaseline} triggeredBy=${s.triggeredBy} at=${s.createdAt.toISOString()}`);
});

console.log('');
console.log('Done. Now verify via API:');
console.log(`  curl http://localhost:4000/apps/${APP_ID}/seo-quality/latest  (needs auth)`);
console.log(`  curl http://localhost:4000/apps/${APP_ID}/seo-quality/history  (needs auth)`);
