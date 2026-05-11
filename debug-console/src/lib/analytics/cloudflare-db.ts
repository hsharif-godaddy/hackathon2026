import type { estypes } from '@elastic/elasticsearch';

import { pdnaClient, PDNA_CLOUDFLARE_INDEX } from './pdna-client';

type AggMap = Record<string, estypes.AggregationsAggregationContainer>;

/**
 * Cloudflare CDN logs live on the same PDNA ES cluster. One doc per
 * request across every airoapp-served domain (customer custom domains
 * + preview/publish subdomains). ECS-ish schema — see
 * debug-console/scripts/check-cloudflare-cdn.ts for a field dump.
 *
 * The primary timestamp is `event_timestamp` (date, epoch-ms) — NOT
 * `@timestamp`. Ranges throughout this file use numeric millisecond
 * bounds to keep ES happy.
 */

export type CloudflareBucketInterval = '5m' | '15m' | '1h' | '1d';

export interface CloudflareTerm { key: string; count: number }
export interface CloudflareDailyPoint { date: string; count: number }
export interface CloudflareStatusPoint { date: string; c2xx: number; c3xx: number; c4xx: number; c5xx: number; cOther: number }
export interface CloudflareLatencyPoint { date: string; p50Ms: number | null; p95Ms: number | null }

export interface CloudflareOverview {
    totalRequests: number;
    uniqueDomains: number;
    uniqueClients: number;
    sumBytes: number;
    p50Ms: number | null;
    p95Ms: number | null;
    requestsDaily: CloudflareDailyPoint[];
    statusClassDaily: CloudflareStatusPoint[];
    latencyDaily: CloudflareLatencyPoint[];
    cacheResult: CloudflareTerm[];
    methods: CloudflareTerm[];
    topDomains: CloudflareTerm[];
    topColos: CloudflareTerm[];
    securityActions: CloudflareTerm[];
}

export interface CloudflareAppTraffic extends CloudflareOverview {
    /**
     * One entry per caller-supplied domain, in input order. Zero-traffic
     * domains are backfilled so the UI can rely on a stable row count —
     * do not skip zero entries when refactoring.
     */
    perDomainBreakdown: CloudflareTerm[];
}

/**
 * Painless script that maps status_code → "2xx"/"3xx"/"4xx"/"5xx" bucket
 * key. 1xx and anything outside 200–599 is lumped into "other" so the
 * four-series stacked chart stays total-accurate.
 */
const STATUS_CLASS_SCRIPT = "def sc = doc['http.response.status_code'].size() > 0 ? (int)(doc['http.response.status_code'].value / 100) : -1; return sc >= 2 && sc < 6 ? String.valueOf(sc) + 'xx' : 'other';";

interface EsDateHistogramBucket { key_as_string: string; key: number; doc_count: number }

/**
 * Shared aggregation block — both overview + per-app share the same shape.
 * `extended_bounds` is required: without it, ES only emits empty buckets
 * *between* the first and last observed document, so edges of the query
 * range silently clip when traffic is sparse there.
 */
function buildAggs(bucketInterval: CloudflareBucketInterval, startMs: number, endMs: number): AggMap {
    return {
        unique_domains: { cardinality: { field: 'url.domain.keyword' } },
        unique_clients: { cardinality: { field: 'client.ip' } },
        sum_bytes: { sum: { field: 'http.response.bytes' } },
        latency: { percentiles: { field: 'total_session_time', percents: [50, 95] } },
        cache_result: { terms: { field: 'cache_result', size: 10 } },
        methods: { terms: { field: 'http.request.method', size: 6 } },
        top_domains: { terms: { field: 'url.domain.keyword', size: 15 } },
        top_colos: { terms: { field: 'edge.colo.code', size: 10 } },
        security_actions: { terms: { field: 'security.action', size: 10 } },
        requests_by_time: {
            date_histogram: {
                field: 'event_timestamp',
                fixed_interval: bucketInterval,
                min_doc_count: 0,
                extended_bounds: { min: startMs, max: endMs },
            },
            aggs: {
                by_status: {
                    terms: { script: { source: STATUS_CLASS_SCRIPT, lang: 'painless' }, size: 6 },
                },
                latency: { percentiles: { field: 'total_session_time', percents: [50, 95] } },
            },
        },
    };
}

interface AggsShape {
    unique_domains?: { value?: number };
    unique_clients?: { value?: number };
    sum_bytes?: { value?: number };
    // ES percentile agg keys are stringified floats: '50.0', '95.0' (not '50' / 'p50').
    latency?: { values?: Record<string, number | null> };
    cache_result?: { buckets?: Array<{ key: string; doc_count: number }> };
    methods?: { buckets?: Array<{ key: string; doc_count: number }> };
    top_domains?: { buckets?: Array<{ key: string; doc_count: number }> };
    top_colos?: { buckets?: Array<{ key: string; doc_count: number }> };
    security_actions?: { buckets?: Array<{ key: string; doc_count: number }> };
    requests_by_time?: {
        buckets?: Array<EsDateHistogramBucket & {
            by_status?: { buckets?: Array<{ key: string; doc_count: number }> };
            latency?: { values?: Record<string, number | null> };
        }>;
    };
    per_domain?: { buckets?: Array<{ key: string; doc_count: number }> };
}

function mapTermBuckets(b?: Array<{ key: string; doc_count: number }>): CloudflareTerm[] {
    return (b ?? []).map(x => ({ key: x.key, count: x.doc_count }));
}

