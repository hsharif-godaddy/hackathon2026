import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { initializeTestDatabase } from '../../schema.js';

vi.mock('../../connection.js');

vi.mock('../../../logging/index.js', () => ({
  Logger: { create: vi.fn().mockReturnValue({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

let idCounter = 0;
vi.mock('nanoid', () => ({
  customAlphabet: () => () => `id${++idCounter}`,
}));

const APP = 'aaaaaaaaaa';
const DOMAIN = 'acme.com';

let testDb: Database.Database;
let repo: import('../DkimOnboardingRepository.js').DkimOnboardingRepository;

function seedApp(appId: string): void {
  testDb.prepare(`INSERT INTO apps (id, name, path, port, status) VALUES (?, ?, ?, 5000, 'created')`).run(appId, appId, `/${appId}`);
}

beforeEach(async () => {
  idCounter = 0;
  testDb = new Database(':memory:');
  initializeTestDatabase(testDb);
  const { getDatabase } = await import('../../connection.js');
  vi.mocked(getDatabase).mockReturnValue(testDb as any);
  const { DkimOnboardingRepository } = await import('../DkimOnboardingRepository.js');
  repo = new DkimOnboardingRepository();
  seedApp(APP);
});

afterEach(() => {
  try { testDb.close(); } catch { /* ignore */ }
  vi.resetModules();
});

describe('claim', () => {
  it('claims when no row exists and creates a pending row', () => {
    const result = repo.claim(APP, DOMAIN);
    expect(result).toEqual({ claimed: true, status: 'pending' });
    const row = repo.findByAppDomain(APP, DOMAIN);
    expect(row?.status).toBe('pending');
  });

  it('does NOT claim when a fresh pending row exists', () => {
    repo.claim(APP, DOMAIN);
    const second = repo.claim(APP, DOMAIN);
    expect(second).toEqual({ claimed: false, status: 'pending' });
  });

  it('does NOT claim when row is active', () => {
    repo.markActive(APP, DOMAIN);
    const result = repo.claim(APP, DOMAIN);
    expect(result).toEqual({ claimed: false, status: 'active' });
  });

  it('re-claims when row is failed', () => {
    repo.claim(APP, DOMAIN);
    repo.setFailed(APP, DOMAIN, 'boom');
    const result = repo.claim(APP, DOMAIN);
    expect(result).toEqual({ claimed: true, status: 'pending' });
    expect(repo.findByAppDomain(APP, DOMAIN)?.lastError).toBeNull();
  });

  it('re-claims when pending is older than the 2h cooldown', () => {
    repo.claim(APP, DOMAIN);
    // Drop the auto-update trigger so we can directly backdate updated_at for the test
    testDb.exec(`DROP TRIGGER IF EXISTS update_dkim_onboarding_updated_at`);
    testDb
      .prepare(`UPDATE dkim_onboarding SET updated_at = datetime('now', '-3 hours') WHERE app_id = ?`)
      .run(APP);
    // Verify the backdate took effect so a re-added trigger can't make this pass vacuously
    const stale = (testDb
      .prepare(`SELECT (updated_at <= datetime('now', '-2 hours')) AS s FROM dkim_onboarding WHERE app_id = ?`)
      .get(APP) as { s: number }).s;
    expect(stale).toBe(1);
    const result = repo.claim(APP, DOMAIN);
    expect(result).toEqual({ claimed: true, status: 'pending' });
  });
});

describe('markActive', () => {
  it('inserts an active row when none exists (backfilled/externally-onboarded domain)', () => {
    repo.markActive(APP, DOMAIN);
    expect(repo.findByAppDomain(APP, DOMAIN)?.status).toBe('active');
  });

  it('promotes a pending row to active', () => {
    repo.claim(APP, DOMAIN);
    repo.markActive(APP, DOMAIN);
    expect(repo.findByAppDomain(APP, DOMAIN)?.status).toBe('active');
  });

  it('is a no-op when already active (never downgrades)', () => {
    repo.markActive(APP, DOMAIN);
    repo.markActive(APP, DOMAIN);
    expect(repo.findByAppDomain(APP, DOMAIN)?.status).toBe('active');
  });
});

describe('setAccepted / setFailed', () => {
  it('records the execution arn on a pending row', () => {
    repo.claim(APP, DOMAIN);
    repo.setAccepted(APP, DOMAIN, 'arn:123');
    expect(repo.findByAppDomain(APP, DOMAIN)?.executionArn).toBe('arn:123');
  });

  it('setFailed does not downgrade an active row', () => {
    repo.markActive(APP, DOMAIN);
    repo.setFailed(APP, DOMAIN, 'boom');
    expect(repo.findByAppDomain(APP, DOMAIN)?.status).toBe('active');
  });

  it('setFailed on an already-failed row overwrites last_error', () => {
    repo.claim(APP, DOMAIN);
    repo.setFailed(APP, DOMAIN, 'first');
    repo.setFailed(APP, DOMAIN, 'second');
    expect(repo.findByAppDomain(APP, DOMAIN)?.lastError).toBe('second');
    expect(repo.findByAppDomain(APP, DOMAIN)?.status).toBe('failed');
  });

  it('setAccepted is a no-op when the row is active (not pending)', () => {
    repo.markActive(APP, DOMAIN);
    repo.setAccepted(APP, DOMAIN, 'arn:x');
    expect(repo.findByAppDomain(APP, DOMAIN)?.executionArn).toBeNull();
    expect(repo.findByAppDomain(APP, DOMAIN)?.status).toBe('active');
  });
});

describe('setAccepted / setFailed no-op when no row', () => {
  it('setAccepted no-ops when no row exists', () => {
    expect(() => repo.setAccepted(APP, DOMAIN, 'arn:x')).not.toThrow();
    expect(repo.findByAppDomain(APP, DOMAIN)).toBeNull();
  });

  it('setFailed no-ops when no row exists', () => {
    expect(() => repo.setFailed(APP, DOMAIN, 'boom')).not.toThrow();
    expect(repo.findByAppDomain(APP, DOMAIN)).toBeNull();
  });
});

describe('deleteByAppDomain', () => {
  it('removes the row (unconditional)', () => {
    repo.claim(APP, DOMAIN);
    repo.deleteByAppDomain(APP, DOMAIN);
    expect(repo.findByAppDomain(APP, DOMAIN)).toBeNull();
  });

  it('deleteByAppDomain with expectedStatus only deletes a matching-status row', () => {
    // create an active row; conditional delete with 'active' returns 1 and row gone
    repo.markActive(APP, DOMAIN);
    expect(repo.findByAppDomain(APP, DOMAIN)?.status).toBe('active');
    const deleted = repo.deleteByAppDomain(APP, DOMAIN, 'active');
    expect(deleted).toBe(1);
    expect(repo.findByAppDomain(APP, DOMAIN)).toBeNull();

    // create a pending row; conditional delete with 'active' returns 0 and row remains
    repo.claim(APP, DOMAIN);
    expect(repo.findByAppDomain(APP, DOMAIN)?.status).toBe('pending');
    const notDeleted = repo.deleteByAppDomain(APP, DOMAIN, 'active');
    expect(notDeleted).toBe(0);
    expect(repo.findByAppDomain(APP, DOMAIN)).not.toBeNull();
  });
});
