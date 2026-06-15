import { putExpiryRecord, putReminderRecord } from '../clients/deferred-kinesis.js';
import { getApp, getAppCount, getPublishedAppCount, getTransferMetadata } from '../clients/mgmt.js';
import { sendMessage } from '../clients/messaging.js';
import { getCustomer } from '../clients/pie.js';
import { getTemplateConfig, isServiceEnabled, type GuardName, type TemplateConfig } from '../clients/switchboard.js';
import { config } from '../config.js';
import { extract, type ExtractedEvent } from '../extractor/index.js';
import { logger } from '../logger.js';

/**
 * Context passed to every placeholder resolver so they can fetch whatever they need.
 */
interface ResolverContext {
  customerId: string;
  appId?: string;
}

type Resolver = (ctx: ResolverContext) => Promise<string | null>;

/** Maps ##key## placeholder names to resolver functions. Add an entry here to support a new
 * Switchboard placeholder — no other changes needed. */
const RESOLVERS: Record<string, Resolver> = {
  app_name: async ({ appId }) => {
    if (!appId) {
      logger.error('processor.resolver.app_name.no_appId');
      return null;
    }
    const app = await getApp(appId);
    const name = app.name || null;
    if (name === null) logger.error('processor.resolver.app_name.missing', { appId });
    return name;
  },

  recipient_email: async ({ customerId, appId }) => {
    if (!appId) {
      logger.error('processor.resolver.recipient_email.no_appId', { customerId });
      return null;
    }
    const transfer = await getTransferMetadata(appId, customerId);
    if (transfer.sourceCustomerId === customerId) {
      // Initiate event — recipient is the transfer target.
      const targetCustomerId = transfer.targetCandidateShoppers?.[0]?.customerId ?? transfer.targetCustomerId;
      if (!targetCustomerId) {
        logger.error('processor.resolver.recipient_email.no_target_customer', {
          customerId,
          appId,
          transferId: transfer.id,
        });
        return null;
      }
      const customer = await getCustomer(targetCustomerId);
      const email = customer.email ?? null;
      if (email === null) logger.error('processor.resolver.recipient_email.no_email', { targetCustomerId });
      return email;
    }

    // Accept event — customerId is the target, recipient is themselves.
    const customer = await getCustomer(customerId);
    const email = customer.email ?? null;
    if (email === null) logger.error('processor.resolver.recipient_email.no_email', { targetCustomerId: customerId });
    return email;
  },

  sender_email: async ({ customerId }) => {
    const customer = await getCustomer(customerId);
    const email = customer.email ?? null;
    if (email === null) logger.error('processor.resolver.sender_email.no_email', { customerId });
    return email;
  },

  transfer_code: async ({ customerId, appId }) => {
    if (!appId) {
      logger.error('processor.resolver.transfer_code.no_appId', { customerId });
      return null;
    }
    const transfer = await getTransferMetadata(appId, customerId);
    const token = transfer.transferToken ?? null;
    if (token === null) logger.error('processor.resolver.transfer_code.missing', { customerId, appId });
    return token;
  },

  app_domain_connections: async ({ appId }) => {
    if (!appId) {
      logger.error('processor.resolver.app_domain_connections.no_appId');
      return null;
    }
    const app = await getApp(appId);
    return app.customDomain ?? '';
  },
};

/** Matches ##anything## and captures the inner key. */
const PLACEHOLDER_RE = /^##(.+)##$/;

function parsePlaceholder(value: string): string | null {
  return PLACEHOLDER_RE.exec(value)?.[1] ?? null;
}

/** Resolves ##key## placeholders in substitutionValues in parallel.
 * Returns null if any required placeholder cannot be resolved (caller should skip). */
async function resolveSubstitutions(
  substitutionValues: Record<string, string>,
  ctx: ResolverContext,
): Promise<Record<string, string> | null> {
  const entries = Object.entries(substitutionValues);

  const resolved = await Promise.all(
    entries.map(async ([key, value]) => {
      const placeholderKey = parsePlaceholder(value);

      if (!placeholderKey) {
        return { key, value, resolved: value, required: false };
      }

      const resolver = RESOLVERS[placeholderKey];
      if (!resolver) {
        logger.error('processor.substitutions.unknown_placeholder', { key, placeholderKey, ...ctx });
        return { key, value, resolved: value, required: false };
      }

      const result = await resolver(ctx);
      return { key, value, resolved: result, required: true, placeholderKey };
    }),
  );

  const result: Record<string, string> = {};
  for (const entry of resolved) {
    if (entry.required && entry.resolved === null) {
      logger.error('processor.substitutions.resolution_failed', {
        key: entry.key,
        placeholder: entry.placeholderKey,
        ...ctx,
      });
      return null;
    }
    result[entry.key] = entry.resolved ?? entry.value;
  }

  return result;
}

