// SERVER-ONLY: reads CLICKHOUSE_* secrets.

import { Buffer } from 'node:buffer';

function normalizeBaseUrl(raw: string): string {
  const t = raw.trim().replace(/\/$/, '');
  if (t.startsWith('http://') || t.startsWith('https://')) return t;
  return `https://${t}`;
}

export function getClickHouseC1Config(): { url: string; user: string; password: string } | null {
  const host = process.env.CLICKHOUSE_HOST?.trim();
  const user = process.env.CLICKHOUSE_USER?.trim();
  if (!host || !user) return null;
  return {
    url: normalizeBaseUrl(host),
    user,
    password: process.env.CLICKHOUSE_PASSWORD ?? '',
  };
}

type ChJsonRow = Record<string, unknown>;

interface ChJsonBody {
  data?: ChJsonRow[];
}

export async function c1Query<T extends ChJsonRow = ChJsonRow>(sql: string, params: Record<string, string> = {}): Promise<T[]> {
  const c = getClickHouseC1Config();
  if (!c) {
    throw new Error('ClickHouse host not configured');
  }

  const qs = new URLSearchParams({ default_format: 'JSON' });
  for (const [k, v] of Object.entries(params)) qs.set(`param_${k}`, v);
  const url = `${c.url}/?${qs.toString()}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${c.user}:${c.password}`).toString('base64')}`,
      'Content-Type': 'text/plain; charset=utf-8',
    },
    body: sql,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ClickHouse ${res.status}: ${text.slice(0, 400)}`);
  }

  const json = (await res.json()) as ChJsonBody;
  return Array.isArray(json.data) ? (json.data as T[]) : [];
}

export function chFirstNumber(row: ChJsonRow | undefined, keys: string[]): number {
  if (!row) return 0;
  for (const k of keys) {
    const v = row[k];
    if (typeof v === 'number' && !Number.isNaN(v)) return v;
    if (typeof v === 'string' && v !== '') {
      const n = Number(v);
      if (!Number.isNaN(n)) return n;
    }
  }
  return 0;
}
