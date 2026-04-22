// load-test/contention.js — Single-budget lock contention test.
//
// All VUs hammer the SAME budget, exposing optimistic concurrency retries on
// budget_items and the ledger trigger (UPDATE credits_used).
//
// Run: k6 run load-test/contention.js
//      k6 run --env BASE_URL=http://localhost:8080 load-test/contention.js

import { check, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';
import { createProductAndBudget, runSessionLifecycle } from './helpers.js';

// Custom metrics
const sessionOk = new Counter('sessions_completed');
const sessionFail = new Counter('sessions_failed');
const openLatency = new Trend('session_open_duration', true);
const spendLatency = new Trend('session_spend_duration', true);
const reportLatency = new Trend('session_report_duration', true);

export const options = {
  scenarios: {
    contention: {
      executor: 'ramping-vus',
      startVUs: 2,
      stages: [
        { duration: '15s', target: 5 },    // warm up
        { duration: '30s', target: 10 },   // moderate contention
        { duration: '30s', target: 20 },   // heavy contention
        { duration: '30s', target: 25 },   // peak contention
        { duration: '15s', target: 0 },    // cool down
      ],
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<2000', 'p(99)<5000'],
    http_req_failed: ['rate<0.15'],            // lock contention may cause some failures
    sessions_completed: ['count>50'],
  },
};

// setup() runs once — creates the shared budget all VUs will target.
export function setup() {
  const data = createProductAndBudget(`contention-${Date.now()}`);
  if (!data) {
    throw new Error('setup: failed to create product/budget');
  }
  console.log(`setup: budgetId=${data.budgetId} productKey=${data.productKey}`);
  return data;
}

export default function (data) {
  const result = runSessionLifecycle(data.budgetId, 3, '0.050000');

  if (result.timings.open > 0) openLatency.add(result.timings.open);
  result.timings.spend.filter((d) => d > 0).forEach((d) => spendLatency.add(d));
  if (result.timings.report > 0) reportLatency.add(result.timings.report);

  if (result.ok) {
    sessionOk.add(1);
  } else {
    sessionFail.add(1);
  }

  check(result, {
    'session lifecycle completed': (r) => r.ok,
  });

  sleep(0.05 + Math.random() * 0.1); // slight jitter
}

