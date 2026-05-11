import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../pdna-client', () => ({
    pdnaClient: { search: vi.fn() },
    PDNA_CLOUDFLARE_INDEX: 'test-cloudflare-index',
}));

import { getCloudflareAppTraffic, getCloudflareOverview } from '../cloudflare-db';
import { pdnaClient } from '../pdna-client';

const mockSearch = pdnaClient!.search as ReturnType<typeof vi.fn>;

/** Build a well-formed Cloudflare aggregation response. Individual fields
 * can be overridden for edge-case tests. */
function buildResponse(overrides?: {
    total?: number;
    requestsByTimeBuckets?: Array<{ key_as_string: string; doc_count: number; by_status?: Array<{ key: string; doc_count: number }>; latency?: Record<string, number | null> }>;
    perDomain?: Array<{ key: string; doc_count: number }>;
}) {
    return {
        hits: { total: { value: overrides?.total ?? 1000 } },
        aggregations: {
            unique_domains: { value: 12 },
            unique_clients: { value: 345 },
            sum_bytes: { value: 1_500_000 },
            latency: { values: { '50.0': 50, '95.0': 500 } },
            cache_result: { buckets: [{ key: 'hit', doc_count: 200 }, { key: 'miss', doc_count: 800 }] },
            methods: { buckets: [{ key: 'GET', doc_count: 900 }, { key: 'POST', doc_count: 100 }] },
            top_domains: { buckets: [{ key: 'example.com', doc_count: 600 }, { key: 'other.com', doc_count: 400 }] },
            top_colos: { buckets: [{ key: 'SIN', doc_count: 500 }] },
            security_actions: { buckets: [] },
            requests_by_time: {
                buckets: overrides?.requestsByTimeBuckets ?? [
                    {
                        key_as_string: '2026-05-11T10:00:00.000Z',
                        doc_count: 500,
                        by_status: { buckets: [{ key: '2xx', doc_count: 400 }, { key: '5xx', doc_count: 10 }] },
                        latency: { values: { '50.0': 55, '95.0': 550 } },
                    },
                    {
                        key_as_string: '2026-05-11T11:00:00.000Z',
                        doc_count: 500,
                        by_status: { buckets: [{ key: '2xx', doc_count: 490 }, { key: '4xx', doc_count: 10 }] },
                        latency: { values: { '50.0': 45, '95.0': 450 } },
                    },
                ] as ReadonlyArray<unknown>,
            },
            ...(overrides?.perDomain ? { per_domain: { buckets: overrides.perDomain } } : {}),
        },
    };
}

