/**
 * feedback-db.ts
 *
 * SQLite database for Feedback Analytics — separate from l1_transcripts.db.
 * Schema mirrors the airo_support_v2/backend analytics DB.
 *
 * DB path: FEEDBACK_DB_PATH env var (defaults to ./data/feedback_analytics.db)
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import BetterSqlite3 from 'better-sqlite3';

import { syncDb, scheduleUpload } from './db-backup';

let _db: BetterSqlite3.Database | null = null;
let _syncPromise: Promise<void> | null = null;

function dbPath(): string {
    const envPath = process.env.FEEDBACK_DB_PATH;
    if (envPath) return path.resolve(envPath);
    return path.resolve(process.cwd(), 'data', 'feedback_analytics.db');
}

export function getFeedbackDb(): BetterSqlite3.Database {
    if (_db) return _db;

    const p = dbPath();

    // Sync from S3 synchronously before opening database
    if (!_syncPromise) {
        try {
            if (!fs.existsSync(p) || fs.statSync(p).size < 4096) {
                const bucket = process.env.L1_TRANSCRIPTS_S3_BUCKET || 'airo-builder-l1-transcripts-dev';
                const prefix = 'backups/support-plane/feedback_analytics/';
                console.log('[feedback-db] Downloading latest backup from S3...');

                const listCmd = `aws s3 ls s3://${bucket}/${prefix} --recursive | sort | tail -n 1 | awk '{print $4}'`;
                const latestKey = execSync(listCmd, { encoding: 'utf8' }).trim();

                if (latestKey) {
                    execSync(`aws s3 cp s3://${bucket}/${latestKey} ${p}`, { stdio: 'inherit' });
                    console.log('[feedback-db] Downloaded:', latestKey);
                } else {
                    console.log('[feedback-db] No S3 backup found, starting fresh');
                }
            }
        } catch (err) {
            console.error('[feedback-db] S3 sync failed:', err instanceof Error ? err.message : String(err));
        }
        _syncPromise = Promise.resolve();
    }

    _db = new BetterSqlite3(p);
    _db.pragma('journal_mode = WAL');
    _db.pragma('foreign_keys = ON');
    initSchema(_db);
    return _db;
}

// ── Schema ────────────────────────────────────────────────────────

function addColumnIfMissing(db: BetterSqlite3.Database, table: string, col: string, type: string): void {
    const exists = (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).some(r => r.name === col);
    if (!exists) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`);
}

function initSchema(db: BetterSqlite3.Database): void {
    // ── Source tables ──────────────────────────────────────────────
    // feedback_athena: rows from Athena CLN view (core fields only).
    db.exec(`
        CREATE TABLE IF NOT EXISTS feedback_athena (
            feedback_id          TEXT PRIMARY KEY,
            env                  TEXT NOT NULL,
            app_id               TEXT,
            customer_id          TEXT,
            feedback_utc_ts      TEXT,
            rating               INTEGER,
            feedback_text        TEXT,
            consent_flag         INTEGER,
            plan_type_name       TEXT,
            subscription_id      TEXT,
            subscription_status  TEXT,
            total_credit_cnt     INTEGER,
            available_credit_cnt INTEGER,
            feedback_topic_list  TEXT,
            feedback_origin_name TEXT,
            app_publish_flag     INTEGER,
            publish_url          TEXT,
            cln_create_utc_ts    TEXT,
            ingested_at          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_fa_ts  ON feedback_athena(feedback_utc_ts);
        CREATE INDEX IF NOT EXISTS idx_fa_env ON feedback_athena(env);
    `);

    // feedback_s3: rows from S3 parquet (all fields including enrichment).
    db.exec(`
        CREATE TABLE IF NOT EXISTS feedback_s3 (
            feedback_id          TEXT PRIMARY KEY,
            env                  TEXT NOT NULL,
            app_id               TEXT,
            customer_id          TEXT,
            feedback_utc_ts      TEXT,
            rating               INTEGER,
            feedback_text        TEXT,
            consent_flag         INTEGER,
            plan_type_name       TEXT,
            subscription_id      TEXT,
            subscription_status  TEXT,
            total_credit_cnt     INTEGER,
            available_credit_cnt INTEGER,
            feedback_topic_list  TEXT,
            feedback_origin_name TEXT,
            feedback_category    TEXT,
            app_publish_flag     INTEGER,
            full_story_url       TEXT,
            shopper_id           TEXT,
            experiments_line     TEXT,
            publish_url          TEXT,
            cln_create_utc_ts    TEXT,
            s3_url               TEXT,
            device_type          TEXT,
            browser_type         TEXT,
            page_url             TEXT,
            session_id           TEXT,
            app_name             TEXT,
            app_version          TEXT,
            ingested_at          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_fs_ts  ON feedback_s3(feedback_utc_ts);
        CREATE INDEX IF NOT EXISTS idx_fs_env ON feedback_s3(env);
    `);

    // ── Composite table ────────────────────────────────────────────
    // feedback_raw: materialized composite of Athena + S3.
    // Rebuilt by rebuildFeedbackComposite() after each sync.
    // All analytics and browse queries read from this table.
    db.exec(`
        CREATE TABLE IF NOT EXISTS feedback_raw (
            feedback_id          TEXT PRIMARY KEY,
            env                  TEXT NOT NULL,
            data_source          TEXT NOT NULL DEFAULT 's3',
            app_id               TEXT,
            customer_id          TEXT,
            feedback_utc_ts      TEXT,
            rating               INTEGER,
            feedback_text        TEXT,
            consent_flag         INTEGER,
            plan_type_name       TEXT,
            subscription_id      TEXT,
            subscription_status  TEXT,
            total_credit_cnt     INTEGER,
            available_credit_cnt INTEGER,
            feedback_topic_list  TEXT,
            feedback_origin_name TEXT,
            feedback_category    TEXT,
            app_publish_flag     INTEGER,
            full_story_url       TEXT,
            shopper_id           TEXT,
            experiments_line     TEXT,
            publish_url          TEXT,
            cln_create_utc_ts    TEXT,
            s3_url               TEXT,
            device_type          TEXT,
            browser_type         TEXT,
            page_url             TEXT,
            session_id           TEXT,
            app_name             TEXT,
            app_version          TEXT,
            ingested_at          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_fr_ts      ON feedback_raw(feedback_utc_ts);
        CREATE INDEX IF NOT EXISTS idx_fr_cat     ON feedback_raw(feedback_category);
        CREATE INDEX IF NOT EXISTS idx_fr_app     ON feedback_raw(app_id);
        CREATE INDEX IF NOT EXISTS idx_fr_rating  ON feedback_raw(rating);
        CREATE INDEX IF NOT EXISTS idx_fr_env     ON feedback_raw(env);
        CREATE INDEX IF NOT EXISTS idx_fr_ts_date ON feedback_raw(date(feedback_utc_ts));
        CREATE INDEX IF NOT EXISTS idx_fr_source  ON feedback_raw(data_source);
    `);

    // Migrate existing composite table: add data_source column if missing.
    addColumnIfMissing(db, 'feedback_raw', 'data_source', "TEXT NOT NULL DEFAULT 's3'");

    // Repair epoch-style timestamps in feedback_raw (stored as numeric strings from earlier ingests).
    try {
        db.exec(`
            UPDATE feedback_raw
            SET feedback_utc_ts = datetime(CAST(feedback_utc_ts AS REAL) / 1000000, 'unixepoch')
            WHERE feedback_utc_ts IS NOT NULL
              AND CAST(feedback_utc_ts AS REAL) > 1000000000000000
              AND feedback_utc_ts NOT LIKE '%-%';
        `);
    } catch { /* non-critical, best-effort */ }

    // Repair JS Date.toString() timestamps in feedback_raw: "Mon Jun 01 2026 21:28:00 GMT+0530"
    try {
        const jsDateRows = db.prepare(`
            SELECT feedback_id, feedback_utc_ts FROM feedback_raw
            WHERE feedback_utc_ts IS NOT NULL
              AND (feedback_utc_ts LIKE 'Mon%' OR feedback_utc_ts LIKE 'Tue%'
                OR feedback_utc_ts LIKE 'Wed%' OR feedback_utc_ts LIKE 'Thu%'
                OR feedback_utc_ts LIKE 'Fri%' OR feedback_utc_ts LIKE 'Sat%'
                OR feedback_utc_ts LIKE 'Sun%')
        `).all() as { feedback_id: string; feedback_utc_ts: string }[];

        if (jsDateRows.length > 0) {
            const upd = db.prepare('UPDATE feedback_raw SET feedback_utc_ts = ? WHERE feedback_id = ?');
            db.transaction(() => {
                for (const row of jsDateRows) {
                    const d = new Date(row.feedback_utc_ts);
                    if (!isNaN(d.getTime())) upd.run(d.toISOString(), row.feedback_id);
                }
            })();
        }
    } catch { /* non-critical */ }

    db.exec(`
        CREATE TABLE IF NOT EXISTS ingestion_log (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            s3_url        TEXT    NOT NULL UNIQUE,
            source        TEXT    NOT NULL DEFAULT 's3',
            status        TEXT    NOT NULL,
            rows_written  INTEGER DEFAULT 0,
            error_msg     TEXT,
            ingested_at   TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS daily_stats (
            date            TEXT NOT NULL,
            env             TEXT NOT NULL,
            app_id          TEXT NOT NULL DEFAULT '__all__',
            total_count     INTEGER DEFAULT 0,
            avg_rating      REAL,
            issue_count     INTEGER DEFAULT 0,
            support_count   INTEGER DEFAULT 0,
            feedback_count  INTEGER DEFAULT 0,
            consent_count   INTEGER DEFAULT 0,
            PRIMARY KEY (date, env, app_id)
        );

        CREATE INDEX IF NOT EXISTS idx_ds_date ON daily_stats(date);
        CREATE INDEX IF NOT EXISTS idx_ds_env  ON daily_stats(env);
    `);
}

