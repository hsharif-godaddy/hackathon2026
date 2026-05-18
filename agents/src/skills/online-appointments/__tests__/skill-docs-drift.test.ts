/**
 * Drift guard: documentation in skill.md must stay in sync with the zod schemas
 * shipped in templates/lib/appointments.ts. If a schema field is added, removed,
 * or renamed without an accompanying skill.md edit, this test fails loudly.
 *
 * Two independent assertions per schema:
 *   1. Actual zod keys match a hardcoded expected list (catches schema drift —
 *      forces the test author to acknowledge the change).
 *   2. Every expected key appears as a literal string somewhere in skill.md
 *      (catches doc drift — undocumented field).
 *
 * Lives in agents/src/skills/online-appointments/__tests__/ (collected by
 * agents-side vitest; templates/__tests__/ is excluded — see vitest.config.ts).
 */

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// templates/lib/appointments.ts imports `date-fns` for its slot-generation helpers.
// `date-fns` is a customer-app dependency, not an agents devDep — stub it so the
// schema module loads. The schemas themselves don't call into date-fns.
vi.mock('date-fns', () => {
  const stub = (): undefined => undefined;
  return {
    addMinutes: stub,
    format: stub,
    parse: stub,
    isAfter: stub,
    isBefore: stub,
    isSameDay: stub,
    setHours: stub,
    setMinutes: stub,
    setSeconds: stub,
    setMilliseconds: stub,
  };
});

import {
  AppointmentsConfigSchema,
  PricingTierSchema,
  AppointmentInputSchema,
} from '../templates/lib/appointments';

const skillMd: string = readFileSync(
  path.resolve(__dirname, '..', 'skill.md'),
  'utf8',
);

function shapeKeys(schema: { shape: Record<string, unknown> }): string[] {
  return Object.keys(schema.shape).sort();
}

describe('online-appointments skill: doc-vs-schema drift', () => {
  it('AppointmentsConfigSchema keys match documentation', () => {
    const expected: string[] = [
      'businessHoursEnd',
      'businessHoursStart',
      'currency',
      'duration',
      'pricingTiers',
      'serviceName',
      'workingDays',
    ];
    expect(shapeKeys(AppointmentsConfigSchema)).toEqual(expected);

    for (const key of expected) {
      expect(skillMd.includes(key), `skill.md must mention config field '${key}'`).toBe(true);
    }
  });

  it('PricingTierSchema keys match documentation', () => {
    const expected: string[] = ['amount', 'duration', 'label', 'skuId'];
    expect(shapeKeys(PricingTierSchema)).toEqual(expected);

    for (const key of expected) {
      expect(skillMd.includes(key), `skill.md must mention pricing-tier field '${key}'`).toBe(true);
    }
  });

  it('AppointmentInputSchema booking-request fields are stable', () => {
    const expected: string[] = [
      'amount',
      'customerEmail',
      'customerName',
      'customerPhone',
      'date',
      'notes',
      'requiresPayment',
      'time',
    ];
    expect(shapeKeys(AppointmentInputSchema)).toEqual(expected);
  });
});
