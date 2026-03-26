import crypto from 'node:crypto';

import { bulkIndex, INDICES, initIndices, writeClient } from '@/lib/analytics/es-client';
import type { AuthResult } from '@/lib/api-auth';
import { computeUseBefore } from '@/lib/date-utils';
import { logger } from '@/lib/logger';

let indexInitPromise: Promise<void> | null = null;

function ensureCreditPackIndex(): Promise<void> {
    if (!indexInitPromise) {
        logger.info('credit-pack.index.init.begin');
        // forceUpdate=true: credit_packs schema is still evolving; putMapping
        // applies new fields on boot. Remove once the schema stabilises.
        indexInitPromise = initIndices([INDICES.CREDIT_PACKS], true).then(function logSuccess() {
            logger.info('credit-pack.index.init.end');
        }).catch(function resetOnFailure(error) {
            indexInitPromise = null;
            logger.error('credit-pack.index.init.error', { message: 'Failed to initialize credit pack index' }, { error: error as Error });
            throw error;
        });
    }
    return indexInitPromise;
}

export const CREDITS_MAX = 250;

export const CREDIT_PACK_STATUS = {
    COMPLETE: 'complete',
    INIT: 'init',
    FAILED: 'failed',
} as const;

export function getCreditPackDoc(appId: string, subscriptionId: string, auth: AuthResult, notes: string): CreditPackDoc {
    const now = new Date();
    const use_before = computeUseBefore();
    const next_credit_allowed_after = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();

    return {
        es_id: crypto.randomUUID(),
        timestamp: now.toISOString(),
        app_id: appId,
        subscription_id: subscriptionId,
        status: CREDIT_PACK_STATUS.INIT,
        credits_max: CREDITS_MAX,
        use_before,
        next_credit_allowed_after,
        added_by_shopper_id: auth.user?.shopperId,
        added_by_cid: auth.user?.cid,
        added_by_email: auth.user?.email,
        notes,
    };
}

export interface CreditPackDoc {
    es_id: string;
    timestamp: string;
    app_id: string;
    subscription_id: string;
    status: string;
    credits_max: number;
    use_before: string;
    next_credit_allowed_after: string;
    added_by_shopper_id?: string;
    added_by_cid?: string;
    added_by_email?: string;
    llm_budget_user_id?: string;
    notes?: string;
}

export type LatestCreditPack = CreditPackDoc & { is_credit_allowed: boolean };

export async function getLatestCreditPack(subscriptionId: string): Promise<LatestCreditPack | null> {
    await ensureCreditPackIndex();
    const result = await writeClient.search<CreditPackDoc>({
        index: INDICES.CREDIT_PACKS,
        size: 1,
        query: {
            bool: {
                filter: [
                    { term: { subscription_id: subscriptionId } },
                    { term: { status: CREDIT_PACK_STATUS.COMPLETE } },
                ]
            }
        },
        sort: [{ next_credit_allowed_after: { order: 'desc' } }],
    });

    const doc = result.hits.hits[0]?._source;
    if (!doc) return null;

    return {
        ...doc,
        is_credit_allowed: new Date(doc.next_credit_allowed_after) <= new Date(),
    };
}

/**
 * Atomic lock: uses op_type:create on a deterministic ID so only the first
 * concurrent request for a given subscription+day succeeds. Subsequent
 * requests within the same UTC day get a 409 version_conflict from ES.
 *
 * Lock documents include expire_at (24h TTL). An ILM policy with a delete
 * phase keyed on expire_at is required to prevent unbounded index growth.
 */
export async function claimCreditPackSlot(doc: CreditPackDoc): Promise<'claimed' | 'conflict'> {
    const dayBucket = doc.timestamp.slice(0, 10);
    const lockId = `lock-${doc.subscription_id}-${dayBucket}`;

    try {
        await ensureCreditPackIndex();
        await writeClient.create({
            index: INDICES.CREDIT_PACKS,
            id: lockId,
            document: {
                ...doc as unknown as Record<string, unknown>,
                expire_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
            },
        });
        logger.info('credit-pack.slot.claimed', { subscriptionId: doc.subscription_id, lockId });
        return 'claimed';
    } catch (error: unknown) {
        if (error instanceof Error && 'statusCode' in error && (error as { statusCode: number }).statusCode === 409) {
            logger.warn('credit-pack.slot.conflict', { subscriptionId: doc.subscription_id, lockId });
            return 'conflict';
        }
        throw error;
    }
}

export async function indexCreditPackDoc(doc: CreditPackDoc): Promise<boolean> {
    try {
        await ensureCreditPackIndex();
        await bulkIndex([{ index: INDICES.CREDIT_PACKS, id: `${doc.es_id}-${doc.status}`, doc: doc as unknown as Record<string, unknown> }]);
        logger.info(`credit-pack.add.status-${doc.status}.es-write-success`, { appId: doc.app_id, subscriptionId: doc.subscription_id, esId: doc.es_id });
        return true;
    } catch (error) {
        logger.error(`credit-pack.add.status-${doc.status}.es-write-failed`, {
            appId: doc.app_id,
            subscriptionId: doc.subscription_id,
            esId: doc.es_id,
        }, { error: error as Error });
        return false;
    }
}
