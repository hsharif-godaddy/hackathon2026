import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock pdna-client before importing pdna-db
vi.mock('../pdna-client', () => ({
    pdnaClient: { search: vi.fn() },
    PDNA_PROVISIONING_INDEX: 'test-index',
}));

import { getPdnaSnapshot } from '../pdna-db';
import { pdnaClient } from '../pdna-client';

const mockSearch = pdnaClient!.search as ReturnType<typeof vi.fn>;

describe('pdna-db', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('getPdnaSnapshot', () => {
        const SNAPSHOT_DATE = '2026-03-20T00:00:00.000Z';

        function mockLatestSnapshotResponse() {
            return {
                hits: { total: { value: 0 } },
                aggregations: { latest: { value_as_string: SNAPSHOT_DATE } },
            };
        }

        function mockSnapshotDataResponse(overrides?: { total?: number; published?: number; hibernated?: number; deleted?: number }) {
            const total = overrides?.total ?? 1000;
            return {
                hits: { total: { value: total } },
                aggregations: {
                    total: { value: total },
                    published: { doc_count: overrides?.published ?? 150 },
                    hibernated: { doc_count: overrides?.hibernated ?? 200 },
                    deleted: { doc_count: overrides?.deleted ?? 50 },
                    apps_created_by_day: {
                        by_day: {
                            buckets: [
                                { key_as_string: '2026-03-18T00:00:00.000Z', doc_count: 30 },
                                { key_as_string: '2026-03-19T00:00:00.000Z', doc_count: 45 },
                                { key_as_string: '2026-03-20T00:00:00.000Z', doc_count: 20 },
                            ],
                        },
                    },
                    apps_deleted_by_day: {
                        by_day: {
                            buckets: [
                                { key_as_string: '2026-03-19T00:00:00.000Z', doc_count: 5 },
                                { key_as_string: '2026-03-20T00:00:00.000Z', doc_count: 3 },
                            ],
                        },
                    },
                    unique_customers_by_day: {
                        by_day: {
                            buckets: [
                                { key_as_string: '2026-03-18T00:00:00.000Z', doc_count: 30, unique_customers: { value: 25 } },
                                { key_as_string: '2026-03-19T00:00:00.000Z', doc_count: 45, unique_customers: { value: 38 } },
                            ],
                        },
                    },
                    statuses: {
                        buckets: [
                            { key: 'active', doc_count: 900 },
                            { key: 'cancelled', doc_count: 100 },
                        ],
                    },
                    plans: {
                        buckets: [
                            { key: 'trial', doc_count: 600 },
                            { key: 'airo-plus', doc_count: 400 },
                        ],
                    },
                },
            };
        }

        it('returns null when latest snapshot date query fails', async () => {
            mockSearch.mockRejectedValueOnce(new Error('connection failed'));
            const result = await getPdnaSnapshot();
            expect(result).toBeNull();
        });

        it('returns null when no snapshot date exists', async () => {
            mockSearch.mockResolvedValueOnce({
                hits: { total: { value: 0 } },
                aggregations: { latest: { value_as_string: undefined } },
            });
            const result = await getPdnaSnapshot();
            expect(result).toBeNull();
        });

        it('returns null when main search fails', async () => {
            mockSearch
                .mockResolvedValueOnce(mockLatestSnapshotResponse())
                .mockRejectedValueOnce(new Error('search failed'));
            const result = await getPdnaSnapshot();
            expect(result).toBeNull();
        });

        it('computes publishRate and hibernationRate correctly', async () => {
            mockSearch
                .mockResolvedValueOnce(mockLatestSnapshotResponse())
                .mockResolvedValueOnce(mockSnapshotDataResponse({ total: 1000, published: 150, hibernated: 200 }));

            const result = await getPdnaSnapshot();
            expect(result).not.toBeNull();
            expect(result!.publishRate).toBe(15);
            expect(result!.hibernationRate).toBe(20);
        });

        it('handles zero total apps without division error', async () => {
            mockSearch
                .mockResolvedValueOnce(mockLatestSnapshotResponse())
                .mockResolvedValueOnce(mockSnapshotDataResponse({ total: 0, published: 0, hibernated: 0 }));

            const result = await getPdnaSnapshot();
            expect(result).not.toBeNull();
            expect(result!.publishRate).toBe(0);
            expect(result!.hibernationRate).toBe(0);
        });

        it('extracts daily created/deleted/customer buckets correctly', async () => {
            mockSearch
                .mockResolvedValueOnce(mockLatestSnapshotResponse())
                .mockResolvedValueOnce(mockSnapshotDataResponse());

            const result = await getPdnaSnapshot();
            expect(result).not.toBeNull();

            expect(result!.appsCreatedDaily).toEqual([
                { date: '2026-03-18', created: 30 },
                { date: '2026-03-19', created: 45 },
                { date: '2026-03-20', created: 20 },
            ]);

            expect(result!.appsDeletedDaily).toEqual([
                { date: '2026-03-19', deleted: 5 },
                { date: '2026-03-20', deleted: 3 },
            ]);

            // uniqueCustomers uses cardinality value, not doc_count
            expect(result!.uniqueCustomersDaily).toEqual([
                { date: '2026-03-18', uniqueCustomers: 25 },
                { date: '2026-03-19', uniqueCustomers: 38 },
            ]);
        });

        it('extracts statuses and plans from term aggregations', async () => {
            mockSearch
                .mockResolvedValueOnce(mockLatestSnapshotResponse())
                .mockResolvedValueOnce(mockSnapshotDataResponse());

            const result = await getPdnaSnapshot();
            expect(result!.statuses).toEqual({ active: 900, cancelled: 100 });
            expect(result!.plans).toEqual({ trial: 600, 'airo-plus': 400 });
        });

        it('truncates snapshotDate to date-only for display', async () => {
            mockSearch
                .mockResolvedValueOnce(mockLatestSnapshotResponse())
                .mockResolvedValueOnce(mockSnapshotDataResponse());

            const result = await getPdnaSnapshot();
            expect(result!.snapshotDate).toBe('2026-03-20');
        });
    });
});
