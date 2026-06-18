import { customAlphabet } from 'nanoid';

import { getDatabase } from '../connection.js';
import { Logger } from '../../logging/index.js';

const nanoid = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 12);
const logger = Logger.create({ component: 'dkim-onboarding-repo' });

// Stale-pending cooldown: a `pending` row older than this is assumed dead
// (crashed mid-onboard) and may be re-claimed. 2h is comfortably longer than
// Vox execution + DNS propagation, so a healthy pending always reaches
// `active` before the window elapses.
const PENDING_COOLDOWN = '-2 hours';
const POLL_LEASE_MS = 2 * 60 * 1000;
const FAST_POLL_WINDOW_MS = 40 * 60 * 1000;
const FAST_POLL_INTERVAL_MS = 30 * 1000;
const EXPONENTIAL_BASE_MS = 60 * 1000;
const DAILY_POLL_INTERVAL_MS = 24 * 60 * 60 * 1000;
const MAX_POLL_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export type DkimOnboardingStatus = 'pending' | 'active' | 'failed';

export interface DkimOnboardingRow {
  id: string;
  appId: string;
  domain: string;
  status: DkimOnboardingStatus;
  executionArn: string | null;
  lastError: string | null;
  pollStartedAt: Date | null;
  nextPollAt: Date | null;
  lastPolledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ClaimResult {
  claimed: boolean;
  status: DkimOnboardingStatus;
}

export interface DuePollDecision {
  shouldPoll: boolean;
  expired: boolean;
  status: DkimOnboardingStatus | null;
  pollStartedAt: Date | null;
  nextPollAt: Date | null;
  lastPolledAt: Date | null;
}

export class DkimOnboardingRepository {
  private db = getDatabase();

  findByAppDomain(appId: string, domain: string): DkimOnboardingRow | null {
    const row = this.db
      .prepare(`SELECT * FROM dkim_onboarding WHERE app_id = ? AND domain = ?`)
      .get(appId, domain) as Record<string, unknown> | undefined;
    return row ? this.mapRow(row) : null;
  }

