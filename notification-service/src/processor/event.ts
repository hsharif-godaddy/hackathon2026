import { getApp, getAppCount, getPublishedAppCount, getTransferMetadata } from '../clients/mgmt.js';
import { sendMessage } from '../clients/messaging.js';
import { getCustomer } from '../clients/pie.js';
import { getTemplateConfig, isServiceEnabled, type TemplateConfig } from '../clients/switchboard.js';
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

/**
 * Registry mapping placeholder names (the part between ## markers) to resolver functions.
 * Add a new entry here to support a new placeholder from Switchboard — no other changes needed.
 */
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

/**
 * Resolves all substitution values that contain ##key## placeholders.
 * Runs all resolutions in parallel.
 *
 * Returns null if any required placeholder could not be resolved
 * (signals the caller to skip the event).
 */
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

/**
 * Resolves the customerId to use when dispatching the email for a given template.
 * - 'event_customer' (default): use the event's customerId (the transfer initiator).
 * - 'transfer_target': use the transfer's targetCustomerId (the invited recipient).
 *
 * Returns null if the target customer cannot be determined (e.g. transfer not found),
 * which causes the caller to skip that template.
 */
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

  logger.error('processor.guard.unknown', { guard, ...ctx });
  return false;
}

/**
 * Processes a single raw Kinesis event through the full notification pipeline.
 *
 * An event may trigger multiple emails (e.g. one to the sender, one to the recipient).
 * Each template is processed sequentially; individual templates are skipped when their
 * substitutions or target customer cannot be resolved, without aborting the others.
 *
 * Returns 'skipped' when the event is missing required fields, has no registered templates,
 * or all templates were skipped.
 * Returns 'sent' when at least one email was dispatched.
 * Throws on unexpected errors — callers should catch and log.
 */
export async function processEvent(raw: unknown): Promise<'sent' | 'skipped'> {
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

  if (sentCount === 0) {
    logger.info('processor.event.skipped', { reason: 'no_templates_sent', eid, customerId, appId });
    return 'skipped';
  }

  logger.info('processor.event.sent', { eid, customerId, appId, sentCount });
  return 'sent';
}