// ── Types ─────────────────────────────────────────────────────────

export interface FeedbackSummary {
    totalFeedback: number;
    avgRating: number | null;
    issueCount: number;
    supportCount: number;
    feedbackCount: number;
    uniqueApps: number;
    positiveCount: number;
    negativeCount: number;
    neutralCount: number;
    dateRange: { from: string | null; to: string | null };
}

export interface TrendPoint {
    date: string;
    count: number;
    avgRating: number | null;
    issueCount: number;
    supportCount: number;
    feedbackCount: number;
}

export interface RatingBucket {
    rating: number;
    count: number;
    pct: number;
}

export interface CategoryBreakdown {
    category: string;
    count: number;
    pct: number;
}

export interface TopicEntry {
    topic: string;
    count: number;
    pct: number;
}

export interface AppEntry {
    appId: string;
    count: number;
    avgRating: number | null;
    issueCount: number;
    issueRate: number | null;
}

export interface HeatmapCell {
    x: string;
    y: number;
    value: number;
}

export interface PeriodStats {
    label: string;
    count: number;
    avgRating: number | null;
    issueCount: number;
    issueRate: number | null;
}

export interface ComparisonResult {
    current: PeriodStats;
    previous: PeriodStats;
    delta: {
        count: number;
        countPct: number | null;
        rating: number | null;
        issueRate: number | null;
    };
}

