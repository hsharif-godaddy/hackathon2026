import { destroyAllClients, getClient, startClient } from '@switchboard/client';

import { config } from '../config.js';
import { logger } from '../logger.js';

export type GuardName = 'first_app' | 'first_published_app' | 'for_tla' | 'no_published_app' | 'transfer_pending';

export interface TemplateConfig {
  templateNamespaceKey: string;
  templateTypeKey: string;
  substitutionValues?: Record<string, string>;
  /** Controls which customerId the email is dispatched to: 'event_customer' (default),
   * 'transfer_target' (looks up targetCustomerId), or 'transfer_source' (looks up sourceCustomerId). */
  target?: 'event_customer' | 'transfer_target' | 'transfer_source';
  /** Optional guard(s) — all must pass (AND logic) before the email is sent. Accepts a single
   * name or an array. Each guard is evaluated live against mgmt-airo at send time. */
  guard?: GuardName | GuardName[];
}

type TemplateMappingEntry = TemplateConfig | TemplateConfig[];
type TemplateMapping = Record<string, TemplateMappingEntry>;

const SETTING_NAME = 'appbuilder-email-template-mapping';
const ENABLED_FLAG = 'airobuilder-notification-service';

/**
 * Initialises the Switchboard singleton client and blocks until the local
 * cache is populated. Must be called once before any `getTemplateConfig` call.
 */
export async function startSwitchboardClient(): Promise<void> {
  logger.info('switchboard.client.init_start', {
    env: config.SWITCHBOARD_ENV,
    app: config.SWITCHBOARD_APP,
    region: config.AWS_REGION,
    settings: [SETTING_NAME, ENABLED_FLAG],
  });

  await startClient({
    callingService: 'notification-service',
    env: config.SWITCHBOARD_ENV,
    auth: {
      primaryRegion: config.AWS_REGION,
      secondaryRegion: 'us-east-1',
    },
    dataRetrieval: {
      [config.SWITCHBOARD_APP]: {
        settings: [SETTING_NAME, ENABLED_FLAG],
      },
    },
  });

  logger.info('switchboard.client.init_done', {
    env: config.SWITCHBOARD_ENV,
    app: config.SWITCHBOARD_APP,
  });
}

/** Tears down the Switchboard client. Call on graceful shutdown. */
export async function stopSwitchboardClient(): Promise<void> {
  logger.info('switchboard.client.destroy_start');
  destroyAllClients();
  logger.info('switchboard.client.destroy_done');
}

/**
 * Returns whether the notification service should actively consume events.
 * Defaults to true when the flag is absent so the service runs out of the box.
 */
export function isServiceEnabled(): boolean {
  return getClient().getValue<boolean>(
    config.SWITCHBOARD_APP,
    ENABLED_FLAG,
    undefined,
    true,
  );
}

/** Returns template configs for the given eid from the cached Switchboard mapping.
 * Returns null when the eid has no registered mapping. */
export function getTemplateConfig(eid: string): TemplateConfig[] | null {
  const mapping = getClient().getValue<TemplateMapping>(
    config.SWITCHBOARD_APP,
    SETTING_NAME,
    undefined,
    {},
  );
  const entry = mapping[eid] ?? null;

  if (!entry) {
    logger.warn('switchboard.template.not_found', { eid, registeredEids: Object.keys(mapping) });
    return null;
  }

  const configs = Array.isArray(entry) ? entry : [entry];
  logger.debug('switchboard.template.found', {
    eid,
    count: configs.length,
    templates: configs.map(c => ({
      templateNamespaceKey: c.templateNamespaceKey,
      templateTypeKey: c.templateTypeKey,
    })),
  });
  return configs;
}
