import crypto from 'node:crypto';

import { bulkIndex, INDICES, initIndices } from '@/lib/analytics/es-client';
import type { AuthUser } from '@/lib/api-auth';
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
export const CREDIT_PACK_OPTIONS = [100, 250] as const;
export type CreditPackOption = typeof CREDIT_PACK_OPTIONS[number];

export const CREDIT_PACK_STATUS = {
    COMPLETE: 'complete',
    INIT: 'init',
    FAILED: 'failed',
} as const;

export function getCreditPackDoc(appId: string, subscriptionId: string, user: AuthUser | undefined, notes: string, creditsMax: CreditPackOption = CREDITS_MAX): CreditPackDoc {
    const now = new Date();
    const use_before = computeUseBefore();
    const next_credit_allowed_after = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();

    return {
        es_id: crypto.randomUUID(),
        timestamp: now.toISOString(),
        app_id: appId,
        subscription_id: subscriptionId,
        status: CREDIT_PACK_STATUS.INIT,
        credits_max: creditsMax,
        use_before,
        next_credit_allowed_after,
        added_by_shopper_id: user?.shopperId,
        added_by_cid: user?.cid,
        added_by_email: user?.email,
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
