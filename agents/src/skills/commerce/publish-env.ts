import {
  AppCommerceBindingRepository,
} from '../../database/repositories/AppCommerceBindingRepository.js';
import type { AppCommerceBinding, AppCommerceBindingEvent } from '../../database/schema.js';
import { Logger } from '../../logging/index.js';
import { isDevSupervisorNotFound } from '../../services/DevSupervisorClient.js';
import { createForWorkspace } from '../../workspace/index.js';
import {
  emptyPublishEnvProjection,
  type PublishEnvProjection,
} from '../../publish-env/types.js';
import { parseEnvContent } from './env-content.js';

const logger = Logger.create({ component: 'commerce-publish-env' });

interface CommercePublishEnvValues {
  storeId: string;
  channelId: string;
  currencyCode: string;
}

const COMMERCE_ENV_KEYS = {
  storeId: ['GODADDY_STORE_ID', 'VITE_GODADDY_STORE_ID'],
  channelId: ['GODADDY_CHANNEL_ID', 'VITE_GODADDY_CHANNEL_ID'],
  currencyCode: ['GODADDY_CURRENCY_CODE', 'VITE_GODADDY_CURRENCY_CODE'],
} as const;

function normalizeCurrencyCode(value: string | null | undefined): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed.toUpperCase() : 'USD';
}

function addUpdatePolicy(
  updateIfCurrentValueIn: Record<string, string[]>,
  keys: readonly string[],
  values: string[]
): void {
  const allowedValues = [...new Set(values.filter((value) => value.length > 0))];
  if (allowedValues.length === 0) return;

  for (const key of keys) {
    updateIfCurrentValueIn[key] = allowedValues;
  }
}

function metadataString(event: AppCommerceBindingEvent, key: string): string | undefined {
  const value = event.metadata?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function buildUpdatePolicy(
  values: CommercePublishEnvValues,
  events: AppCommerceBindingEvent[]
): Record<string, string[]> | undefined {
  const updateIfCurrentValueIn: Record<string, string[]> = {};

  addUpdatePolicy(
    updateIfCurrentValueIn,
    COMMERCE_ENV_KEYS.storeId,
    events
      .map((event) => event.previousStoreId)
      .filter((value): value is string => Boolean(value && value !== values.storeId))
  );

  addUpdatePolicy(
    updateIfCurrentValueIn,
    COMMERCE_ENV_KEYS.channelId,
    events
      .map((event) => event.previousChannelId)
      .filter((value): value is string => Boolean(value && value !== values.channelId))
  );

  addUpdatePolicy(
    updateIfCurrentValueIn,
    COMMERCE_ENV_KEYS.currencyCode,
    events
      .map((event) => metadataString(event, 'previousCurrencyCode'))
      .filter((value): value is string => Boolean(value && value !== values.currencyCode))
  );

  return Object.keys(updateIfCurrentValueIn).length > 0 ? updateIfCurrentValueIn : undefined;
}

function valuesFromBinding(binding: AppCommerceBinding): CommercePublishEnvValues | null {
  const storeId = binding.storeId?.trim();
  const channelId = binding.channelId?.trim();
  if (!storeId || !channelId) return null;

  return {
    storeId,
    channelId,
    currencyCode: normalizeCurrencyCode(binding.currencyCode),
  };
}

function projectionFromValues(
  values: CommercePublishEnvValues,
  events: AppCommerceBindingEvent[] = []
): PublishEnvProjection {
  const vars: Record<string, string> = {
    GODADDY_STORE_ID: values.storeId,
    VITE_GODADDY_STORE_ID: values.storeId,
    GODADDY_CHANNEL_ID: values.channelId,
    VITE_GODADDY_CHANNEL_ID: values.channelId,
    GODADDY_CURRENCY_CODE: values.currencyCode,
    VITE_GODADDY_CURRENCY_CODE: values.currencyCode,
  };
  const updateIfCurrentValueIn = buildUpdatePolicy(values, events);

  return updateIfCurrentValueIn ? { vars, updateIfCurrentValueIn } : { vars };
}

async function readEnvFallbackValues(appId: string): Promise<CommercePublishEnvValues | null> {
  const workspace = createForWorkspace(appId, 'preview');
  if (!workspace) return null;

  let content = '';
  try {
    content = (await workspace.files.view({ path: '.env' })).content;
  } catch (err) {
    if (!isDevSupervisorNotFound(err)) {
      logger.warn('commerce_publish_env.env_fallback_read_failed', {
        appId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return null;
  }

  const env = parseEnvContent(content);
  const storeId = (env.GODADDY_STORE_ID || env.VITE_GODADDY_STORE_ID || '').trim();
  const channelId = (env.GODADDY_CHANNEL_ID || env.VITE_GODADDY_CHANNEL_ID || '').trim();
  if (!storeId || !channelId) return null;

  return {
    storeId,
    channelId,
    currencyCode: normalizeCurrencyCode(env.GODADDY_CURRENCY_CODE || env.VITE_GODADDY_CURRENCY_CODE),
  };
}

async function reconstructBindingFromEnv(
  appId: string,
  repository: AppCommerceBindingRepository
): Promise<AppCommerceBinding | CommercePublishEnvValues | null> {
  const values = await readEnvFallbackValues(appId);
  if (!values) return null;

  try {
    return repository.upsert({
      appId,
      storeId: values.storeId,
      channelId: values.channelId,
      currencyCode: values.currencyCode,
      status: 'channel_ready',
      source: 'env_fallback',
      eventType: 'verified',
      actorType: 'migration',
      reason: 'Commerce publish env reconstructed from preview .env',
      metadata: { source: 'env_fallback' },
    });
  } catch (err) {
    logger.warn('commerce_publish_env.env_fallback_persist_failed', {
      appId,
      error: err instanceof Error ? err.message : String(err),
    });
    return values;
  }
}

export async function getCommercePublishEnv(appId: string): Promise<PublishEnvProjection> {
  const repository = new AppCommerceBindingRepository();
  const binding = repository.findByAppId(appId) ?? await reconstructBindingFromEnv(appId, repository);
  if (!binding) return emptyPublishEnvProjection();

  if ('status' in binding && binding.status !== 'channel_ready') {
    return emptyPublishEnvProjection();
  }

  const values = 'status' in binding ? valuesFromBinding(binding) : binding;
  if (!values) return emptyPublishEnvProjection();

  const events = 'status' in binding ? repository.listEventsByAppId(appId, 20) : [];
  return projectionFromValues(values, events);
}