/** Resolves the customerId to dispatch the email to based on templateConfig.target.
 * Returns null when the target cannot be determined (caller skips the template). */
async function resolveTargetCustomerId(
  templateConfig: TemplateConfig,
  ctx: ResolverContext,
): Promise<string | null> {
  if (!templateConfig.target || templateConfig.target === 'event_customer') {
    return ctx.customerId;
  }

  if (!ctx.appId) {
    logger.error('processor.target.no_appId', { customerId: ctx.customerId, target: templateConfig.target });
    return null;
  }

  if (templateConfig.target === 'transfer_target') {
    const transfer = await getTransferMetadata(ctx.appId, ctx.customerId);
    if (transfer.sourceCustomerId === ctx.customerId) {
      // Initiate event — return the target candidate.
      const targetCustomerId = transfer.targetCandidateShoppers?.[0]?.customerId ?? transfer.targetCustomerId ?? null;
      if (!targetCustomerId) {
        logger.error('processor.target.transfer_target_unresolved', { customerId: ctx.customerId, appId: ctx.appId });
      }
      return targetCustomerId;
    }
    // Accept event — ctx.customerId is already the target.
    return ctx.customerId;
  }

  // transfer_source: event customerId = targetCustomerId; find the sourceCustomerId via mgmt API.
  const transfer = await getTransferMetadata(ctx.appId, ctx.customerId);
  const sourceCustomerId = transfer.sourceCustomerId ?? null;

  if (!sourceCustomerId) {
    logger.error('processor.target.transfer_source_missing', { customerId: ctx.customerId, appId: ctx.appId });
  }

  return sourceCustomerId;
}

/**
 * Evaluates a named guard condition. Returns true if the template should be
 * sent, false if it should be skipped.
 */
async function evaluateGuard(guard: string, ctx: ResolverContext): Promise<boolean> {
  if (guard === 'first_published_app') {
    const count = await getPublishedAppCount(ctx.customerId);
    const passed = count === 1;
    logger.info('processor.guard.first_published_app', {
      customerId: ctx.customerId,
      appId: ctx.appId,
      publishedAppCount: count,
      passed,
    });
    return passed;
  }

  if (guard === 'no_published_app') {
    const count = await getPublishedAppCount(ctx.customerId);
    const passed = count === 0;
    logger.info('processor.guard.no_published_app', {
      customerId: ctx.customerId,
      appId: ctx.appId,
      publishedAppCount: count,
      passed,
    });
    return passed;
  }

  if (guard === 'first_app') {
    const count = await getAppCount(ctx.customerId);
    const passed = count <= 1;
    logger.info('processor.guard.first_app', {
      customerId: ctx.customerId,
      appId: ctx.appId,
      appCount: count,
      passed,
    });
    return passed;
  }

  if (guard === 'for_tla') {
    const customer = await getCustomer(ctx.customerId);
    const passed = customer.shopperId.length === 3;
    logger.info('processor.guard.for_tla', {
      customerId: ctx.customerId,
      appId: ctx.appId,
      shopperId: customer.shopperId,
      passed,
    });
    return passed;
  }

  if (guard === 'transfer_pending') {
    if (!ctx.appId) {
      logger.error('processor.guard.transfer_pending.no_appId', { customerId: ctx.customerId });
      return false;
    }
    const transfer = await getTransferMetadata(ctx.appId, ctx.customerId);
    const passed = transfer.status === 'initiated' || transfer.status === 'expired';
    logger.info('processor.guard.transfer_pending', {
      customerId: ctx.customerId,
      appId: ctx.appId,
      transferStatus: transfer.status,
      passed,
    });
    return passed;
  }

  logger.error('processor.guard.unknown', { guard, ...ctx });
  return false;
}

