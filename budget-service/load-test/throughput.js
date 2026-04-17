// load-test/throughput.js — Multi-budget parallel throughput test.
//
// Each VU gets its own budget, so row-lock contention is minimal.
// This isolates connection pool saturation, query throughput, and Go server capacity.
//
// Run: k6 run load-test/throughput.js

import { check, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';
import { createProductAndBudget, runSessionLifecycle } from './helpers.js';

const sessionOk = new Counter('sessions_completed');
const sessionFail = new Counter('sessions_failed');
const openLatency = new Trend('session_open_duration', true);
const spendLatency = new Trend('session_spend_duration', true);
const reportLatency = new Trend('session_report_duration', true);

export const options = {
  scenarios: {
    throughput: {
      executor: 'ramping-vus',
      startVUs: 5,
      stages: [
        { duration: '15s', target: 25 },
        { duration: '30s', target: 50 },
        { duration: '30s', target: 100 },
        { duration: '30s', target: 200 },
        { duration: '15s', target: 0 },
      ],
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<500', 'p(99)<2000'],
    http_req_failed: ['rate<0.05'],
    sessions_completed: ['count>200'],
  },
};

// setup() pre-creates a pool of budgets — one per max configured VU target.
const MAX_BUDGETS = Math.max(
  0,
  ...options.scenarios.throughput.stages.map(({ target }) => target),
);

export function setup() {
  const budgets = [];
  console.log(`setup: creating ${MAX_BUDGETS} budgets...`);
  for (let i = 0; i < MAX_BUDGETS; i++) {
    const data = createProductAndBudget(`throughput-${Date.now()}-${i}`);
    if (data) {
      budgets.push(data.budgetId);
    }
  }
  console.log(`setup: created ${budgets.length} budgets`);
  if (budgets.length === 0) {
    throw new Error('setup: no budgets created');
  }
  return { budgets };
}

export default function (data) {
  // Each VU picks its own budget by VU id (mod pool size)
  const idx = (__VU - 1) % data.budgets.length;
  const budgetId = data.budgets[idx];

  const result = runSessionLifecycle(budgetId, 3, '0.010000');

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

  sleep(0.05 + Math.random() * 0.1);
}

