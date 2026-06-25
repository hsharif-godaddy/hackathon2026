import { getBudgetServiceClient } from '../../services/budget-service-instance.js';
import { BudgetInsufficientCreditsError, BudgetNoCapacityError } from '@airo/ai-lib/budget';
import { logger } from '../../logging/index.js';
import { MemoryRepository } from '../../database/repositories/MemoryRepository.js';
import { DocumentType, complianceDocChargedMemoryKey } from '../../services/ComplianceService.js';

/** Each compliance document costs 1 credit, charged once per (app, documentType). */
const COMPLIANCE_DOC_CREDIT_COST = '1';

const memoryRepository = new MemoryRepository();

export type ComplianceChargeResult = { ok: true } | { ok: false; error: string };

/**
 * Charge 1 credit for a compliance document before it is produced.
 *
 * Idempotent: the BMS idempotency key is deterministic per (app, documentType),
 * so the FIRST generation charges 1 credit and any later regeneration replays
 * that same charge (the budget-service returns the prior result without
 * deducting again). This is what makes "charge the first time each document is
 * produced" hold while keeping regeneration free.
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
      credits: COMPLIANCE_DOC_CREDIT_COST,
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