/** Processes a raw Kinesis event through the full notification pipeline: template lookup,
 * guard evaluation, substitution resolution, and email dispatch. Returns 'sent' or 'skipped'. */
export async function processEvent(raw: unknown, requiredGuard?: GuardName): Promise<'sent' | 'skipped'> {
  const extracted: ExtractedEvent | null = extract(raw);
  if (!extracted) {
    logger.info('processor.event.skipped', { reason: 'missing_fields' });
    return 'skipped';
  }

  const { eid, customerId, appId } = extracted;

  logger.info('processor.event.start', { eid, customerId, appId });

  if (!isServiceEnabled()) {
    const customer = await getCustomer(customerId);
    if (customer.shopperId.length !== 3) {
      logger.info('processor.event.skipped', {
        reason: 'service_disabled_non_tla',
        eid,
        customerId,
        shopperId: customer.shopperId,
      });
      return 'skipped';
    }
    logger.info('processor.event.tla_allowed', { eid, customerId, shopperId: customer.shopperId });
  }

  // Deferred-stream callers pass a requiredGuard that is enforced regardless of Switchboard config,
  // ensuring transfer status is always checked even if the template config omits the guard.
  if (requiredGuard) {
    if (!await evaluateGuard(requiredGuard, { customerId, appId })) {
      logger.info('processor.event.skipped', { reason: 'required_guard_failed', requiredGuard, eid, customerId, appId });
      return 'skipped';
    }
  }

  const templateConfigs = getTemplateConfig(eid);
  if (!templateConfigs) {
    logger.info('processor.event.skipped', { reason: 'no_template_config', eid, customerId, appId });
    return 'skipped';
  }

  const ctx: ResolverContext = { customerId, appId };
  let sentCount = 0;

  for (const templateConfig of templateConfigs) {
    const { templateNamespaceKey, templateTypeKey } = templateConfig;

    try {
      if (templateConfig.guard) {
        const guards = Array.isArray(templateConfig.guard) ? templateConfig.guard : [templateConfig.guard];
        let guardFailed = false;
        for (const guard of guards) {
          if (!await evaluateGuard(guard, ctx)) {
            logger.info('processor.event.template_skipped', {
              reason: 'guard_failed',
              guard,
              eid,
              customerId,
              appId,
              templateTypeKey,
            });
            guardFailed = true;
            break;
          }
        }
        if (guardFailed) continue;
      }

      const resolvedValues = await resolveSubstitutions(templateConfig.substitutionValues ?? {}, ctx);
      if (!resolvedValues) {
        logger.error('processor.event.template_skipped', {
          reason: 'substitution_resolution_failed',
          eid,
          customerId,
          appId,
          templateTypeKey,
        });
        continue;
      }

      const sendToCustomerId = await resolveTargetCustomerId(templateConfig, ctx);
      if (!sendToCustomerId) {
        logger.error('processor.event.template_skipped', {
          reason: 'target_customer_id_unresolved',
          eid,
          customerId,
          appId,
          templateTypeKey,
        });
        continue;
      }

      await sendMessage(sendToCustomerId, {
        templateNamespaceKey,
        templateTypeKey,
        substitutionValues: resolvedValues,
      });

      sentCount++;
      logger.info('processor.event.template_sent', { eid, customerId, appId, sendToCustomerId, templateTypeKey });
    } catch (err) {
      logger.error('processor.event.template_error', {
        eid,
        customerId,
        appId,
        templateTypeKey,
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
    }
  }

  if (eid === 'appbuilder.apps.transfer.initiate_success.click' && appId) {
    const results = await Promise.allSettled([
      putReminderRecord(appId, customerId),
      putExpiryRecord(appId, customerId),
    ]);
    for (const [label, result] of [['reminder', results[0]], ['expiry', results[1]]] as const) {
      if (result.status === 'rejected') {
        logger.error('processor.event.deferred_put_failed', {
          eid,
          appId,
          customerId,
          stream: label,
          error: result.reason instanceof Error ? result.reason.message : String(result.reason),
        });
      }
    }
  }

  if (sentCount === 0) {
    logger.info('processor.event.skipped', { reason: 'no_templates_sent', eid, customerId, appId });
    return 'skipped';
  }

  logger.info('processor.event.sent', { eid, customerId, appId, sentCount });
  return 'sent';
}
