import {
  AppCommerceBindingRepository,
  type UpsertAppCommerceBindingParams,
} from '../../database/repositories/AppCommerceBindingRepository.js';
import type { AppCommerceBinding } from '../../database/schema.js';
import { logger } from '../../logging/index.js';
import { isDevSupervisorNotFound } from '../../services/DevSupervisorClient.js';
import { createForWorkspace } from '../../workspace/index.js';
import {
  formatToolError,
  getAppId,
  getArrayField,
  getStringField,
  isRecord,
  nestedRecord,
  type UnknownRecord,
} from './mcp.js';
import { parseEnvContent } from './env-content.js';

export interface SelectedCommerceResources {
  configured: boolean;
  status: AppCommerceBinding['status'];
  commerceSetupReady: boolean;
  businessId: string | null;
  businessName: string | null;
  storeId: string | null;
  storeName: string | null;
  storeUrl: string | null;
  channelId: string | null;
  channelName: string | null;
  defaultLocationId: string | null;
  currencyCode: string | null;
  source: AppCommerceBinding['source'];
  lastVerifiedAt: string | null;
}

export interface CommerceEnvVars {
  apiBaseUrl: string;
  currencyCode: string;
}

interface CommerceBindingData {
  businessId?: string;
  businessName?: string;
  storeId: string;
  storeName?: string;
  storeUrl?: string;
  channelId?: string;
  channelName?: string;
  defaultLocationId?: string;
  currencyCode?: string;
}

function normalizeCurrencyCode(value: string | null | undefined): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed.toUpperCase() : 'USD';
}

export function readCurrentCommerceBinding(context: unknown): AppCommerceBinding | null {
  const appId = getAppId(context);
  if (!appId) return null;

  try {
    return new AppCommerceBindingRepository().findByAppId(appId);
  } catch (err) {
    logger.warn('commerce_binding.read_failed', {
      appId,
      error: formatToolError(err),
    });
    return null;
  }
}

export function selectedCommerceResourcesFromBinding(
  binding: AppCommerceBinding
): SelectedCommerceResources {
  return {
    configured: true,
    status: binding.status,
    commerceSetupReady: binding.status === 'channel_ready',
    businessId: binding.businessId ?? null,
    businessName: binding.businessName ?? null,
    storeId: binding.storeId ?? null,
    storeName: binding.storeName ?? null,
    storeUrl: binding.storeUrl ?? null,
    channelId: binding.channelId ?? null,
    channelName: binding.channelName ?? null,
    defaultLocationId: binding.defaultLocationId ?? null,
    currencyCode: binding.currencyCode ?? null,
    source: binding.source,
    lastVerifiedAt: binding.lastVerifiedAt?.toISOString() ?? null,
  };
}

export function attachSelectedCommerceResources(
  result: unknown,
  binding: AppCommerceBinding | null
): unknown {
  if (!binding) return result;

  const selectedCommerceResources = selectedCommerceResourcesFromBinding(binding);
  if (isRecord(result)) {
    return {
      ...result,
      selectedCommerceResources,
    };
  }

  return {
    data: result,
    selectedCommerceResources,
  };
}

function normalizeStoreSetupInput(input: Record<string, unknown>): Record<string, unknown> {
  if (input.storePreference !== 'new') return input;

  const { storeId: _storeId, storeUrl: _storeUrl, ...setupInput } = input;
  return setupInput;
}

function hasStringInput(input: Record<string, unknown>, field: string): boolean {
  return typeof input[field] === 'string' && input[field].length > 0;
}

export function applyCommerceBindingDefaultsToStoreSetupInput(
  input: Record<string, unknown>,
  binding: AppCommerceBinding | null
): Record<string, unknown> {
  const setupInput = normalizeStoreSetupInput(input);
  if (!binding) return setupInput;

  const hydratedInput = { ...setupInput };
  if (!hasStringInput(hydratedInput, 'businessId') && binding.businessId) {
    hydratedInput.businessId = binding.businessId;
  }

  if (input.storePreference === 'new') {
    return hydratedInput;
  }

  if (
    !hasStringInput(hydratedInput, 'storeId') &&
    !hasStringInput(hydratedInput, 'storeUrl') &&
    binding.storeId
  ) {
    hydratedInput.storeId = binding.storeId;
  }

  return hydratedInput;
}

export function setupDataFromResult(result: unknown): UnknownRecord | undefined {
  if (!isRecord(result)) return undefined;
  return isRecord(result.data) ? result.data : result;
}

