import { NextRequest, NextResponse } from 'next/server';

import { OPS_ADMIN } from '@/lib/ad-groups';
import { withAuth } from '@/lib/api-auth';
import { claimCreditPackSlot, CREDIT_PACK_STATUS, CreditPackDoc, getCreditPackDoc, getLatestCreditPack, indexCreditPackDoc } from '@/lib/credit-pack-utils';
import { logger } from '@/lib/logger';
import mgmtControlPlaneAdapter, { MgmtGrant } from '@/lib/mgmt-control-plane-adapter';
import { APP_ID_RE, handleMgmtError, SUBSCRIPTION_ID_RE, validateId } from '@/lib/mgmt-helpers';


function addIndexError(doc: CreditPackDoc, status: string): NextResponse {
    return NextResponse.json({
        error: `Failed to record credit pack for app ${doc.app_id} and subscription ${doc.subscription_id}, for status: ${status}. Report to ABB Dev team.`,
    }, { status: 500 });
}

export const POST = withAuth<{ appId: string; subscriptionId: string }>(async function add(
    _request: NextRequest,
    auth,
    context
) {
    const { appId, subscriptionId } = await context.params;

    const invalid = validateId(appId, 'appId', APP_ID_RE) ?? validateId(subscriptionId, 'subscriptionId', SUBSCRIPTION_ID_RE);
    if (invalid) return invalid;

    try {
        const appDetails = await mgmtControlPlaneAdapter.getAppDetails(appId, { includeResources: false });
        if (appDetails.subscriptionId !== subscriptionId) {
            return NextResponse.json({ error: 'Invalid subscription ID' }, { status: 400 });
        }
    } catch (error) {
        return handleMgmtError(error, 'fetch app details', { appId });
    }

    let recentCreditPack = null;
    try {
        recentCreditPack = await getLatestCreditPack(subscriptionId);
    } catch (error) {
        logger.warn('credit-pack.eligibility.es-query-failed', {
            appId,
            subscriptionId,
            shopperId: auth.user?.shopperId,
            message: error instanceof Error ? error.message : String(error),
        });
    }

    if (recentCreditPack && !recentCreditPack.is_credit_allowed) {
        return NextResponse.json({
            error: `Credit pack already added, next credit pack can be added after ${recentCreditPack.next_credit_allowed_after}`,
            error_code: 'CREDIT_PACK_ALREADY_ADDED',
        }, { status: 400 });
    }

    const doc = getCreditPackDoc(appId, subscriptionId, auth);

    logger.info('credit-pack.add.init', { appId, subscriptionId, doc: JSON.stringify(doc), shopperId: auth.user?.shopperId });
    let slotResult: 'claimed' | 'conflict';
    try {
        slotResult = await claimCreditPackSlot(doc);
    } catch (error) {
        logger.error('credit-pack.add.slot-claim-failed', { appId, subscriptionId, shopperId: auth.user?.shopperId }, { error: error as Error });
        return addIndexError(doc, CREDIT_PACK_STATUS.INIT);
    }

    if (slotResult === 'conflict') {
        logger.warn('credit-pack.add.slot-claim-conflict', { appId, subscriptionId, shopperId: auth.user?.shopperId });
        return NextResponse.json({
            error: `Credit pack already added, next credit pack can be added after ${doc.next_credit_allowed_after}`,
            error_code: 'CREDIT_PACK_ALREADY_ADDED',
        }, { status: 400 });
    }
    logger.info('credit-pack.add.slot-claimed', { appId, subscriptionId, shopperId: auth.user?.shopperId });

    const responseData: { grant: MgmtGrant | null; creditPack: CreditPackDoc } = { grant: null, creditPack: doc };
    try {
        const response = await mgmtControlPlaneAdapter.addCreditGrant(subscriptionId, {
            type: 'credit-pack',
            creditsMax: doc.credits_max,
            useBefore: doc.use_before,
        });
        logger.info('credit-pack.add.grant-added', { appId, subscriptionId, shopperId: auth.user?.shopperId, responseData: JSON.stringify(response), llm_budget_user_id: response.grant.llmBudgetUserId });
        responseData.grant = response.grant;
        const completeSuccess = await indexCreditPackDoc({ ...doc, status: CREDIT_PACK_STATUS.COMPLETE, llm_budget_user_id: response.grant.llmBudgetUserId });
        if (!completeSuccess) {
            return addIndexError(doc, CREDIT_PACK_STATUS.COMPLETE);
        }
    } catch (error) {
        logger.error('credit-pack.add.grant-failed', { appId, subscriptionId, shopperId: auth.user?.shopperId }, { error: error as Error });
        const failedSuccess = await indexCreditPackDoc({ ...doc, status: CREDIT_PACK_STATUS.FAILED });
        if (!failedSuccess) {
            return addIndexError(doc, CREDIT_PACK_STATUS.FAILED);
        }
        return handleMgmtError(error, 'add credit grant', { appId, subscriptionId, shopperId: auth.user?.shopperId });
    }
    return NextResponse.json(responseData, { status: 201 });
}, { adGroup: OPS_ADMIN });