export interface IngestionStatus {
    totalFiles: number;
    successFiles: number;
    errorFiles: number;
    lastSync: string | null;
    totalRows: number;
    dbPath: string;
}

// ── Helpers ───────────────────────────────────────────────────────

function pct(num: number, total: number): number {
    if (!total) return 0;
    return Math.round((num / total) * 100);
}

function deltaPct(cur: number, prev: number): number | null {
    if (!prev) return null;
    return Math.round(((cur - prev) / prev) * 100);
}

// ── Summary ───────────────────────────────────────────────────────

export function getFeedbackSummary(env: string, days?: number): FeedbackSummary {
    const db = getFeedbackDb();

    const whereClause = days
        ? `WHERE env = ? AND feedback_utc_ts >= date('now', '-${days} days')`
        : `WHERE env = ?`;

    const row = db.prepare(`
        SELECT
            COUNT(*)                                                         AS total,
            AVG(CAST(rating AS REAL))                                        AS avg_rating,
            SUM(CASE WHEN feedback_category = 'issue'    THEN 1 ELSE 0 END) AS issues,
            SUM(CASE WHEN feedback_category = 'support'  THEN 1 ELSE 0 END) AS support,
            SUM(CASE WHEN feedback_category = 'feedback' THEN 1 ELSE 0 END) AS feedback,
            COUNT(DISTINCT app_id)                                           AS unique_apps,
            SUM(CASE WHEN rating >= 5                    THEN 1 ELSE 0 END) AS positive,
            SUM(CASE WHEN rating <= 2                    THEN 1 ELSE 0 END) AS negative,
            SUM(CASE WHEN rating > 2 AND rating < 5      THEN 1 ELSE 0 END) AS neutral,
            MIN(feedback_utc_ts)                                             AS date_from,
            MAX(feedback_utc_ts)                                             AS date_to
        FROM feedback_raw ${whereClause}
    `).get(env) as {
        total: number; avg_rating: number | null; issues: number;
        support: number; feedback: number; unique_apps: number;
        positive: number; negative: number; neutral: number;
        date_from: string | null; date_to: string | null;
    } | undefined;

    return {
        totalFeedback: row?.total ?? 0,
        avgRating: row?.avg_rating != null ? Math.round(row.avg_rating * 10) / 10 : null,
        issueCount: row?.issues ?? 0,
        supportCount: row?.support ?? 0,
        feedbackCount: row?.feedback ?? 0,
        uniqueApps: row?.unique_apps ?? 0,
        positiveCount: row?.positive ?? 0,
        negativeCount: row?.negative ?? 0,
        neutralCount: row?.neutral ?? 0,
        dateRange: { from: row?.date_from ?? null, to: row?.date_to ?? null },
    };
}

// ── Trends ────────────────────────────────────────────────────────

export function getFeedbackTrends(
    env: string,
    granularity: 'day' | 'week' | 'month' = 'day',
    days = 30,
): TrendPoint[] {
    const db = getFeedbackDb();

    const dateTrunc = granularity === 'month'
        ? `strftime('%Y-%m', feedback_utc_ts)`
        : granularity === 'week'
        ? `strftime('%Y-W%W', feedback_utc_ts)`
        : `date(feedback_utc_ts)`;

    const rows = db.prepare(`
        SELECT
            ${dateTrunc}                                                         AS date,
            COUNT(*)                                                             AS count,
            AVG(CAST(rating AS REAL))                                            AS avg_rating,
            SUM(CASE WHEN feedback_category = 'issue'    THEN 1 ELSE 0 END)     AS issue_count,
            SUM(CASE WHEN feedback_category = 'support'  THEN 1 ELSE 0 END)     AS support_count,
            SUM(CASE WHEN feedback_category = 'feedback' THEN 1 ELSE 0 END)     AS feedback_count
        FROM feedback_raw
        WHERE env = ? AND feedback_utc_ts IS NOT NULL
          AND feedback_utc_ts >= date('now', '-${days} days')
        GROUP BY ${dateTrunc}
        ORDER BY date ASC
    `).all(env) as {
        date: string; count: number; avg_rating: number | null;
        issue_count: number; support_count: number; feedback_count: number;
    }[];

    return rows.map(r => ({
        date: r.date,
        count: r.count,
        avgRating: r.avg_rating != null ? Math.round(r.avg_rating * 10) / 10 : null,
        issueCount: r.issue_count,
        supportCount: r.support_count,
        feedbackCount: r.feedback_count,
    }));
}

// ── Rating distribution ───────────────────────────────────────────

