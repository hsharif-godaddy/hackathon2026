import { describe, it, expect } from 'vitest';
import { listSectionsTool } from '../tools/index.js';

const EXPECTED_SECTIONS: Array<{ slug: string; title: string }> = [
  { slug: '01-discovery-questions', title: 'Discovery Questions' },
  { slug: '02-configuration-examples', title: 'Configuration Examples' },
  { slug: '03-database-setup', title: 'Database Setup' },
  { slug: '04-authentication-integration', title: 'Authentication Integration' },
  { slug: '05-admin-user-seed', title: 'Admin User Seed' },
  { slug: '06-ui-components', title: 'UI Components' },
  { slug: '07-booking-page-flow', title: 'Booking Page Flow' },
  { slug: '08-payment-integration', title: 'Payment Integration ⚠️ COMPLEX' },
  { slug: '09-email-notifications', title: 'Email Notifications' },
  { slug: '10-admin-dashboard', title: 'Admin Dashboard' },
  { slug: '11-customer-portal', title: 'Customer Portal' },
  { slug: '12-class-credits-system', title: 'Class Credits System' },
  { slug: '13-troubleshooting', title: 'Troubleshooting' },
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
});
