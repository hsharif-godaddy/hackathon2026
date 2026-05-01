// load-test/helpers.js — Shared utilities for all k6 load test scenarios.
import http from 'k6/http';

export const BASE = __ENV.BASE_URL || 'http://localhost:8080';

export function headers() {
  const h = { 'Content-Type': 'application/json' };
  if (__ENV.AUTH_TOKEN) {
    h['Authorization'] = `Bearer ${__ENV.AUTH_TOKEN}`;
  }
  return h;
}

// Create a product + budget with a large credit pool. Returns { productKey, budgetId }.
export function createProductAndBudget(suffix, creditsTotal = '999999999.000000') {
  const productKey = `loadtest-${suffix}`;
  const productRes = http.post(
    `${BASE}/api/v1/products`,
    JSON.stringify({ productKey }),
    { headers: headers() },
  );

  // 201 = created, 409 = already exists
  if (productRes.status !== 201 && productRes.status !== 409) {
    console.error(`setup: product create failed (${productRes.status}): ${productRes.body}`);
    return null;
  }

  const budgetRes = http.post(
    `${BASE}/api/v1/budgets`,
    JSON.stringify({
      productKey,
      items: [
        { creditsTotal, costToCreditRatio: '1.000000' },
        { creditsTotal: '500000.000000', costToCreditRatio: '0.500000', label: 'bonus' },
      ],
    }),
    { headers: headers() },
  );

  if (budgetRes.status !== 201) {
    console.error(`setup: budget create failed (${budgetRes.status}): ${budgetRes.body}`);
    return null;
  }

  const body = JSON.parse(budgetRes.body);
  return { productKey, budgetId: body.budgetId };
}

function reportLineCount(raw) {
  if (raw === undefined) return 24;
  const k = Math.floor(Number(raw));
  if (!Number.isFinite(k) || k < 1) return 1;
  return Math.min(200, k);
}

// Run one full session lifecycle: open → N spend lines → multi-line report → GET report.
// reportItemLines: how many report rows (allocations) to create; exercises GetSessionReport batching.
// Override per run: k6 --env REPORT_ITEM_LINES=48 ...
// Returns { ok, sessionId, timings: { open, spend[], report, reportGet } }.
export function runSessionLifecycle(budgetId, spendLines = 3, costPerLine = '0.050000', reportItemLines) {
  const result = { ok: false, sessionId: null, timings: { open: 0, spend: [], report: 0, reportGet: 0 } };
  const n = reportLineCount(__ENV.REPORT_ITEM_LINES !== undefined ? __ENV.REPORT_ITEM_LINES : reportItemLines);

  const openRes = http.post(
    `${BASE}/api/v1/sessions`,
    JSON.stringify({ budgetId, metadata: { source: 'k6-load-test' } }),
    { headers: headers(), tags: { endpoint: 'session_open' } },
  );
  result.timings.open = openRes.timings.duration;

  if (openRes.status !== 201) {
    return result;
  }

  const session = JSON.parse(openRes.body);
  result.sessionId = session.sessionId;

  let totalCost = 0;
  for (let i = 0; i < spendLines; i++) {
    const spendRes = http.patch(
      `${BASE}/api/v1/sessions/${session.sessionId}`,
      JSON.stringify({
        sessionItems: [
          { cost: costPerLine, callRequestId: `${session.sessionId}-${i}-${Date.now()}` },
        ],
      }),
      { headers: headers(), tags: { endpoint: 'session_spend' } },
    );
    result.timings.spend.push(spendRes.timings.duration);

    if (spendRes.status !== 200) {
      return result;
    }
    totalCost += parseFloat(costPerLine);
  }

  const tb = totalCost * 0.8;
  const tp = totalCost * 0.2;
  const perB = (tb / n).toFixed(6);
  const perP = (tp / n).toFixed(6);
  const reportItems = [];
  for (let i = 0; i < n; i++) {
    reportItems.push({ budgetCost: perB, productCost: perP, label: `k6-r${i}` });
  }

  const reportRes = http.post(
    `${BASE}/api/v1/sessions/${session.sessionId}/reports`,
    JSON.stringify({ reportItems }),
    {
      headers: headers(),
      tags: { endpoint: 'session_report' },
      responseCallback: http.expectedStatuses(201, 400),
    },
  );
  result.timings.report = reportRes.timings.duration;

  if (reportRes.status === 400) {
    result.ok = true;
    return result;
  }
  if (reportRes.status !== 201) {
    return result;
  }

  let parsed;
  try {
    parsed = JSON.parse(reportRes.body);
  } catch {
    return result;
  }
  const reportId = parsed && parsed.reportId;
  if (!reportId) {
    return result;
  }

  const getRes = http.get(
    `${BASE}/api/v1/sessions/${session.sessionId}/reports/${reportId}`,
    { headers: headers(), tags: { endpoint: 'session_report_get' } },
  );
  result.timings.reportGet = getRes.timings.duration;
  result.ok = getRes.status === 200;
  return result;
}