export function getRatingDistribution(env: string, appId?: string): RatingBucket[] {
    const db = getFeedbackDb();

    const where = appId
        ? `WHERE env = ? AND app_id = ? AND rating IS NOT NULL`
        : `WHERE env = ? AND rating IS NOT NULL`;
    const params: string[] = appId ? [env, appId] : [env];

    const rows = db.prepare(`
        SELECT rating, COUNT(*) AS count
        FROM feedback_raw ${where}
        GROUP BY rating
        ORDER BY rating ASC
    `).all(...params) as { rating: number; count: number }[];

    const total = rows.reduce((s, r) => s + r.count, 0);
    const map = new Map(rows.map(r => [r.rating, r.count]));

    return Array.from({ length: 7 }, (_, i) => {
        const count = map.get(i + 1) ?? 0;
        return { rating: i + 1, count, pct: pct(count, total) };
    });
}

// ── Category breakdown ────────────────────────────────────────────

export function getCategoryBreakdown(env: string): CategoryBreakdown[] {
    const db = getFeedbackDb();

    const rows = db.prepare(`
        SELECT COALESCE(feedback_category, 'unknown') AS category, COUNT(*) AS count
        FROM feedback_raw
        WHERE env = ?
        GROUP BY feedback_category
        ORDER BY count DESC
    `).all(env) as { category: string; count: number }[];

    const total = rows.reduce((s, r) => s + r.count, 0);
    return rows.map(r => ({
        category: r.category,
        count: r.count,
        pct: pct(r.count, total),
    }));
}

// ── Topic frequency ───────────────────────────────────────────────

export function getTopicFrequency(env: string, topN = 20): TopicEntry[] {
    const db = getFeedbackDb();

    const rows = db.prepare(`
        SELECT feedback_topic_list
        FROM feedback_raw
        WHERE env = ? AND feedback_topic_list IS NOT NULL AND feedback_topic_list != ''
    `).all(env) as { feedback_topic_list: string }[];

    const counts = new Map<string, number>();
    for (const row of rows) {
        try {
            const topics = JSON.parse(row.feedback_topic_list) as unknown;
            if (Array.isArray(topics)) {
                for (const t of topics) {
                    if (typeof t === 'string' && t.trim()) {
                        counts.set(t.trim(), (counts.get(t.trim()) ?? 0) + 1);
                    }
                }
            }
        } catch { /* skip malformed */ }
    }

    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, topN);
    const total = sorted.reduce((s, [, c]) => s + c, 0);
    return sorted.map(([topic, count]) => ({
        topic, count, pct: pct(count, total),
    }));
}

// ── App leaderboard ───────────────────────────────────────────────

export function getAppLeaderboard(env: string, limit = 20): AppEntry[] {
    const db = getFeedbackDb();

    const rows = db.prepare(`
        SELECT
            COALESCE(app_id, '__unknown__')                                  AS app_id,
            COUNT(*)                                                         AS count,
            AVG(CAST(rating AS REAL))                                        AS avg_rating,
            SUM(CASE WHEN feedback_category = 'issue' THEN 1 ELSE 0 END)    AS issue_count
        FROM feedback_raw
        WHERE env = ?
        GROUP BY app_id
        ORDER BY count DESC
        LIMIT ?
    `).all(env, limit) as {
        app_id: string; count: number; avg_rating: number | null; issue_count: number;
    }[];

    return rows.map(r => ({
        appId: r.app_id,
        count: r.count,
        avgRating: r.avg_rating != null ? Math.round(r.avg_rating * 10) / 10 : null,
        issueCount: r.issue_count ?? 0,
        issueRate: pct(r.issue_count, r.count) || null,
    }));
}

// ── Heatmap ───────────────────────────────────────────────────────

export function getFeedbackHeatmap(
    env: string,
    type: 'hour-of-day' | 'day-of-week' = 'hour-of-day',
): HeatmapCell[] {
    const db = getFeedbackDb();

    if (type === 'hour-of-day') {
        const rows = db.prepare(`
            SELECT
                CAST(strftime('%H', feedback_utc_ts) AS INTEGER) AS hour,
                COUNT(*) AS value
            FROM feedback_raw
            WHERE env = ? AND feedback_utc_ts IS NOT NULL
            GROUP BY hour
            ORDER BY hour ASC
        `).all(env) as { hour: number; value: number }[];

        const map = new Map(rows.map(r => [r.hour, r.value]));
        return Array.from({ length: 24 }, (_, h) => ({
            x: `${String(h).padStart(2, '0')}:00`,
            y: h,
            value: map.get(h) ?? 0,
        }));
    }

    const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const rows = db.prepare(`
        SELECT
            CAST(strftime('%w', feedback_utc_ts) AS INTEGER) AS dow,
            COUNT(*) AS value
        FROM feedback_raw
        WHERE env = ? AND feedback_utc_ts IS NOT NULL
        GROUP BY dow
        ORDER BY dow ASC
    `).all(env) as { dow: number; value: number }[];

    const map = new Map(rows.map(r => [r.dow, r.value]));
    return Array.from({ length: 7 }, (_, d) => ({
        x: DOW_LABELS[d] ?? String(d),
        y: d,
        value: map.get(d) ?? 0,
    }));
}

// ── WoW / MoM comparison ─────────────────────────────────────────

