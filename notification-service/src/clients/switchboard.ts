import { destroyAllClients, getClient, startClient } from '@switchboard/client';

import { config } from '../config.js';
import { logger } from '../logger.js';

export type GuardName = 'first_app' | 'first_published_app' | 'no_published_app';

export interface TemplateConfig {
  templateNamespaceKey: string;
  templateTypeKey: string;
  substitutionValues?: Record<string, string>;
  /**
   * Controls which customerId is used when dispatching the email.
   * - 'event_customer' (default): send to the customerId from the Kinesis event.
   * - 'transfer_target': event customerId = sourceCustomerId; look up transfer to send to targetCustomerId.
   *   Falls back to event customerId when it is already the targetCustomerId (accept events).
   * - 'transfer_source': event customerId = targetCustomerId; look up transfer to send to sourceCustomerId.
   */
  target?: 'event_customer' | 'transfer_target' | 'transfer_source';
  /**
   * Optional guard(s) that must ALL pass before the email is sent.
   * Accepts a single guard name or an array; all guards must pass (AND logic).
   * - 'first_published_app': only send if this is the customer's first published app
   *   (published app count == 1 at time of event).
   * - 'no_published_app': only send if the customer has no published apps yet
   *   (published app count == 0 at time of event).
   * - 'first_app': only send if the customer has at most 1 app total (published or not).
   *   Used to welcome new users on their first app creation.
   */
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

/**
 * Returns the template configs for the given eid by looking them up in the
 * `appbuilder-email-template-mapping` setting cached locally by the SDK.
 * Supports both a single TemplateConfig object and an array of TemplateConfig objects.
 * Returns null when the eid has no registered mapping.
 */
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
