import { NextRequest, NextResponse } from 'next/server';

import { OPS_ADMIN } from '@/lib/ad-groups';
import { withAuth } from '@/lib/api-auth';
import { NOTES_MAX_WORDS, NOTES_RE } from '@/lib/credit-pack-constants';
import { CREDIT_PACK_OPTIONS, CREDIT_PACK_STATUS, CreditPackDoc, CreditPackOption, getCreditPackDoc, indexCreditPackDoc } from '@/lib/credit-pack-utils';
import { logger } from '@/lib/logger';
import mgmtControlPlaneAdapter, { MgmtGrant } from '@/lib/mgmt-control-plane-adapter';
import { APP_ID_RE, handleMgmtError, SUBSCRIPTION_ID_RE, validateId } from '@/lib/mgmt-helpers';


function addIndexError(doc: CreditPackDoc, status: string): NextResponse {
    return NextResponse.json({
        error: `Failed to record credit pack for app ${doc.app_id} and subscription ${doc.subscription_id}, for status: ${status}. Report to ABB Dev team.`,
    }, { status: 500 });
}

type SanitizeResult =
    | { ok: true; value: string }
    | { ok: false; reason: 'empty' | 'over_limit' };

function sanitizeNotes(raw: unknown): SanitizeResult {
    if (typeof raw !== 'string') return { ok: false, reason: 'empty' };
    const sanitized = raw.replace(NOTES_RE, '').trim();
    if (!sanitized) return { ok: false, reason: 'empty' };
    if (sanitized.split(/\s+/).length > NOTES_MAX_WORDS) return { ok: false, reason: 'over_limit' };
    return { ok: true, value: sanitized };
}

export const POST = withAuth<{ appId: string; subscriptionId: string }>(async function add(
    request: NextRequest,
    auth,
    context
) {
    const { appId, subscriptionId } = await context.params;

    const invalid = validateId(appId, 'appId', APP_ID_RE) ?? validateId(subscriptionId, 'subscriptionId', SUBSCRIPTION_ID_RE);
    if (invalid) return invalid;

    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const result = sanitizeNotes(body.notes);

    if (!result.ok && result.reason === 'empty') {
        return NextResponse.json({ error: 'notes is required' }, { status: 400 });
    }
    if (!result.ok && result.reason === 'over_limit') {
        return NextResponse.json({ error: `notes exceeds the ${NOTES_MAX_WORDS} word limit` }, { status: 400 });
    }

    const notes = (result as { ok: true; value: string }).value;

    const requestedCredits = Number(body.creditsMax);
    if (!(CREDIT_PACK_OPTIONS as readonly number[]).includes(requestedCredits)) {
        return NextResponse.json({
            error: `creditsMax must be one of ${CREDIT_PACK_OPTIONS.join(', ')}`,
        }, { status: 400 });
    }
    const creditsMax = requestedCredits as CreditPackOption;

    try {
        const appDetails = await mgmtControlPlaneAdapter.getAppDetails(appId);
        if (appDetails.subscriptionId !== subscriptionId) {
            return NextResponse.json({ error: 'Invalid subscription ID' }, { status: 400 });
        }
    } catch (error) {
        return handleMgmtError(error, 'fetch app details', { appId });
    }

    const ACTIVE_CREDITS_LIMIT = 500;
    try {
        const { grants } = await mgmtControlPlaneAdapter.getSubscriptionGrants(subscriptionId);
        const activeCredits = grants.filter(g => g.isAvailable && g.type === 'credit-pack' && g.source === 'admin').reduce((sum, g) => sum + g.creditsMax, 0);
        if (activeCredits >= ACTIVE_CREDITS_LIMIT) {
            logger.warn('credit-pack.add.active-limit-exceeded', { appId, subscriptionId, shopperId: auth.user?.shopperId, activeCredits });
            return NextResponse.json({
                error: `User already has ${activeCredits} active credits (limit: ${ACTIVE_CREDITS_LIMIT}). Adding more is not allowed until existing credits are consumed or expire.`,
                error_code: 'ACTIVE_CREDITS_LIMIT_EXCEEDED',
            }, { status: 400 });
        }
    } catch (error) {
        return handleMgmtError(error, 'fetch subscription grants', { appId, subscriptionId });
    }

    const doc = getCreditPackDoc(appId, subscriptionId, auth.user, notes, creditsMax);

    logger.info('credit-pack.add.init', { appId, subscriptionId, esId: doc.es_id, status: doc.status, shopperId: auth.user?.shopperId });
    const initSuccess = await indexCreditPackDoc(doc);
    if (!initSuccess) {
        return addIndexError(doc, CREDIT_PACK_STATUS.INIT);
    }

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