export function getWoWComparison(env: string): ComparisonResult {
    const db = getFeedbackDb();

    function weekStats(weekStart: string, weekEnd: string, label: string): PeriodStats {
        const row = db.prepare(`
            SELECT
                COUNT(*) AS count,
                AVG(CAST(rating AS REAL)) AS avg_rating,
                SUM(CASE WHEN feedback_category = 'issue' THEN 1 ELSE 0 END) AS issues
            FROM feedback_raw
            WHERE env = ? AND date(feedback_utc_ts) >= ? AND date(feedback_utc_ts) <= ?
        `).get(env, weekStart, weekEnd) as {
            count: number; avg_rating: number | null; issues: number;
        } | undefined;

        return {
            label,
            count: row?.count ?? 0,
            avgRating: row?.avg_rating != null ? Math.round(row.avg_rating * 10) / 10 : null,
            issueCount: row?.issues ?? 0,
            issueRate: pct(row?.issues ?? 0, row?.count ?? 0) || null,
        };
    }

    const today = new Date();
    const dow = today.getDay();
    const thisMonday = new Date(today);
    thisMonday.setDate(today.getDate() - ((dow + 6) % 7));
    const lastMonday = new Date(thisMonday);
    lastMonday.setDate(thisMonday.getDate() - 7);
    const lastSunday = new Date(thisMonday);
    lastSunday.setDate(thisMonday.getDate() - 1);

    const fmt = (d: Date) => d.toISOString().slice(0, 10);

    const current = weekStats(fmt(thisMonday), fmt(today), `This week (${fmt(thisMonday)})`);
    const previous = weekStats(fmt(lastMonday), fmt(lastSunday), `Last week (${fmt(lastMonday)})`);

    return {
        current, previous,
        delta: {
            count: current.count - previous.count,
            countPct: deltaPct(current.count, previous.count),
            rating: current.avgRating != null && previous.avgRating != null
                ? Math.round((current.avgRating - previous.avgRating) * 10) / 10
                : null,
            issueRate: current.issueRate != null && previous.issueRate != null
                ? current.issueRate - previous.issueRate
                : null,
        },
    };
}

export function getMoMComparison(env: string): ComparisonResult {
    const db = getFeedbackDb();

    function monthStats(yearMonth: string, label: string): PeriodStats {
        const row = db.prepare(`
            SELECT
                COUNT(*) AS count,
                AVG(CAST(rating AS REAL)) AS avg_rating,
                SUM(CASE WHEN feedback_category = 'issue' THEN 1 ELSE 0 END) AS issues
            FROM feedback_raw
            WHERE env = ? AND strftime('%Y-%m', feedback_utc_ts) = ?
        `).get(env, yearMonth) as {
            count: number; avg_rating: number | null; issues: number;
        } | undefined;

        return {
            label,
            count: row?.count ?? 0,
            avgRating: row?.avg_rating != null ? Math.round(row.avg_rating * 10) / 10 : null,
            issueCount: row?.issues ?? 0,
            issueRate: pct(row?.issues ?? 0, row?.count ?? 0) || null,
        };
    }

    const now = new Date();
    const curYM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevYM = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;

    const current = monthStats(curYM, `This month (${curYM})`);
    const previous = monthStats(prevYM, `Last month (${prevYM})`);

    return {
        current, previous,
        delta: {
            count: current.count - previous.count,
            countPct: deltaPct(current.count, previous.count),
            rating: current.avgRating != null && previous.avgRating != null
                ? Math.round((current.avgRating - previous.avgRating) * 10) / 10
                : null,
            issueRate: current.issueRate != null && previous.issueRate != null
                ? current.issueRate - previous.issueRate
                : null,
        },
    };
}

// ── Recent feedback rows ──────────────────────────────────────────

export interface FeedbackRow {
    feedback_id: string;
    data_source: string | null;
    app_id: string | null;
    customer_id: string | null;
    feedback_utc_ts: string | null;
    feedback_text: string | null;
    rating: number | null;
    feedback_category: string | null;
    feedback_topic_list: string | null;
    plan_type_name: string | null;
    subscription_id: string | null;
    subscription_status: string | null;
    total_credit_cnt: number | null;
    available_credit_cnt: number | null;
    feedback_origin_name: string | null;
    app_publish_flag: number | null;
    publish_url: string | null;
    cln_create_utc_ts: string | null;
    full_story_url: string | null;
    shopper_id: string | null;
    device_type: string | null;
    browser_type: string | null;
    page_url: string | null;
    session_id: string | null;
    app_name: string | null;
    app_version: string | null;
}

const SORTABLE_COLS: Record<string, string> = {
    feedback_utc_ts:      'feedback_utc_ts',
    rating:               'rating',
    app_id:               'app_id',
    plan_type_name:       'plan_type_name',
    feedback_category:    'feedback_category',
    feedback_origin_name: 'feedback_origin_name',
    device_type:          'device_type',
    subscription_status:  'subscription_status',
    cln_create_utc_ts:    'cln_create_utc_ts',
};