function extractOverviewFromAggs(aggs: AggsShape, totalRequests: number): CloudflareOverview {
    // Structural guard: a malformed ES response would silently fall
    // through every `?? 0 / ?? []` fallback and return a valid-looking
    // all-zero shape, making a parser bug look like "no traffic" to the
    // dashboard user. Fail loudly instead — the API route converts
    // thrown errors into HTTP 500 with a readable message.
    if (!Array.isArray(aggs.requests_by_time?.buckets)) {
        throw new Error('Cloudflare aggregation response is missing requests_by_time.buckets');
    }

    const latencyGlobal = aggs.latency?.values ?? {};
    const requestsDaily: CloudflareDailyPoint[] = [];
    const statusClassDaily: CloudflareStatusPoint[] = [];
    const latencyDaily: CloudflareLatencyPoint[] = [];
    for (const b of aggs.requests_by_time.buckets) {
        const date = b.key_as_string;
        requestsDaily.push({ date, count: b.doc_count });
        const byStatus = Object.fromEntries((b.by_status?.buckets ?? []).map(x => [x.key, x.doc_count]));
        statusClassDaily.push({
            date,
            c2xx: byStatus['2xx'] ?? 0,
            c3xx: byStatus['3xx'] ?? 0,
            c4xx: byStatus['4xx'] ?? 0,
            c5xx: byStatus['5xx'] ?? 0,
            cOther: byStatus['other'] ?? 0,
        });
        const lv = b.latency?.values ?? {};
        latencyDaily.push({
            date,
            p50Ms: typeof lv['50.0'] === 'number' ? lv['50.0'] : null,
            p95Ms: typeof lv['95.0'] === 'number' ? lv['95.0'] : null,
        });
    }
    return {
        totalRequests,
        uniqueDomains: aggs.unique_domains?.value ?? 0,
        uniqueClients: aggs.unique_clients?.value ?? 0,
        sumBytes: aggs.sum_bytes?.value ?? 0,
        p50Ms: typeof latencyGlobal['50.0'] === 'number' ? latencyGlobal['50.0'] : null,
        p95Ms: typeof latencyGlobal['95.0'] === 'number' ? latencyGlobal['95.0'] : null,
        requestsDaily,
        statusClassDaily,
        latencyDaily,
        cacheResult: mapTermBuckets(aggs.cache_result?.buckets),
        methods: mapTermBuckets(aggs.methods?.buckets),
        topDomains: mapTermBuckets(aggs.top_domains?.buckets),
        topColos: mapTermBuckets(aggs.top_colos?.buckets),
        securityActions: mapTermBuckets(aggs.security_actions?.buckets),
    };
}

export async function getCloudflareOverview(opts: {
    startMs: number;
    endMs: number;
    bucketInterval: CloudflareBucketInterval;
}): Promise<CloudflareOverview | null> {
    if (!pdnaClient) return null;

    const result = await pdnaClient.search({
        index: PDNA_CLOUDFLARE_INDEX,
        size: 0,
        body: {
            query: {
                bool: {
                    filter: [{ range: { event_timestamp: { gte: opts.startMs, lte: opts.endMs } } }],
                },
            },
            track_total_hits: true,
            aggs: buildAggs(opts.bucketInterval, opts.startMs, opts.endMs),
        },
    });

    const total = typeof result.hits.total === 'number'
        ? result.hits.total
        : (result.hits.total as { value?: number } | undefined)?.value ?? 0;
    return extractOverviewFromAggs((result.aggregations ?? {}) as AggsShape, total);
}

export async function getCloudflareAppTraffic(opts: {
    domains: string[];
    startMs: number;
    endMs: number;
    bucketInterval: CloudflareBucketInterval;
}): Promise<CloudflareAppTraffic | null> {
    if (!pdnaClient) return null;
    if (opts.domains.length === 0) {
        // Empty-domain short-circuit: return an all-zero shape so the UI
        // can distinguish "no app loaded" (null from the caller) vs
        // "app has no domains attached" (zeros with empty breakdown).
        return {
            totalRequests: 0, uniqueDomains: 0, uniqueClients: 0, sumBytes: 0,
            p50Ms: null, p95Ms: null,
            requestsDaily: [], statusClassDaily: [], latencyDaily: [],
            cacheResult: [], methods: [], topDomains: [], topColos: [], securityActions: [],
            perDomainBreakdown: [],
        };
    }

    const aggs = buildAggs(opts.bucketInterval, opts.startMs, opts.endMs);
    // Extra breakdown: one bar per caller-supplied domain. Uses
    // `include` so domains that didn't see any traffic still appear in
    // the buckets list (as long as the terms match anything in the
    // filtered slice) — terms agg filters the doc set first, so domains
    // with zero hits will simply be missing; the UI backfills to keep
    // the 1:1 mapping with `opts.domains`.
    aggs.per_domain = {
        terms: {
            field: 'url.domain.keyword',
            size: Math.max(opts.domains.length, 1),
            include: opts.domains,
        },
    };

    const result = await pdnaClient.search({
        index: PDNA_CLOUDFLARE_INDEX,
        size: 0,
        body: {
            query: {
                bool: {
                    filter: [
                        { range: { event_timestamp: { gte: opts.startMs, lte: opts.endMs } } },
                        { terms: { 'url.domain.keyword': opts.domains } },
                    ],
                },
            },
            track_total_hits: true,
            aggs,
        },
    });

    const total = typeof result.hits.total === 'number'
        ? result.hits.total
        : (result.hits.total as { value?: number } | undefined)?.value ?? 0;
    const raw = (result.aggregations ?? {}) as AggsShape;
    const overview = extractOverviewFromAggs(raw, total);

    const perDomainMap = new Map(mapTermBuckets(raw.per_domain?.buckets).map(t => [t.key, t.count]));
    const perDomainBreakdown: CloudflareTerm[] = opts.domains.map(d => ({
        key: d,
        count: perDomainMap.get(d) ?? 0,
    }));

    return { ...overview, perDomainBreakdown };
}
