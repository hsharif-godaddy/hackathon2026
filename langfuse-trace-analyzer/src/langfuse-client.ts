import type { Config } from './config.js';

export interface MetricsQuery {
  view: 'observations' | 'traces';
  dimensions: Array<{ field: string }>;
  metrics: Array<{ measure: string; aggregation: string }>;
  filters?: Array<{ column: string; operator: string; value: unknown; type?: string }>;
  fromTimestamp: string;
  toTimestamp: string;
  orderBy?: Array<{ field: string; direction: 'asc' | 'desc' }>;
}

export interface MetricsRow {
  [key: string]: string | number | null;
}

export interface MetricsResponse {
  data: MetricsRow[];
  meta: Array<{ name: string; type: string }>;
}

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;
const DEBUG = process.env['DEBUG'] === 'true' || process.env['DEBUG'] === '1';

async function sleep(ms: number): Promise<void> {
  return new Promise(function resolve(r) { setTimeout(r, ms); });
}

function isTransientError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return /ECONNRESET|ETIMEDOUT|ENOTFOUND|UND_ERR_CONNECT_TIMEOUT|fetch failed/i.test(err.message);
}

export function create(config: Config) {
  const auth = Buffer.from(
    `${config.langfuse.publicKey}:${config.langfuse.secretKey}`
  ).toString('base64');

  return async function query(q: MetricsQuery): Promise<MetricsResponse> {
    const queryJson = JSON.stringify(q);
    const url = `${config.langfuse.baseUrl}/api/public/metrics?query=${encodeURIComponent(queryJson)}`;

    if (DEBUG) {
      console.log("    curl -G --data-urlencode 'query=%s' '%s/api/public/metrics'", queryJson, config.langfuse.baseUrl);
    }

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      let response: Response;
      try {
        response = await fetch(url, {
          method: 'GET',
          headers: {
            Authorization: `Basic ${auth}`,
            Accept: 'application/json',
          },
        });
      } catch (err) {
        if (isTransientError(err) && attempt < MAX_RETRIES) {
          console.warn('Langfuse fetch failed (attempt %d/%d): %s', attempt, MAX_RETRIES,
            err instanceof Error ? err.message : err);
          await sleep(RETRY_DELAY_MS * attempt);
          continue;
        }
        throw err;
      }

      if (response.ok) {
        let result: MetricsResponse;
        try {
          result = (await response.json()) as MetricsResponse;
        } catch {
          const text = await response.text().catch(function fallback() { return '(unreadable)'; });
          throw new Error(`Langfuse API returned non-JSON 200: ${text.slice(0, 200)}`);
        }
        if (!Array.isArray(result.data)) {
          throw new Error(`Langfuse API response missing 'data' field: ${JSON.stringify(result).slice(0, 200)}`);
        }
        console.log('    => %d rows', result.data.length);
        if (DEBUG && result.data.length > 0) {
          console.log('    => sample: %s', JSON.stringify(result.data[0]));
        }
        return result;
      }

      const body = await response.text();

      if (response.status >= 500 && attempt < MAX_RETRIES) {
        console.warn('Langfuse API returned %d, retrying (%d/%d)...', response.status, attempt, MAX_RETRIES);
        await sleep(RETRY_DELAY_MS * attempt);
        continue;
      }

      throw new Error(`Langfuse Metrics API error ${response.status}: ${body}`);
    }

    throw new Error('Exhausted retries for Langfuse Metrics API');
  };
}