function commerceBindingDataFromResult(
  result: unknown,
  defaults: UnknownRecord = {}
): CommerceBindingData | undefined {
  const resultData = setupDataFromResult(result);
  if (!resultData) return undefined;
  if (resultData.storeChoiceRequired === true || resultData.businessChoiceRequired === true) {
    return undefined;
  }

  const channel =
    nestedRecord(resultData, 'channel') ??
    nestedRecord(resultData, 'salesChannel') ??
    nestedRecord(resultData, 'appChannel');
  const business =
    nestedRecord(resultData, 'business') ??
    nestedRecord(resultData, 'owningBusiness') ??
    nestedRecord(resultData, 'owning_business');
  const contextData = {
    ...defaults,
    ...resultData,
    ...(channel ?? {}),
  };
  const storeId = getStringField(contextData, ['storeId', 'store_id']);
  if (!storeId) return undefined;

  return {
    businessId:
      getStringField(contextData, [
        'businessId',
        'business_id',
        'owningBusinessId',
        'owning_business_id',
      ]) ?? (business ? getStringField(business, ['id', 'businessId', 'business_id']) : undefined),
    businessName:
      getStringField(contextData, ['businessName', 'business_name', 'owningBusinessName']) ??
      (business ? getStringField(business, ['name', 'displayName', 'display_name']) : undefined),
    storeId,
    storeName: getStringField(contextData, [
      'storeName',
      'store_name',
      'displayName',
      'display_name',
    ]),
    storeUrl: getStringField(contextData, [
      'storeUrl',
      'store_url',
      'commerceHomeUrl',
      'commerce_home_url',
      'manageUrl',
      'dashboardUrl',
    ]),
    channelId: getStringField(contextData, [
      'channelId',
      'defaultChannelId',
      'externalChannelId',
      'channel_id',
    ]),
    channelName: getStringField(contextData, ['channelName', 'channel_name', 'name']),
    defaultLocationId: getStringField(contextData, [
      'defaultLocationId',
      'locationId',
      'default_location_id',
    ]),
    currencyCode: getStringField(contextData, [
      'currencyCode',
      'currency',
      'defaultCurrencyCode',
      'currency_code',
    ]),
  };
}

async function projectCommerceBindingToWorkspace(
  appId: string,
  binding: AppCommerceBinding
): Promise<void> {
  const workspace = createForWorkspace(appId, 'preview');
  if (!workspace) return;

  const content = JSON.stringify(
    {
      version: 1,
      appId,
      businessId: binding.businessId ?? null,
      businessName: binding.businessName ?? null,
      storeId: binding.storeId ?? null,
      storeName: binding.storeName ?? null,
      storeUrl: binding.storeUrl ?? null,
      channelId: binding.channelId ?? null,
      channelName: binding.channelName ?? null,
      defaultLocationId: binding.defaultLocationId ?? null,
      currencyCode: binding.currencyCode ?? null,
      status: binding.status,
      source: binding.source,
      updatedAt: binding.updatedAt.toISOString(),
    },
    null,
    2
  );

  await workspace.files.write({
    path: '.airo/commerce-context.json',
    content: `${content}\n`,
  });
}

export async function persistCommerceBindingFromToolResult(
  context: unknown,
  result: unknown,
  defaults: UnknownRecord = {},
  source: 'commerce_store_setup' | 'commerce_store_channel_ensure'
): Promise<AppCommerceBinding | null> {
  const appId = getAppId(context);
  if (!appId) return null;

  const data = commerceBindingDataFromResult(result, defaults);
  if (!data) return null;

  const isChannelReady =
    source === 'commerce_store_channel_ensure' && typeof data.channelId === 'string';

  try {
    const repository = new AppCommerceBindingRepository();
    const previous = repository.findByAppId(appId);
    const previousChannelBinding =
      source === 'commerce_store_setup' &&
      previous?.status === 'channel_ready' &&
      previous.storeId === data.storeId &&
      typeof previous.channelId === 'string'
        ? previous
        : null;
    const upsertParams: UpsertAppCommerceBindingParams = {
      appId,
      storeId: data.storeId,
      status: isChannelReady || previousChannelBinding ? 'channel_ready' : 'store_bound',
      source: isChannelReady
        ? 'tool_channel_ensure'
        : previousChannelBinding
          ? previousChannelBinding.source
          : 'tool_setup',
      lastVerifiedAt: isChannelReady
        ? new Date()
        : previousChannelBinding
          ? previousChannelBinding.lastVerifiedAt
          : undefined,
      verificationError: null,
      eventType: isChannelReady ? 'ensured_channel' : 'selected_store',
      actorType: 'agent',
      reason: source,
      metadata: { source },
    };

    if (data.businessId !== undefined) upsertParams.businessId = data.businessId;
    if (data.businessName !== undefined) upsertParams.businessName = data.businessName;
    if (data.storeName !== undefined) upsertParams.storeName = data.storeName;
    if (data.storeUrl !== undefined) upsertParams.storeUrl = data.storeUrl;
    if (data.defaultLocationId !== undefined) {
      upsertParams.defaultLocationId = data.defaultLocationId;
    }
    if (data.currencyCode !== undefined) upsertParams.currencyCode = data.currencyCode;

    if (isChannelReady) {
      upsertParams.channelId = data.channelId;
      if (data.channelName !== undefined) upsertParams.channelName = data.channelName;
    } else if (source === 'commerce_store_setup') {
      if (previousChannelBinding) {
        upsertParams.channelId = previousChannelBinding.channelId;
        upsertParams.channelName = previousChannelBinding.channelName;
      } else {
        upsertParams.channelId = null;
        upsertParams.channelName = null;
      }
    }

    const binding = repository.upsert(upsertParams);

    try {
      await projectCommerceBindingToWorkspace(appId, binding);
    } catch (projectionError) {
      logger.warn('commerce_binding.workspace_projection_failed', {
        appId,
        storeId: data.storeId,
        source,
        error: formatToolError(projectionError),
      });
    }

    return binding;
  } catch (err) {
    const logData = {
      appId,
      storeId: data.storeId,
      source,
      error: formatToolError(err),
    };
    if (source === 'commerce_store_channel_ensure') {
      logger.error('commerce_binding.persist_failed', logData);
    } else {
      logger.warn('commerce_binding.persist_failed', logData);
    }
    return null;
  }
}