export function getRecentFeedback(
    env: string,
    limit = 50,
    offset = 0,
    filters?: { category?: string; rating?: number; appId?: string; days?: number },
    sort?: { col: string; dir: 'asc' | 'desc' },
): { rows: FeedbackRow[]; total: number } {
    const db = getFeedbackDb();

    const conditions: string[] = ['env = ?'];
    const params: (string | number)[] = [env];

    if (filters?.category) { conditions.push('feedback_category = ?'); params.push(filters.category); }
    if (filters?.rating)   { conditions.push('rating = ?');            params.push(filters.rating); }
    if (filters?.appId)    { conditions.push('app_id = ?');            params.push(filters.appId); }
    if (filters?.days)     { conditions.push(`feedback_utc_ts >= date('now', '-${filters.days} days')`); }

    const where = `WHERE ${conditions.join(' AND ')}`;
    const safeCol = (sort?.col && SORTABLE_COLS[sort.col]) ?? 'feedback_utc_ts';
    const safeDir = sort?.dir === 'asc' ? 'ASC' : 'DESC';

    const total = (db.prepare(`SELECT COUNT(*) AS c FROM feedback_raw ${where}`).get(...params) as { c: number }).c;

    const rows = db.prepare(`
        SELECT feedback_id, data_source, app_id, customer_id, feedback_utc_ts, feedback_text,
               rating, feedback_category, feedback_topic_list,
               plan_type_name, subscription_id, subscription_status,
               total_credit_cnt, available_credit_cnt,
               feedback_origin_name, app_publish_flag, publish_url, cln_create_utc_ts,
               full_story_url, shopper_id,
               device_type, browser_type, page_url, session_id, app_name, app_version
        FROM feedback_raw ${where}
        ORDER BY ${safeCol} ${safeDir}
        LIMIT ? OFFSET ?
    `).all(...params, limit, offset) as FeedbackRow[];

    return { rows, total };
}

// ── Ingestion status ──────────────────────────────────────────────

export function getFeedbackIngestionStatus(): IngestionStatus {
    const db = getFeedbackDb();

    const row = db.prepare(`
        SELECT
            COUNT(*) AS total,
            SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS success,
            SUM(CASE WHEN status = 'error'   THEN 1 ELSE 0 END) AS errors,
            MAX(ingested_at) AS last_sync,
            SUM(CASE WHEN status = 'success' THEN COALESCE(rows_written, 0) ELSE 0 END) AS total_rows
        FROM ingestion_log
    `).get() as {
        total: number; success: number; errors: number;
        last_sync: string | null; total_rows: number;
    } | undefined;

    return {
        totalFiles: row?.total ?? 0,
        successFiles: row?.success ?? 0,
        errorFiles: row?.errors ?? 0,
        lastSync: row?.last_sync ?? null,
        totalRows: row?.total_rows ?? 0,
        dbPath: dbPath(),
    };
}

// ── Source-table upserts (called from ingest) ────────────────────

// Athena source: 18 positional params matching feedback_athena columns.
const INSERT_ATHENA_SQL = `
    INSERT INTO feedback_athena (
        feedback_id, env, app_id, customer_id, feedback_utc_ts, rating, feedback_text,
        consent_flag, plan_type_name, subscription_id, subscription_status,
        total_credit_cnt, available_credit_cnt, feedback_topic_list, feedback_origin_name,
        app_publish_flag, publish_url, cln_create_utc_ts
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(feedback_id) DO NOTHING
`;

// S3 source: 29 positional params matching feedback_s3 columns.
// Re-ingest of the same file updates enrichment fields via COALESCE (never nulls out existing data).
const INSERT_S3_SQL = `
    INSERT INTO feedback_s3 (
        feedback_id, env, app_id, customer_id, feedback_utc_ts, rating, feedback_text,
        consent_flag, plan_type_name, subscription_id, subscription_status,
        total_credit_cnt, available_credit_cnt, feedback_topic_list, feedback_origin_name,
        feedback_category, app_publish_flag, full_story_url, shopper_id, experiments_line,
        publish_url, cln_create_utc_ts, s3_url,
        device_type, browser_type, page_url, session_id, app_name, app_version
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(feedback_id) DO UPDATE SET
        feedback_category = COALESCE(excluded.feedback_category, feedback_category),
        full_story_url    = COALESCE(excluded.full_story_url,    full_story_url),
        shopper_id        = COALESCE(excluded.shopper_id,        shopper_id),
        experiments_line  = COALESCE(excluded.experiments_line,  experiments_line),
        device_type       = COALESCE(excluded.device_type,       device_type),
        browser_type      = COALESCE(excluded.browser_type,      browser_type),
        page_url          = COALESCE(excluded.page_url,          page_url),
        session_id        = COALESCE(excluded.session_id,        session_id),
        app_name          = COALESCE(excluded.app_name,          app_name),
        app_version       = COALESCE(excluded.app_version,       app_version),
        s3_url            = COALESCE(excluded.s3_url,            s3_url)
`;

const UPSERT_LOG_SUCCESS_SQL = `
    INSERT INTO ingestion_log (s3_url, source, status, rows_written)
    VALUES (?, ?, 'success', ?)
    ON CONFLICT(s3_url) DO UPDATE SET
        source       = excluded.source,
        status       = excluded.status,
        rows_written = excluded.rows_written,
        ingested_at  = CURRENT_TIMESTAMP
`;

const UPSERT_LOG_ERROR_SQL = `
    INSERT INTO ingestion_log (s3_url, source, status, error_msg)
    VALUES (?, ?, 'error', ?)
    ON CONFLICT(s3_url) DO UPDATE SET
        source      = excluded.source,
        status      = excluded.status,
        error_msg   = excluded.error_msg,
        ingested_at = CURRENT_TIMESTAMP
`;

