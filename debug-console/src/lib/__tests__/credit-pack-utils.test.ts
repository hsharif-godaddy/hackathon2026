import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({
    logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/analytics/es-client', () => ({
    INDICES: { CREDIT_PACKS: 'test_credit_packs' },
    writeClient: { search: vi.fn(), create: vi.fn() },
    initIndices: vi.fn().mockResolvedValue(undefined),
    bulkIndex: vi.fn(),
}));

vi.mock('@/lib/date-utils', () => ({
    computeUseBefore: vi.fn(() => '2026-05-04T16:00:00Z'),
}));

import type { AuthResult } from '../api-auth';
import {
    claimCreditPackSlot,
    CREDITS_MAX,
    CREDIT_PACK_STATUS,
    getCreditPackDoc,
    getLatestCreditPack,
    indexCreditPackDoc,
} from '../credit-pack-utils';

describe('credit-pack-utils', () => {
    const mockAuth: AuthResult = {
        user: {
            shopperId: 'shop-123',
            cid: 'cust-456',
            email: 'admin@example.com',
        },
    } as AuthResult;

    describe('constants', () => {
        it('should have CREDITS_MAX set to 250', () => {
            expect(CREDITS_MAX).toBe(250);
        });

        it('should have correct status values', () => {
            expect(CREDIT_PACK_STATUS.COMPLETE).toBe('complete');
            expect(CREDIT_PACK_STATUS.INIT).toBe('init');
            expect(CREDIT_PACK_STATUS.FAILED).toBe('failed');
        });
    });

    describe('getCreditPackDoc', () => {
        beforeEach(() => {
            vi.useFakeTimers();
            vi.setSystemTime(new Date('2026-04-04T15:21:31Z'));
        });

        afterEach(() => {
            vi.useRealTimers();
        });

        it('should return a doc with the correct appId and subscriptionId', () => {
            const doc = getCreditPackDoc('app-1', 'sub-1', mockAuth);

            expect(doc.app_id).toBe('app-1');
            expect(doc.subscription_id).toBe('sub-1');
        });

        it('should set status to INIT', () => {
            const doc = getCreditPackDoc('app-1', 'sub-1', mockAuth);

            expect(doc.status).toBe(CREDIT_PACK_STATUS.INIT);
        });

        it('should set credits_max from the constant', () => {
            const doc = getCreditPackDoc('app-1', 'sub-1', mockAuth);

            expect(doc.credits_max).toBe(CREDITS_MAX);
        });

        it('should generate a UUID for es_id', () => {
            const doc = getCreditPackDoc('app-1', 'sub-1', mockAuth);

            expect(doc.es_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
        });

        it('should set timestamp to now', () => {
            const doc = getCreditPackDoc('app-1', 'sub-1', mockAuth);

            expect(doc.timestamp).toBe('2026-04-04T15:21:31.000Z');
        });

        it('should set use_before from computeUseBefore', () => {
            const doc = getCreditPackDoc('app-1', 'sub-1', mockAuth);

            expect(doc.use_before).toBe('2026-05-04T16:00:00Z');
        });

        it('should set next_credit_allowed_after to 24 hours from now', () => {
            const doc = getCreditPackDoc('app-1', 'sub-1', mockAuth);

            expect(doc.next_credit_allowed_after).toBe('2026-04-05T15:21:31.000Z');
        });

        it('should set added_by fields from auth', () => {
            const doc = getCreditPackDoc('app-1', 'sub-1', mockAuth);

            expect(doc.added_by_shopper_id).toBe('shop-123');
            expect(doc.added_by_cid).toBe('cust-456');
            expect(doc.added_by_email).toBe('admin@example.com');
        });

        it('should handle missing user fields gracefully', () => {
            const doc = getCreditPackDoc('app-1', 'sub-1', { user: undefined } as unknown as AuthResult);

            expect(doc.added_by_shopper_id).toBeUndefined();
            expect(doc.added_by_cid).toBeUndefined();
            expect(doc.added_by_email).toBeUndefined();
        });

        it('should generate unique es_id on each call', () => {
            const doc1 = getCreditPackDoc('app-1', 'sub-1', mockAuth);
            const doc2 = getCreditPackDoc('app-1', 'sub-1', mockAuth);

            expect(doc1.es_id).not.toBe(doc2.es_id);
        });
    });

    describe('getLatestCreditPack', () => {
        it('should return null when no hits are found', async () => {
            const { writeClient } = await import('@/lib/analytics/es-client');
            vi.mocked(writeClient.search).mockResolvedValue({
                hits: { hits: [], total: { value: 0, relation: 'eq' } },
            } as never);

            expect(await getLatestCreditPack('sub-1')).toBeNull();
        });

        it('should return the document with is_credit_allowed true when next_credit_allowed_after is in the past', async () => {
            const { writeClient } = await import('@/lib/analytics/es-client');
            vi.mocked(writeClient.search).mockResolvedValue({
                hits: {
                    hits: [{
                        _source: {
                            es_id: 'id-1',
                            timestamp: '2026-04-03T12:00:00Z',
                            app_id: 'app-1',
                            subscription_id: 'sub-1',
                            status: 'complete',
                            credits_max: 250,
                            use_before: '2026-05-03T13:00:00Z',
                            next_credit_allowed_after: '2020-01-01T00:00:00Z',
                        },
                    }],
                    total: { value: 1, relation: 'eq' },
                },
            } as never);

            const result = await getLatestCreditPack('sub-1');

            expect(result).not.toBeNull();
            expect(result!.es_id).toBe('id-1');
            expect(result!.is_credit_allowed).toBe(true);
        });

        it('should return is_credit_allowed false when next_credit_allowed_after is in the future', async () => {
            const { writeClient } = await import('@/lib/analytics/es-client');
            vi.mocked(writeClient.search).mockResolvedValue({
                hits: {
                    hits: [{
                        _source: {
                            es_id: 'id-2',
                            timestamp: '2026-04-03T12:00:00Z',
                            app_id: 'app-1',
                            subscription_id: 'sub-1',
                            status: 'complete',
                            credits_max: 250,
                            use_before: '2026-05-03T13:00:00Z',
                            next_credit_allowed_after: '2099-12-31T23:59:59Z',
                        },
                    }],
                    total: { value: 1, relation: 'eq' },
                },
            } as never);

            const result = await getLatestCreditPack('sub-1');

            expect(result!.is_credit_allowed).toBe(false);
        });

        it('should query with correct filters and sort', async () => {
            const { writeClient, INDICES } = await import('@/lib/analytics/es-client');
            vi.mocked(writeClient.search).mockResolvedValue({
                hits: { hits: [], total: { value: 0, relation: 'eq' } },
            } as never);

            await getLatestCreditPack('sub-xyz');

            expect(writeClient.search).toHaveBeenCalledWith({
                index: INDICES.CREDIT_PACKS,
                size: 1,
                query: {
                    bool: {
                        filter: [
                            { term: { subscription_id: 'sub-xyz' } },
                            { term: { status: 'complete' } },
                        ]
                    }
                },
                sort: [{ next_credit_allowed_after: { order: 'desc' } }],
            });
        });
    });

    describe('indexCreditPackDoc', () => {
        beforeEach(() => {
            vi.clearAllMocks();
        });

        const sampleDoc = {
            es_id: 'doc-1',
            timestamp: '2026-04-04T15:21:31Z',
            app_id: 'app-1',
            subscription_id: 'sub-1',
            status: 'init',
            credits_max: 250,
            use_before: '2026-05-04T16:00:00Z',
            next_credit_allowed_after: '2026-04-05T15:21:31Z',
            added_by_shopper_id: 'shop-123',
        };

        it('should call bulkIndex and return true on success', async () => {
            const { initIndices, bulkIndex, INDICES } = await import('@/lib/analytics/es-client');
            vi.mocked(initIndices).mockResolvedValue(undefined as never);
            vi.mocked(bulkIndex).mockResolvedValue(undefined as never);

            const result = await indexCreditPackDoc(sampleDoc);

            expect(result).toBe(true);
            expect(bulkIndex).toHaveBeenCalledWith([{
                index: INDICES.CREDIT_PACKS,
                id: 'doc-1-init',
                doc: sampleDoc,
            }]);
        });

        it('should return false when bulkIndex throws', async () => {
            const { initIndices, bulkIndex } = await import('@/lib/analytics/es-client');
            vi.mocked(initIndices).mockResolvedValue(undefined as never);
            vi.mocked(bulkIndex).mockRejectedValue(new Error('ES connection failed'));

            const result = await indexCreditPackDoc(sampleDoc);

            expect(result).toBe(false);
        });

        it('should use doc es_id and status in the bulk index id', async () => {
            const { initIndices, bulkIndex } = await import('@/lib/analytics/es-client');
            vi.mocked(initIndices).mockResolvedValue(undefined as never);
            vi.mocked(bulkIndex).mockResolvedValue(undefined as never);

            await indexCreditPackDoc({ ...sampleDoc, es_id: 'abc', status: 'complete' });

            expect(vi.mocked(bulkIndex).mock.calls[0][0][0].id).toBe('abc-complete');
        });
    });

    describe('claimCreditPackSlot', () => {
        beforeEach(() => {
            vi.clearAllMocks();
        });

        const sampleDoc = {
            es_id: 'doc-1',
            timestamp: '2026-04-04T15:21:31.000Z',
            app_id: 'app-1',
            subscription_id: 'sub-1',
            status: 'init',
            credits_max: 250,
            use_before: '2026-05-04T16:00:00Z',
            next_credit_allowed_after: '2026-04-05T15:21:31.000Z',
        };

        it('should return claimed on successful create', async () => {
            const { writeClient, initIndices } = await import('@/lib/analytics/es-client');
            vi.mocked(initIndices).mockResolvedValue(undefined as never);
            vi.mocked(writeClient.create).mockResolvedValue({} as never);

            expect(await claimCreditPackSlot(sampleDoc)).toBe('claimed');
        });

        it('should use a deterministic lock ID based on subscriptionId and day', async () => {
            const { writeClient, initIndices, INDICES } = await import('@/lib/analytics/es-client');
            vi.mocked(initIndices).mockResolvedValue(undefined as never);
            vi.mocked(writeClient.create).mockResolvedValue({} as never);

            await claimCreditPackSlot(sampleDoc);

            expect(writeClient.create).toHaveBeenCalledWith(expect.objectContaining({
                index: INDICES.CREDIT_PACKS,
                id: 'lock-sub-1-2026-04-04',
            }));
        });

        it('should return conflict on 409 version_conflict', async () => {
            const { writeClient, initIndices } = await import('@/lib/analytics/es-client');
            vi.mocked(initIndices).mockResolvedValue(undefined as never);

            const conflictError = Object.assign(new Error('version_conflict_engine_exception'), { statusCode: 409 });
            vi.mocked(writeClient.create).mockRejectedValue(conflictError);

            expect(await claimCreditPackSlot(sampleDoc)).toBe('conflict');
        });

        it('should re-throw non-409 errors', async () => {
            const { writeClient, initIndices } = await import('@/lib/analytics/es-client');
            vi.mocked(initIndices).mockResolvedValue(undefined as never);
            vi.mocked(writeClient.create).mockRejectedValue(new Error('ES connection timeout'));

            await expect(claimCreditPackSlot(sampleDoc)).rejects.toThrow('ES connection timeout');
        });
    });
});