describe('cloudflare-db', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('getCloudflareOverview', () => {
        it('extracts scalars, categorical terms, and per-bucket status/latency', async () => {
            mockSearch.mockResolvedValueOnce(buildResponse());

            const result = await getCloudflareOverview({
                startMs: 1_700_000_000_000,
                endMs: 1_700_003_600_000,
                bucketInterval: '5m',
            });

            expect(result).not.toBeNull();
            expect(result).toMatchObject({
                totalRequests: 1000,
                uniqueDomains: 12,
                uniqueClients: 345,
                sumBytes: 1_500_000,
                p50Ms: 50,
                p95Ms: 500,
            });
            expect(result!.requestsDaily).toEqual([
                { date: '2026-05-11T10:00:00.000Z', count: 500 },
                { date: '2026-05-11T11:00:00.000Z', count: 500 },
            ]);
            expect(result!.statusClassDaily[0]).toEqual({
                date: '2026-05-11T10:00:00.000Z',
                c2xx: 400, c3xx: 0, c4xx: 0, c5xx: 10, cOther: 0,
            });
            expect(result!.latencyDaily).toEqual([
                { date: '2026-05-11T10:00:00.000Z', p50Ms: 55, p95Ms: 550 },
                { date: '2026-05-11T11:00:00.000Z', p50Ms: 45, p95Ms: 450 },
            ]);
            expect(result!.cacheResult).toEqual([
                { key: 'hit', count: 200 },
                { key: 'miss', count: 800 },
            ]);
            expect(result!.topDomains).toHaveLength(2);
        });

        it('requests extended_bounds + date_histogram on event_timestamp', async () => {
            mockSearch.mockResolvedValueOnce(buildResponse());
            await getCloudflareOverview({
                startMs: 1_700_000_000_000,
                endMs: 1_700_003_600_000,
                bucketInterval: '5m',
            });

            const call = mockSearch.mock.calls[0][0];
            const rbt = call.body.aggs.requests_by_time.date_histogram;
            expect(rbt.field).toBe('event_timestamp');
            expect(rbt.fixed_interval).toBe('5m');
            expect(rbt.min_doc_count).toBe(0);
            expect(rbt.extended_bounds).toEqual({ min: 1_700_000_000_000, max: 1_700_003_600_000 });
        });

        it('throws when the ES response is missing requests_by_time.buckets', async () => {
            mockSearch.mockResolvedValueOnce({
                hits: { total: { value: 0 } },
                aggregations: { /* everything else happens to be empty */ },
            });

            await expect(getCloudflareOverview({
                startMs: 1_700_000_000_000,
                endMs: 1_700_003_600_000,
                bucketInterval: '5m',
            })).rejects.toThrow(/requests_by_time\.buckets/);
        });

    });

    describe('getCloudflareAppTraffic', () => {
        it('short-circuits to zeros when no domains are provided (no ES call)', async () => {
            const result = await getCloudflareAppTraffic({
                domains: [],
                startMs: 1_700_000_000_000,
                endMs: 1_700_003_600_000,
                bucketInterval: '5m',
            });

            expect(mockSearch).not.toHaveBeenCalled();
            expect(result).toMatchObject({
                totalRequests: 0,
                uniqueDomains: 0,
                perDomainBreakdown: [],
            });
        });

        it('backfills zero-traffic caller-supplied domains in perDomainBreakdown', async () => {
            // ES returns per_domain bucket only for "busy.example.com".
            // The other two input domains must appear as zeros, in input order.
            mockSearch.mockResolvedValueOnce(buildResponse({
                perDomain: [{ key: 'busy.example.com', doc_count: 900 }],
            }));

            const result = await getCloudflareAppTraffic({
                domains: ['busy.example.com', 'quiet.example.com', 'preview.example.com'],
                startMs: 1_700_000_000_000,
                endMs: 1_700_003_600_000,
                bucketInterval: '5m',
            });

            expect(result!.perDomainBreakdown).toEqual([
                { key: 'busy.example.com', count: 900 },
                { key: 'quiet.example.com', count: 0 },
                { key: 'preview.example.com', count: 0 },
            ]);
        });

        it('filters by the caller-supplied domains via terms() + terms include on per_domain', async () => {
            mockSearch.mockResolvedValueOnce(buildResponse({ perDomain: [] }));

            await getCloudflareAppTraffic({
                domains: ['a.example', 'b.example'],
                startMs: 1_700_000_000_000,
                endMs: 1_700_003_600_000,
                bucketInterval: '5m',
            });

            const call = mockSearch.mock.calls[0][0];
            const rangeFilter = call.body.query.bool.filter.find((f: Record<string, unknown>) => 'range' in f);
            const termsFilter = call.body.query.bool.filter.find((f: Record<string, unknown>) => 'terms' in f);
            expect(rangeFilter).toBeDefined();
            expect(termsFilter).toEqual({ terms: { 'url.domain.keyword': ['a.example', 'b.example'] } });

            const perDomainAgg = call.body.aggs.per_domain.terms;
            expect(perDomainAgg.field).toBe('url.domain.keyword');
            expect(perDomainAgg.include).toEqual(['a.example', 'b.example']);
        });
    });
});