export function insertFeedbackAthenaRow(params: unknown[]): number {
    const db = getFeedbackDb();
    const result = db.prepare(INSERT_ATHENA_SQL).run(...params);
    if (result.changes > 0) scheduleUpload(dbPath(), 'feedback_analytics.db');
    return result.changes;
}

export function insertFeedbackS3Row(params: unknown[]): number {
    const db = getFeedbackDb();
    const result = db.prepare(INSERT_S3_SQL).run(...params);
    if (result.changes > 0) scheduleUpload(dbPath(), 'feedback_analytics.db');
    return result.changes;
}

// ── Full data clear (force resync) ───────────────────────────────

export function clearFeedbackData(env: string): void {
    const db = getFeedbackDb();
    db.transaction(() => {
        db.prepare('DELETE FROM feedback_s3      WHERE env = ?').run(env);
        db.prepare('DELETE FROM feedback_athena  WHERE env = ?').run(env);
        db.prepare('DELETE FROM feedback_raw     WHERE env = ?').run(env);
        db.prepare('DELETE FROM daily_stats      WHERE env = ?').run(env);
        db.prepare('DELETE FROM ingestion_log').run();
    })();
}

// ── Composite rebuild ─────────────────────────────────────────────

export function rebuildFeedbackComposite(env: string): number {
    const db = getFeedbackDb();

    db.transaction(() => {
        db.prepare('DELETE FROM feedback_raw WHERE env = ?').run(env);

        db.prepare(`
            INSERT INTO feedback_raw (
                feedback_id, env, data_source,
                app_id, customer_id, feedback_utc_ts, rating, feedback_text,
                consent_flag, plan_type_name, subscription_id, subscription_status,
                total_credit_cnt, available_credit_cnt, feedback_topic_list, feedback_origin_name,
                feedback_category, app_publish_flag, full_story_url, shopper_id, experiments_line,
                publish_url, cln_create_utc_ts, s3_url,
                device_type, browser_type, page_url, session_id, app_name, app_version
            )
            SELECT
                a.feedback_id,
                a.env,
                CASE WHEN s.feedback_id IS NOT NULL THEN 'both' ELSE 'athena' END,
                COALESCE(a.app_id,               s.app_id),
                COALESCE(a.customer_id,          s.customer_id),
                COALESCE(a.feedback_utc_ts,      s.feedback_utc_ts),
                COALESCE(a.rating,               s.rating),
                COALESCE(a.feedback_text,        s.feedback_text),
                COALESCE(a.consent_flag,         s.consent_flag),
                COALESCE(a.plan_type_name,       s.plan_type_name),
                COALESCE(a.subscription_id,      s.subscription_id),
                COALESCE(a.subscription_status,  s.subscription_status),
                COALESCE(a.total_credit_cnt,     s.total_credit_cnt),
                COALESCE(a.available_credit_cnt, s.available_credit_cnt),
                COALESCE(a.feedback_topic_list,  s.feedback_topic_list),
                COALESCE(a.feedback_origin_name, s.feedback_origin_name),
                s.feedback_category,
                COALESCE(a.app_publish_flag,     s.app_publish_flag),
                s.full_story_url,
                s.shopper_id,
                s.experiments_line,
                COALESCE(a.publish_url,          s.publish_url),
                COALESCE(a.cln_create_utc_ts,    s.cln_create_utc_ts),
                s.s3_url,
                s.device_type,
                s.browser_type,
                s.page_url,
                s.session_id,
                s.app_name,
                s.app_version
            FROM feedback_athena a
            LEFT JOIN feedback_s3 s ON a.feedback_id = s.feedback_id
            WHERE a.env = ?
        `).run(env);

        db.prepare(`
            INSERT INTO feedback_raw (
                feedback_id, env, data_source,
                app_id, customer_id, feedback_utc_ts, rating, feedback_text,
                consent_flag, plan_type_name, subscription_id, subscription_status,
                total_credit_cnt, available_credit_cnt, feedback_topic_list, feedback_origin_name,
                feedback_category, app_publish_flag, full_story_url, shopper_id, experiments_line,
                publish_url, cln_create_utc_ts, s3_url,
                device_type, browser_type, page_url, session_id, app_name, app_version
            )
            SELECT
                s.feedback_id, s.env, 's3',
                s.app_id, s.customer_id, s.feedback_utc_ts, s.rating, s.feedback_text,
                s.consent_flag, s.plan_type_name, s.subscription_id, s.subscription_status,
                s.total_credit_cnt, s.available_credit_cnt, s.feedback_topic_list,
                s.feedback_origin_name, s.feedback_category, s.app_publish_flag,
                s.full_story_url, s.shopper_id, s.experiments_line,
                s.publish_url, s.cln_create_utc_ts, s.s3_url,
                s.device_type, s.browser_type, s.page_url, s.session_id, s.app_name, s.app_version
            FROM feedback_s3 s
            WHERE s.env = ?
              AND NOT EXISTS (SELECT 1 FROM feedback_athena a WHERE a.feedback_id = s.feedback_id)
        `).run(env);
    })();

    scheduleUpload(dbPath(), 'feedback_analytics.db');
    return (db.prepare('SELECT COUNT(*) AS c FROM feedback_raw WHERE env = ?').get(env) as { c: number }).c;
}