  /**
   * Atomic compare-and-set. Returns claimed=true only when the caller should
   * proceed to call Vox. A fresh `pending` or an `active` row returns
   * claimed=false (idempotency). A `failed` or stale `pending` row is reset to
   * `pending` and claimed. Runs in a transaction so concurrent callers against
   * the single per-app agent are serialized.
   */
  claim(appId: string, domain: string): ClaimResult {
    const txn = this.db.transaction((): ClaimResult => {
      const existing = this.db
        .prepare(`SELECT id, status FROM dkim_onboarding WHERE app_id = ? AND domain = ?`)
        .get(appId, domain) as { id: string; status: DkimOnboardingStatus } | undefined;

      if (!existing) {
        const id = `dkim-${nanoid()}`;
        this.db
          .prepare(`INSERT INTO dkim_onboarding (id, app_id, domain, status) VALUES (?, ?, ?, 'pending')`)
          .run(id, appId, domain);
        return { claimed: true, status: 'pending' };
      }

      if (existing.status === 'active') {
        return { claimed: false, status: 'active' };
      }

      if (existing.status === 'pending') {
        const fresh = this.db
          .prepare(`SELECT 1 AS ok FROM dkim_onboarding WHERE id = ? AND updated_at > datetime('now', ?)`)
          .get(existing.id, PENDING_COOLDOWN) as { ok: number } | undefined;
        if (fresh) {
          return { claimed: false, status: 'pending' };
        }
      }

      // failed OR stale pending -> re-claim
      this.db
        .prepare(
          `UPDATE dkim_onboarding
           SET status = 'pending', execution_arn = NULL, last_error = NULL, updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
        )
        .run(existing.id);
      return { claimed: true, status: 'pending' };
    });
    const result = txn();
    logger.info('dkim.repo.claim', { appId, domain, claimed: result.claimed, status: result.status });
    return result;
  }

  setAccepted(appId: string, domain: string, executionArn: string): void {
    const info = this.db
      .prepare(
        `UPDATE dkim_onboarding
         SET execution_arn = ?, updated_at = CURRENT_TIMESTAMP
         WHERE app_id = ? AND domain = ? AND status = 'pending'`,
      )
      .run(executionArn, appId, domain);
    if (info.changes === 0) {
      logger.warn('dkim.repo.setAccepted.noop', { appId, domain });
    } else {
      logger.info('dkim.repo.setAccepted', { appId, domain });
    }
  }

  setFailed(appId: string, domain: string, error: string): void {
    const info = this.db
      .prepare(
        `UPDATE dkim_onboarding
         SET status = 'failed', last_error = ?, updated_at = CURRENT_TIMESTAMP
         WHERE app_id = ? AND domain = ? AND status != 'active'`,
      )
      .run(error, appId, domain);
    if (info.changes === 0) {
      logger.warn('dkim.repo.setFailed.noop', { appId, domain });
    } else {
      logger.info('dkim.repo.setFailed', { appId, domain });
    }
  }

  /**
   * Atomically claims a due external-DKIM poll window. `next_poll_at` doubles as
   * a short in-flight lease so multiple devices/tabs cannot all call MailFlow.
   */
  claimDuePoll(appId: string, domain: string, now = new Date()): DuePollDecision {
    const txn = this.db.transaction((): DuePollDecision => {
      let row = this.db
        .prepare(`SELECT * FROM dkim_onboarding WHERE app_id = ? AND domain = ?`)
        .get(appId, domain) as Record<string, unknown> | undefined;

      if (!row) {
        const id = `dkim-${nanoid()}`;
        const nowSql = toSqlDate(now);
        this.db
          .prepare(
            `INSERT INTO dkim_onboarding
             (id, app_id, domain, status, poll_started_at, next_poll_at, last_polled_at)
             VALUES (?, ?, ?, 'pending', ?, ?, ?)`,
          )
          .run(id, appId, domain, nowSql, toSqlDate(addMs(now, POLL_LEASE_MS)), nowSql);
        return {
          shouldPoll: true,
          expired: false,
          status: 'pending',
          pollStartedAt: now,
          nextPollAt: addMs(now, POLL_LEASE_MS),
          lastPolledAt: now,
        };
      }

      if (row.status === 'active') {
        return this.decisionFromRow(row, false, false);
      }

      if (!row.poll_started_at) {
        const nowSql = toSqlDate(now);
        this.db
          .prepare(
            `UPDATE dkim_onboarding
             SET poll_started_at = ?, next_poll_at = ?, last_polled_at = ?, updated_at = CURRENT_TIMESTAMP
             WHERE app_id = ? AND domain = ?`,
          )
          .run(nowSql, toSqlDate(addMs(now, POLL_LEASE_MS)), nowSql, appId, domain);
        return {
          shouldPoll: true,
          expired: false,
          status: row.status as DkimOnboardingStatus,
          pollStartedAt: now,
          nextPollAt: addMs(now, POLL_LEASE_MS),
          lastPolledAt: now,
        };
      }

      const pollStartedAt = parseDbDate(row.poll_started_at);
      if (pollStartedAt && now.getTime() - pollStartedAt.getTime() >= MAX_POLL_WINDOW_MS) {
        this.db
          .prepare(
            `UPDATE dkim_onboarding
             SET next_poll_at = NULL, updated_at = CURRENT_TIMESTAMP
             WHERE app_id = ? AND domain = ?`,
          )
          .run(appId, domain);
        return {
          shouldPoll: false,
          expired: true,
          status: row.status as DkimOnboardingStatus,
          pollStartedAt,
          nextPollAt: null,
          lastPolledAt: parseDbDate(row.last_polled_at),
        };
      }

      const nextPollAt = parseDbDate(row.next_poll_at);
      if (nextPollAt && nextPollAt.getTime() > now.getTime()) {
        return this.decisionFromRow(row, false, false);
      }

      const nowSql = toSqlDate(now);
      this.db
        .prepare(
          `UPDATE dkim_onboarding
           SET next_poll_at = ?, last_polled_at = ?, updated_at = CURRENT_TIMESTAMP
           WHERE app_id = ? AND domain = ?`,
        )
        .run(toSqlDate(addMs(now, POLL_LEASE_MS)), nowSql, appId, domain);

      row = {
        ...row,
        next_poll_at: toSqlDate(addMs(now, POLL_LEASE_MS)),
        last_polled_at: nowSql,
      };
      return this.decisionFromRow(row, true, false);
    });

    const decision = txn();
    logger.info('dkim.repo.poll.claim', {
      appId,
      domain,
      shouldPoll: decision.shouldPoll,
      expired: decision.expired,
    });
    return decision;
  }

  completeDuePoll(appId: string, domain: string, now = new Date()): void {
    const row = this.db
      .prepare(`SELECT poll_started_at FROM dkim_onboarding WHERE app_id = ? AND domain = ?`)
      .get(appId, domain) as { poll_started_at: string | null } | undefined;

    const pollStartedAt = parseDbDate(row?.poll_started_at);
    if (!pollStartedAt) {
      logger.warn('dkim.repo.poll.complete.no-start', { appId, domain });
      return;
    }

    const nextPollAt = addMs(now, getNextPollIntervalMs(pollStartedAt, now));
    this.db
      .prepare(
        `UPDATE dkim_onboarding
         SET next_poll_at = ?, updated_at = CURRENT_TIMESTAMP
         WHERE app_id = ? AND domain = ? AND status != 'active'`,
      )
      .run(toSqlDate(nextPollAt), appId, domain);

    logger.info('dkim.repo.poll.complete', { appId, domain, nextPollAt: nextPollAt.toISOString() });
  }

  /** Upsert to `active`; never downgrades. Insert-if-missing adopts
   * backfilled / externally-onboarded domains from observed DNS truth. */
  markActive(appId: string, domain: string): void {
    const txn = this.db.transaction(() => {
      const existing = this.db
        .prepare(`SELECT id, status FROM dkim_onboarding WHERE app_id = ? AND domain = ?`)
        .get(appId, domain) as { id: string; status: DkimOnboardingStatus } | undefined;

      if (!existing) {
        const id = `dkim-${nanoid()}`;
        this.db
          .prepare(`INSERT INTO dkim_onboarding (id, app_id, domain, status) VALUES (?, ?, ?, 'active')`)
          .run(id, appId, domain);
        logger.info('dkim.repo.markActive.inserted', { appId, domain });
        return;
      }
      if (existing.status !== 'active') {
        this.db
          .prepare(
            `UPDATE dkim_onboarding
             SET status = 'active', last_error = NULL, next_poll_at = NULL, updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`,
          )
          .run(existing.id);
        logger.info('dkim.repo.markActive.promoted', { appId, domain });
      }
    });
    txn();
  }

  deleteByAppDomain(appId: string, domain: string, expectedStatus?: DkimOnboardingStatus): number {
    const info = expectedStatus
      ? this.db.prepare(`DELETE FROM dkim_onboarding WHERE app_id = ? AND domain = ? AND status = ?`).run(appId, domain, expectedStatus)
      : this.db.prepare(`DELETE FROM dkim_onboarding WHERE app_id = ? AND domain = ?`).run(appId, domain);
    logger.info('dkim.repo.deleted', { appId, domain, expectedStatus: expectedStatus ?? null, deleted: info.changes });
    return info.changes;
  }

  private mapRow(row: Record<string, unknown>): DkimOnboardingRow {
    return {
      id: row.id as string,
      appId: row.app_id as string,
      domain: row.domain as string,
      status: row.status as DkimOnboardingStatus,
      executionArn: (row.execution_arn as string | null) ?? null,
      lastError: (row.last_error as string | null) ?? null,
      pollStartedAt: parseDbDate(row.poll_started_at),
      nextPollAt: parseDbDate(row.next_poll_at),
      lastPolledAt: parseDbDate(row.last_polled_at),
      createdAt: new Date(row.created_at as string),
      updatedAt: new Date(row.updated_at as string),
    };
  }

  private decisionFromRow(row: Record<string, unknown>, shouldPoll: boolean, expired: boolean): DuePollDecision {
    return {
      shouldPoll,
      expired,
      status: (row.status as DkimOnboardingStatus | null) ?? null,
      pollStartedAt: parseDbDate(row.poll_started_at),
      nextPollAt: parseDbDate(row.next_poll_at),
      lastPolledAt: parseDbDate(row.last_polled_at),
    };
  }
}

function addMs(date: Date, ms: number): Date {
  return new Date(date.getTime() + ms);
}

function toSqlDate(date: Date): string {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

function parseDbDate(value: unknown): Date | null {
  if (!value || typeof value !== 'string') return null;
  return new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`);
}

function getNextPollIntervalMs(pollStartedAt: Date, now: Date): number {
  const elapsed = now.getTime() - pollStartedAt.getTime();
  if (elapsed < FAST_POLL_WINDOW_MS) return FAST_POLL_INTERVAL_MS;

  let remaining = elapsed - FAST_POLL_WINDOW_MS;
  let interval = EXPONENTIAL_BASE_MS;
  while (remaining >= interval && interval < DAILY_POLL_INTERVAL_MS) {
    remaining -= interval;
    interval = Math.min(interval * 2, DAILY_POLL_INTERVAL_MS);
  }

  return interval;
}
