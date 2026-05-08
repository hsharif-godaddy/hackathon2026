import { Buffer } from 'node:buffer';

const IDENTIFIER_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const INSIGHT_RAW_MAX_CHARS = 200_000;

function normalizeBaseUrl(raw: string): string {
  const t = raw.trim().replace(/\/$/, '');
  if (t.startsWith('http://') || t.startsWith('https://')) return t;
  return `https://${t}`;
}

function validIdentifier(segment: string | undefined): segment is string {
  return typeof segment === 'string' && segment.length > 0 && IDENTIFIER_PATTERN.test(segment);
}

export interface ClickHouseInsightsFeedbackConfig {
  baseUrl: string;
  user: string;
  password: string;
  database: string;
  table: string;
}

export function getClickHouseInsightsFeedbackConfig(): ClickHouseInsightsFeedbackConfig | null {
  const host = process.env.CLICKHOUSE_HOST?.trim();
  const user = process.env.CLICKHOUSE_USER?.trim();
  const database = process.env.CLICKHOUSE_DATABASE?.trim();
  const table = process.env.CLICKHOUSE_INSIGHTS_FEEDBACK_TABLE?.trim();
  if (!host || !user || !validIdentifier(database) || !validIdentifier(table)) return null;

  return {
    baseUrl: normalizeBaseUrl(host),
    user,
    password: process.env.CLICKHOUSE_PASSWORD ?? '',
    database,
    table,
  };
}

export interface InsightsFeedbackClickHouseRow {
  feedback_id: string;
  submitted_at: string;
  vote: string;
  app_id: string | null;
  page_host_id: string | null;
  insight_kind: string;
  insight_title: string | null;
  insight_body: string | null;
  partition_snap_date: string | null;
  insight_raw: string;
  customer_id: string | null;
}

function formatSubmittedAt(now: Date): string {
  return now.toISOString().replace('T', ' ').replace('Z', '');
}

function stringifyTruncatedInsightRaw(fullJson: string): string {
  let low = 0;
  let high = fullJson.length;
  let best = JSON.stringify({ truncated: true, prefix: '' });
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const candidate = JSON.stringify({ truncated: true, prefix: fullJson.slice(0, mid) });
    if (candidate.length <= INSIGHT_RAW_MAX_CHARS) {
      best = candidate;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return best;
}

function stringifyRaw(raw: unknown): string {
  try {
    const s = JSON.stringify(raw ?? null);
    if (s.length <= INSIGHT_RAW_MAX_CHARS) return s;
    return stringifyTruncatedInsightRaw(s);
  } catch {
    return 'null';
  }
}

export function buildInsightsFeedbackRow(input: {
  feedbackId: string;
  submittedAt?: Date;
  vote: string;
  appId: string | null;
  pageHostId: string | null;
  insightKind: string;
  insightTitle: string | null;
  insightBody: string | null;
  partitionSnapDate: string | null;
  insightRaw: unknown;
  customerId: string | null;
}): InsightsFeedbackClickHouseRow {
  const now = input.submittedAt ?? new Date();
  return {
    feedback_id: input.feedbackId,
    submitted_at: formatSubmittedAt(now),
    vote: input.vote,
    app_id: input.appId,
    page_host_id: input.pageHostId,
    insight_kind: input.insightKind,
    insight_title: input.insightTitle,
    insight_body: input.insightBody,
    partition_snap_date: input.partitionSnapDate,
    insight_raw: stringifyRaw(input.insightRaw),
    customer_id: input.customerId,
  };
}

export async function insertInsightsFeedbackRow(
  row: InsightsFeedbackClickHouseRow,
  config: ClickHouseInsightsFeedbackConfig,
): Promise<void> {
  const fullTable = `${config.database}.${config.table}`;
  const insertQuery = `INSERT INTO ${fullTable} FORMAT JSONEachRow`;

  const url = `${config.baseUrl}/?${new URLSearchParams({ query: insertQuery }).toString()}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${config.user}:${config.password}`).toString('base64')}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: `${JSON.stringify(row)}\n`,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ClickHouse HTTP ${res.status}: ${text.slice(0, 500)}`);
  }
}