function assertSafeEnvValue(key: string, value: string): void {
  if (/[\r\n]/.test(value)) {
    throw new Error(`Env value for ${key} contains illegal newline characters`);
  }
}

export function mergeEnvContent(existing: string, updates: Record<string, string>): string {
  const lines = existing.split('\n');
  const remaining = { ...updates };

  const updated = lines.map((line) => {
    const eqIdx = line.indexOf('=');
    if (eqIdx <= 0 || line.trimStart().startsWith('#')) return line;
    const key = line.slice(0, eqIdx).trim();
    if (!(key in remaining)) return line;
    const value = remaining[key];
    if (value === undefined) return line;
    delete remaining[key];
    assertSafeEnvValue(key, value);
    return `${key}=${value}`;
  });

  const trailingEmpty = updated.length > 0 && updated[updated.length - 1] === '';
  const base = trailingEmpty ? updated.slice(0, -1) : updated;
  for (const [k, v] of Object.entries(remaining)) {
    assertSafeEnvValue(k, v);
    base.push(`${k}=${v}`);
  }
  return `${base.join('\n')}\n`;
}

function extractCurrencyCode(result: unknown): string | undefined {
  const data = setupDataFromResult(result);
  if (!data) return undefined;
  return getStringField(data, ['currencyCode', 'currency', 'defaultCurrencyCode', 'currency_code']);
}

export function persistProjectedCommerceCurrencyCode(
  appId: string,
  binding: AppCommerceBinding,
  currencyCode: string
): AppCommerceBinding {
  const normalizedCurrencyCode = normalizeCurrencyCode(currencyCode);
  if (binding.currencyCode === normalizedCurrencyCode) {
    return binding;
  }

  try {
    new AppCommerceBindingRepository().upsert({
      appId,
      currencyCode: normalizedCurrencyCode,
      status: binding.status,
      source: binding.source,
      eventType: 'verified',
      actorType: 'agent',
      reason: 'commerce_env_projection',
      metadata: { source: 'commerce_env_projection' },
    });
  } catch (err) {
    logger.warn('commerce_binding.currency_persist_failed', {
      appId,
      currencyCode: normalizedCurrencyCode,
      error: formatToolError(err),
    });
  }

  return { ...binding, currencyCode: normalizedCurrencyCode };
}

export async function writeCommerceEnvVars(
  appId: string,
  binding: AppCommerceBinding,
  envSourceResult: unknown
): Promise<CommerceEnvVars> {
  const workspace = createForWorkspace(appId, 'preview');
  if (!workspace) {
    throw new Error('Workspace not found; cannot write GoDaddy Commerce env vars');
  }

  let existingContent = '';
  try {
    existingContent = await workspace.files.readText({ path: '.env' });
  } catch (err) {
    if (!isDevSupervisorNotFound(err)) {
      throw err;
    }
  }

  const existingEnv = parseEnvContent(existingContent);
  const apiBaseUrl = process.env.GODADDY_API_BASE_URL || existingEnv.GODADDY_API_BASE_URL;
  if (!apiBaseUrl) {
    throw new Error('GODADDY_API_BASE_URL is missing; cannot mark Commerce provisioning ready');
  }

  const currencyCode = normalizeCurrencyCode(
    extractCurrencyCode(envSourceResult) || existingEnv.VITE_GODADDY_CURRENCY_CODE
  );

  const merged = mergeEnvContent(existingContent, {
    GODADDY_STORE_ID: binding.storeId ?? '',
    GODADDY_CHANNEL_ID: binding.channelId ?? '',
    VITE_GODADDY_STORE_ID: binding.storeId ?? '',
    VITE_GODADDY_CHANNEL_ID: binding.channelId ?? '',
    GODADDY_API_BASE_URL: apiBaseUrl,
    GODADDY_CURRENCY_CODE: currencyCode,
    VITE_GODADDY_CURRENCY_CODE: currencyCode,
  });

  await workspace.files.write({ path: '.env', content: merged });
  return { apiBaseUrl, currencyCode };
}
