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

// Run one full session lifecycle: open → N spend lines → report.
// Returns { ok: bool, sessionId, timings: { open, spend[], report } }.
export function runSessionLifecycle(budgetId, spendLines = 3, costPerLine = '0.050000') {
  const result = { ok: false, sessionId: null, timings: { open: 0, spend: [], report: 0 } };

  // 1. Open session
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

  // 2. Append spend lines
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

  // 3. Close with report — budgetCost covers what credits can absorb
  const budgetCost = (totalCost * 0.8).toFixed(6); // 80% to budget
  const productCost = (totalCost * 0.2).toFixed(6); // 20% overage
  const reportRes = http.post(
    `${BASE}/api/v1/sessions/${session.sessionId}/reports`,
    JSON.stringify({
      reportItems: [
        { budgetCost, productCost, label: 'k6-load-test' },
      ],
    }),
    {
      headers: headers(),
      tags: { endpoint: 'session_report' },
      responseCallback: http.expectedStatuses(201, 400),
    },
  );
  result.timings.report = reportRes.timings.duration;

  // 201 = created, 400 INSUFFICIENT_CREDITS = expected at high load
  result.ok = reportRes.status === 201 || reportRes.status === 400;
  return result;
}

