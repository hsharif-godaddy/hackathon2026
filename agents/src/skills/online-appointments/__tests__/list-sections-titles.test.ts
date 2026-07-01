import { describe, it, expect } from 'vitest';
import { listSectionsTool } from '../tools/index.js';

const EXPECTED_SECTIONS: Array<{ slug: string; title: string }> = [
  { slug: '01-discovery-questions', title: 'Discovery Questions' },
  { slug: '02-install-and-configure', title: 'Install & Configure' },
  { slug: '03-feature-bookings', title: 'Feature: Admin Bookings' },
  { slug: '04-feature-services', title: 'Feature: Services' },
  { slug: '05-feature-clients', title: 'Feature: Clients' },
  { slug: '06-feature-staff', title: 'Feature: Staff' },
  { slug: '07-feature-coupons', title: 'Feature: Coupons' },
  { slug: '08-feature-categories-questions', title: 'Feature: Categories & Custom Questions' },
  { slug: '09-feature-settings', title: 'Feature: Business Settings' },
  { slug: '10-feature-customer-portal', title: 'Feature: Customer Portal (My Bookings)' },
  { slug: '11-seeding', title: 'Seeding' },
  { slug: '12-user-journeys', title: 'User Journeys' },
  { slug: '13-customization', title: 'Customization' },
  { slug: '14-admin-system', title: 'Admin System' },
  { slug: '15-authentication', title: 'Authentication' },
  { slug: '16-database-setup', title: 'Database Setup' },
  { slug: '17-ui-design', title: 'UI Design — Rich, Modern Interfaces' },
  { slug: 'IMPLEMENTATION', title: 'Online Appointments v2 — Section Index' },
];

describe('listSectionsTool (real section files)', () => {
  it('loads a non-empty title for every section file', async () => {
    const result = await listSectionsTool.execute({}, {});

    expect(result.sections).toHaveLength(EXPECTED_SECTIONS.length);

    for (const section of result.sections) {
      expect(section.title.length, `missing title for ${section.slug}`).toBeGreaterThan(0);
    }
  });

  it('returns expected slugs and titles from sections/', async () => {
    const result = await listSectionsTool.execute({}, {});

    expect(result.sections).toEqual(EXPECTED_SECTIONS);
  });

  it('computeState returns sections catalog and routing_rule from execute output', async () => {
    const output = await listSectionsTool.execute({}, {});
    const state = listSectionsTool.computeState?.({}, output) as { sections: Array<{ slug: string; title: string }>; routing_rule: string } | null;

    expect(state).not.toBeNull();
    expect(Array.isArray(state?.sections)).toBe(true);
    expect(state?.sections.some(s => s.slug === '01-discovery-questions')).toBe(true);
    expect(state?.sections.some(s => s.slug === 'IMPLEMENTATION')).toBe(true);
    expect(typeof state?.routing_rule).toBe('string');
    expect(state?.routing_rule.length).toBeGreaterThan(0);
  });

  it('computeState returns null when output has no sections', () => {
    const state = listSectionsTool.computeState?.({}, { sections: [] });
    expect(state).toBeNull();
  });
});
