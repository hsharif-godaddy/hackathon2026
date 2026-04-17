// load-test/lifecycle.js — Steady-state constant-rate lifecycle test.
//
// Uses constant-arrival-rate: exactly N iterations/sec regardless of response time.
// Simulates sustained production traffic to surface latency drift and resource leaks.
//
// Run: k6 run load-test/lifecycle.js

import { check } from 'k6';
import { Counter, Trend } from 'k6/metrics';
import { createProductAndBudget, runSessionLifecycle } from './helpers.js';

const sessionOk = new Counter('sessions_completed');
const sessionFail = new Counter('sessions_failed');
const openLatency = new Trend('session_open_duration', true);
const spendLatency = new Trend('session_spend_duration', true);
const reportLatency = new Trend('session_report_duration', true);

const BUDGET_POOL_SIZE = 50;

export const options = {
  scenarios: {
    steady: {
      executor: 'constant-arrival-rate',
      rate: 30,             // 30 iterations per timeUnit
      timeUnit: '1s',
      duration: '3m',
      preAllocatedVUs: 50,
      maxVUs: 150,
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<500', 'p(99)<2000'],
    http_req_failed: ['rate<0.05'],
    sessions_completed: ['count>1000'],
  },
};

export function setup() {
  const budgets = [];
  console.log(`setup: creating ${BUDGET_POOL_SIZE} budgets...`);
  for (let i = 0; i < BUDGET_POOL_SIZE; i++) {
    const data = createProductAndBudget(`lifecycle-${Date.now()}-${i}`);
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
  const idx = (__VU - 1) % data.budgets.length;
  const budgetId = data.budgets[idx];

  const result = runSessionLifecycle(budgetId, 3, '0.020000');

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
}

