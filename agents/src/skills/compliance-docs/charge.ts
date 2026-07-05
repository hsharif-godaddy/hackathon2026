import { getBudgetServiceClient } from '../../services/budget-service-instance.js';
import { BudgetInsufficientCreditsError, BudgetNoCapacityError } from '@airo/ai-lib/budget';
import { logger } from '../../logging/index.js';
import { MemoryRepository } from '../../database/repositories/MemoryRepository.js';
import {
  DocumentType,
  complianceDocChargedMemoryKey,
  complianceDocConfirmationMemoryKey,
} from '../../services/ComplianceService.js';
import { getComplianceDocCreditCost } from './pricing.js';

const memoryRepository = new MemoryRepository();

export type ComplianceChargeResult = { ok: true } | { ok: false; error: string };

async function markerIsTrue(appId: string, key: string): Promise<boolean> {
  const marker = await memoryRepository.get(appId, key);
  return Boolean(marker.success && marker.exists && marker.value === true);
}

/**
 * Whether a compliance document may be charged+generated without first showing
 * the charge dialog — true when the document is free, OR was already charged
 * (regeneration is free, so no consent prompt), OR the user has explicitly
 * accepted the charge via the confirm route ([[complianceDocConfirmationMemoryKey]]).
 *
 * This is the authoritative consent gate for the money path, so it is
 * fail-closed: any marker read failure resolves to `false` (block and re-prompt)
 * rather than risk charging without recorded consent. That is the opposite
 * stance from the best-effort `.charged` short-circuit inside
 * [[chargeForComplianceDoc]], which fails open because the BMS idempotency key
 * is its authoritative double-charge guard.
 */
export async function isComplianceChargeConfirmed(
  appId: string,
  documentType: DocumentType,
): Promise<boolean> {
  // Free documents need no consent — nothing is charged.
  if (getComplianceDocCreditCost() <= 0) {
    return true;
  }
  if (await markerIsTrue(appId, complianceDocChargedMemoryKey(documentType))) {
    return true;
  }
  return markerIsTrue(appId, complianceDocConfirmationMemoryKey(documentType));
}

/**
 * Charge the per-document credit cost ([[getComplianceDocCreditCost]]) before a
 * compliance document is produced. The cost is variable and may be 0 (free), in
 * which case nothing is charged.
 *
 * Idempotent: the BMS idempotency key is deterministic per (app, documentType),
 * so the FIRST generation charges and any later regeneration replays that same
 * charge (the budget-service returns the prior result without deducting again).
 * This is what makes "charge the first time each document is produced" hold while
 * keeping regeneration free.
 *
 * Blocking: when budgeting is active (a budget id + client are present) the
 * charge must succeed before the document is generated — if the budget cannot
 * cover it (or the charge otherwise fails) generation is refused. When budgeting
 * is not configured (no client, e.g. a local stack without BMS), there is
 * nothing to charge against and generation proceeds uncharged.
 *
 * Charged-but-not-generated: the credit is deducted (a committed, separate BMS
 * call) BEFORE the document is produced. If generation fails after a successful
 * charge there is no compensating refund — but the deterministic idempotency key
 * makes a retry free (BMS replays the original charge), so a user who retries is
 * made whole. This ordering is deliberate.
 *
 * Defense in depth: a per-app "charged" memory marker is checked before the BMS
 * call and set after a successful one. If the marker is present we short-circuit
 * and skip the deduct entirely. This is belt-and-braces on top of the
 * budget-service's own idempotency (which already prevents a double charge) — it
 * just avoids the round trip on a regeneration. The marker is best-effort: a
 * read or write failure never blocks or fails the charge, because the
 * idempotency key remains the authoritative guarantee.
 */
export async function chargeForComplianceDoc(params: {
  bmsBudgetId: string | undefined;
  appId: string;
  documentType: DocumentType;
}): Promise<ComplianceChargeResult> {
  const { bmsBudgetId, appId, documentType } = params;

  const cost = getComplianceDocCreditCost();
  if (cost <= 0) {
    // Free document — nothing to charge.
    logger.info('skills.compliance-docs.charge.free', { appId, documentType });
    return { ok: true };
  }

  const client = getBudgetServiceClient();
  if (!client) {
    // Budgeting not configured (e.g. local stack without BMS) — nothing to charge.
    logger.info('skills.compliance-docs.charge.skipped', {
      appId,
      documentType,
      reason: 'budget client not configured',
    });
    return { ok: true };
  }
  if (!bmsBudgetId) {
    // Budgeting IS configured but the budget id never reached this tool — a
    // metadata-plumbing gap that would silently produce a free document. Warn so
    // the gap is visible in production rather than passing as a routine skip.
    logger.warn('skills.compliance-docs.charge.missing_budget_id', { appId, documentType });
    return { ok: true };
  }

  const chargedKey = complianceDocChargedMemoryKey(documentType);
  const charged = await memoryRepository.get(appId, chargedKey);
  if (charged.success && charged.exists && charged.value === true) {
    logger.info('skills.compliance-docs.charge.already_charged', {
      appId,
      documentType,
      reason: 'charged memory marker present',
    });
    return { ok: true };
  }

  const idempotencyKey = `compliance-doc:${appId}:${documentType}`;
  try {
    await client.deductCredits(bmsBudgetId, {
      credits: String(cost),
      idempotencyKey,
      reason: `compliance-doc:${documentType}`,
      metadata: { appId, documentType, kind: 'compliance-doc' },
    });
    logger.info('skills.compliance-docs.charge.success', {
      appId,
      documentType,
      bmsBudgetId,
      idempotencyKey,
    });
    const marked = await memoryRepository.set(appId, chargedKey, true);
    if (!marked.success) {
      logger.warn('skills.compliance-docs.charge.mark_failed', {
        appId,
        documentType,
        error: marked.error,
      });
    }
    return { ok: true };
  } catch (error) {
    if (error instanceof BudgetInsufficientCreditsError || error instanceof BudgetNoCapacityError) {
      logger.warn('skills.compliance-docs.charge.insufficient', {
        appId,
        documentType,
        bmsBudgetId,
        error: error.message,
      });
      return {
        ok: false,
        error: 'Not enough credits to generate this document. Please add credits and try again.',
      };
    }
    logger.error('skills.compliance-docs.charge.error', {
      appId,
      documentType,
      bmsBudgetId,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      ok: false,
      error: 'Could not process the credit charge for this document. Please try again.',
    };
  }
}
