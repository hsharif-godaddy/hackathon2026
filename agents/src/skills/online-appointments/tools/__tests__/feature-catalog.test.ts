import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

import {
  OLA_CATALOG_VERSION,
  OLA_FEATURE_CATALOG,
  computePending,
  detectInstalled,
  hasBookingFootprint,
} from '../feature-catalog.ts';

describe('OLA feature catalog integrity', () => {
  it('has unique ids', () => {
    const ids = OLA_FEATURE_CATALOG.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('never advertises a feature from a future catalog version', () => {
    for (const feature of OLA_FEATURE_CATALOG) {
      expect(feature.addedInVersion).toBeGreaterThanOrEqual(1);
      expect(feature.addedInVersion).toBeLessThanOrEqual(OLA_CATALOG_VERSION);
    }
  });

  it('marker-based detections name at least one file to scan', () => {
    for (const feature of OLA_FEATURE_CATALOG) {
      expect(feature.detect.files.length).toBeGreaterThan(0);
    }
  });
});

describe('computePending', () => {
  it('returns every feature when nothing is installed', () => {
    const pending = computePending(new Set());
    expect(pending).toHaveLength(OLA_FEATURE_CATALOG.length);
  });

  it('drops installed features', () => {
    const pending = computePending(new Set(['paid-booking', 'admin-dashboard']));
    const pendingIds = pending.map((f) => f.id);
    expect(pendingIds).not.toContain('paid-booking');
    expect(pendingIds).not.toContain('admin-dashboard');
    expect(pendingIds).toContain('email-confirmations');
  });
});

describe('detectInstalled (filesystem)', () => {
  let appPath: string;

  beforeEach(async () => {
    appPath = await mkdtemp(join(tmpdir(), 'ola-detect-'));
  });

  afterEach(async () => {
    await rm(appPath, { recursive: true, force: true });
  });

  async function writeAppFile(relativePath: string, content: string): Promise<void> {
    const absolutePath = join(appPath, relativePath);
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, content, 'utf8');
  }

  it('detects nothing in an empty app', async () => {
    expect((await detectInstalled(appPath)).size).toBe(0);
  });

  it('detects a marker-based feature only when the marker is present', async () => {
    await writeAppFile('src/lib/appointments.config.ts', 'export const config = { serviceName: "x" };');
    expect((await detectInstalled(appPath)).has('paid-booking')).toBe(false);

    await writeAppFile(
      'src/lib/appointments.config.ts',
      'export const config = { pricingTiers: [{ amount: 8000 }] };',
    );
    expect((await detectInstalled(appPath)).has('paid-booking')).toBe(true);
  });

  it('detects a file-existence feature via any candidate path', async () => {
    await writeAppFile('src/pages/Admin.tsx', 'export default function Admin() { return null; }');
    expect((await detectInstalled(appPath)).has('admin-dashboard')).toBe(true);
  });

  it('does not flag a marker feature when the file exists but lacks the marker', async () => {
    await writeAppFile('src/server/api/appointments/POST.ts', 'export async function POST() {}');
    expect((await detectInstalled(appPath)).has('email-confirmations')).toBe(false);
  });

  // Positive detection for the multi-layout features. These guard the bug where a
  // built feature was scanned for in the WRONG file and so never left "pending":
  // email confirmations live in the §9 split files (or are inlined into POST.ts),
  // and the customer portal lives in the §11 Account page / credits API — not the
  // legacy paths the detectors originally named.
  it('detects email-confirmations from the §9 email transport file', async () => {
    await writeAppFile(
      'src/server/utils/appointment-email.ts',
      "import nodemailer from 'nodemailer';\nexport async function sendConfirmationEmail() {}",
    );
    expect((await detectInstalled(appPath)).has('email-confirmations')).toBe(true);
  });

  it('detects email-confirmations from the §9 calendar-invite (.ics) generator', async () => {
    await writeAppFile(
      'src/lib/calendar-invite.ts',
      "export function generateICS(): string { return 'BEGIN:VCALENDAR'; }",
    );
    expect((await detectInstalled(appPath)).has('email-confirmations')).toBe(true);
  });

  it('detects email-confirmations when the send is inlined into the booking handler', async () => {
    await writeAppFile(
      'src/server/api/appointments/POST.ts',
      "import { sendConfirmationEmail } from '../../utils/appointment-email';\nexport default function handler() { return sendConfirmationEmail(); }",
    );
    expect((await detectInstalled(appPath)).has('email-confirmations')).toBe(true);
  });

  it('detects customer-portal from the §11 Account page', async () => {
    await writeAppFile('src/pages/Account.tsx', 'export default function AccountPage() { return null; }');
    expect((await detectInstalled(appPath)).has('customer-portal')).toBe(true);
  });

  it('detects customer-portal from the §11 credits API', async () => {
    await writeAppFile('src/server/api/account/credits/GET.ts', 'export default function handler() {}');
    expect((await detectInstalled(appPath)).has('customer-portal')).toBe(true);
  });

  it('detects admin-dashboard from the §10.2 dashboard page', async () => {
    await writeAppFile(
      'src/pages/AdminDashboard.tsx',
      'export default function AdminDashboard() { return null; }',
    );
    expect((await detectInstalled(appPath)).has('admin-dashboard')).toBe(true);
  });


  it('detects class-credits when the classPackages config marker is present', async () => {
    await writeAppFile(
      'src/lib/appointments.config.ts',
      'export const config = { classPackages: [{ credits: 10, amount: 9000 }] };',
    );
    expect((await detectInstalled(appPath)).has('class-credits')).toBe(true);
  });

  it('reports no booking footprint for an app without the appointments core', async () => {
    expect(await hasBookingFootprint(appPath)).toBe(false);
  });

  it('reports a booking footprint once the appointments core is installed', async () => {
    await writeAppFile('src/lib/appointments.ts', 'export const x = 1;');
    expect(await hasBookingFootprint(appPath)).toBe(true);
  });
});