export function logIngestionSuccess(s3Url: string, source: string, rowsWritten: number): void {
    getFeedbackDb().prepare(UPSERT_LOG_SUCCESS_SQL).run(s3Url, source, rowsWritten);

    // Schedule S3 backup after write
    scheduleUpload(dbPath(), 'feedback_analytics.db');
}

export function logIngestionError(s3Url: string, source: string, errorMsg: string): void {
    getFeedbackDb().prepare(UPSERT_LOG_ERROR_SQL).run(s3Url, source, errorMsg);

    // Schedule S3 backup after write
    scheduleUpload(dbPath(), 'feedback_analytics.db');
}

export function getAlreadyIngestedKeys(): Set<string> {
    const db = getFeedbackDb();
    const rows = db.prepare(`SELECT s3_url FROM ingestion_log WHERE status = 'success'`).all() as { s3_url: string }[];
    return new Set(rows.map(r => r.s3_url));
}

// ── Data coverage ─────────────────────────────────────────────────

export interface DataCoverage {
    earliest: string | null;
    latest: string | null;
    totalRows: number;
    monthsCovered: string[];
    athenaRows: number;
    s3OnlyRows: number;
    bothRows: number;
}

export function getDataCoverage(env: string): DataCoverage {
    const db = getFeedbackDb();

    const row = db.prepare(`
        SELECT MIN(feedback_utc_ts) AS earliest, MAX(feedback_utc_ts) AS latest, COUNT(*) AS total
        FROM feedback_raw WHERE env = ?
    `).get(env) as { earliest: string | null; latest: string | null; total: number } | undefined;

    const months = db.prepare(`
        SELECT DISTINCT strftime('%Y-%m', feedback_utc_ts) AS ym
        FROM feedback_raw
        WHERE env = ? AND feedback_utc_ts IS NOT NULL
        ORDER BY ym ASC
    `).all(env) as { ym: string }[];

    const srcCounts = db.prepare(`
        SELECT data_source,
               COUNT(*) AS cnt
        FROM feedback_raw WHERE env = ?
        GROUP BY data_source
    `).all(env) as { data_source: string; cnt: number }[];

    const srcMap = new Map(srcCounts.map(r => [r.data_source, r.cnt]));

    return {
        earliest: row?.earliest ?? null,
        latest: row?.latest ?? null,
        totalRows: row?.total ?? 0,
        monthsCovered: months.map(m => m.ym),
        athenaRows: (srcMap.get('athena') ?? 0) + (srcMap.get('both') ?? 0),
        s3OnlyRows: srcMap.get('s3') ?? 0,
        bothRows: srcMap.get('both') ?? 0,
    };
}

// ── Ingestion log ─────────────────────────────────────────────────

export interface IngestionLogEntry {
    id: number;
    s3_url: string;
    source: string;
    status: string;
    rows_written: number;
    error_msg: string | null;
    ingested_at: string;
}

export function getIngestionLog(limit = 100): IngestionLogEntry[] {
    const db = getFeedbackDb();
    return db.prepare(`
        SELECT id, s3_url, source, status, rows_written, error_msg, ingested_at
        FROM ingestion_log
        ORDER BY ingested_at DESC
        LIMIT ?
    `).all(limit) as IngestionLogEntry[];
}

export function recomputeDailyStats(env: string, dates?: string[]): void {
    const db = getFeedbackDb();
    const dateList = dates?.length ? dates.map(d => `'${d}'`).join(',') : null;

    if (dateList) {
        db.prepare(`DELETE FROM daily_stats WHERE env = ? AND date IN (${dateList})`).run(env);
    } else {
        db.prepare(`DELETE FROM daily_stats WHERE env = ?`).run(env);
    }

    const whereExtra = dateList
        ? `AND date(feedback_utc_ts) IN (${dateList})`
        : '';

    db.prepare(`
        INSERT INTO daily_stats
            (date, env, app_id, total_count, avg_rating, issue_count, support_count, feedback_count, consent_count)
        SELECT
            date(feedback_utc_ts)                                                  AS date,
            env,
            COALESCE(app_id, '__unknown__')                                        AS app_id,
            COUNT(*)                                                               AS total_count,
            AVG(CAST(rating AS REAL))                                              AS avg_rating,
            SUM(CASE WHEN feedback_category = 'issue'    THEN 1 ELSE 0 END)       AS issue_count,
            SUM(CASE WHEN feedback_category = 'support'  THEN 1 ELSE 0 END)       AS support_count,
            SUM(CASE WHEN feedback_category = 'feedback' THEN 1 ELSE 0 END)       AS feedback_count,
            SUM(CASE WHEN consent_flag = 1               THEN 1 ELSE 0 END)       AS consent_count
        FROM feedback_raw
        WHERE env = ? AND feedback_utc_ts IS NOT NULL ${whereExtra}
        GROUP BY date(feedback_utc_ts), env, COALESCE(app_id, '__unknown__')
        ON CONFLICT(date, env, app_id) DO UPDATE SET
            total_count    = excluded.total_count,
            avg_rating     = excluded.avg_rating,
            issue_count    = excluded.issue_count,
            support_count  = excluded.support_count,
            feedback_count = excluded.feedback_count,
            consent_count  = excluded.consent_count
    `).run(env);
}
