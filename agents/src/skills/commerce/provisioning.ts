import type { AppCommerceBinding } from '../../database/schema.js';
import { logger } from '../../logging/index.js';
import {
  applyCommerceBindingDefaultsToStoreSetupInput,
  persistCommerceBindingFromToolResult,
  readCurrentCommerceBinding,
  selectedCommerceResourcesFromBinding,
  setupDataFromResult,
  writeCommerceEnvVars,
  type CommerceEnvVars,
} from './binding.js';
import {
  callCommerceMcpTool,
  extractMcpErrorStatusCode,
  formatToolError,
  getArrayField,
  getStringField,
  isRecord,
  nestedRecord,
  requireAppId,
} from './mcp.js';

export { mergeEnvContent } from './binding.js';

const AIRO_CHANNEL_TYPE = 'ONLINE';
const AIRO_CHANNEL_SUB_TYPE = 'airo.ai.builder';
const AIRO_CHANNEL_SOURCE = 'airo-app-builder';
const AIRO_CHANNEL_NAME = 'Airo App Builder';
const AIRO_CHANNEL_PROVIDER_ID = '30373c02-3ab0-4f31-87e6-9c8e99ce83e2';

export interface CommerceProvisionInput {
  storeId?: string;
  businessId?: string;
  storePreference?: 'existing' | 'new';
  firstName?: string;
  lastName?: string;
  email?: string;
  storeName?: string;
}

export type CommerceProvisionPurpose = 'commerce' | 'payments';

interface AiroChannelValidation {
  valid: boolean;
  type?: string;
  subType?: string;
  appId?: string;
}

interface EnsuredChannelBinding {
  binding: AppCommerceBinding;
  channelId: string;
  channelResult: unknown;
}

// Keep provisioning re-entry explicit: both Commerce and GDP derive the next
// action from the durable app binding plus the user's latest answer.
type CommerceProvisionMachineState =
  | {
      phase: 'store_setup_required';
      appId: string;
      purpose: CommerceProvisionPurpose;
      input: CommerceProvisionInput;
      binding: AppCommerceBinding | null;
    }
  | {
      phase: 'channel_ensure_required';
      appId: string;
      purpose: CommerceProvisionPurpose;
      storeId: string;
      envSourceResult?: unknown;
    }
  | {
      phase: 'payment_readiness_check_required';
      appId: string;
      binding: AppCommerceBinding;
    }
  | {
      phase: 'ready_projection_required';
      appId: string;
      purpose: CommerceProvisionPurpose;
      binding: AppCommerceBinding;
      envSourceResult: unknown;
      storeId?: string;
      channelId?: string;
    }
  | {
      phase: 'terminal';
      result: unknown;
    };

function hasExplicitProvisionInput(input: CommerceProvisionInput): boolean {
  return [
    input.storeId,
    input.businessId,
    input.storePreference,
    input.firstName,
    input.lastName,
    input.email,
    input.storeName,
  ].some((value) => typeof value === 'string' && value.length > 0);
}

function validateAiroChannelResult(result: unknown, expectedAppId: string): AiroChannelValidation {
  if (!isRecord(result) || result.isError === true) {
    return { valid: false };
  }

  const channel =
    nestedRecord(result, 'channel') ??
    nestedRecord(result, 'salesChannel') ??
    nestedRecord(result, 'appChannel') ??
    result;
  const externalApp = nestedRecord(channel, 'externalApp') ?? nestedRecord(channel, 'external_app');
  const type = getStringField(channel, ['type', 'channelType']);
  const subType = getStringField(channel, ['subType', 'channelSubType']);
  const source = getStringField(channel, ['source', 'externalAppSource', 'external_app_source']);
  const registrationStatus = getStringField(channel, ['registrationStatus', 'registration_status']);
  const appId =
    getStringField(channel, ['airo_app_id', 'airoAppId', 'externalAppId', 'external_app_id']) ??
    (externalApp ? getStringField(externalApp, ['id', 'appId']) : undefined);
  const isCommerceEnsureSummary =
    source === AIRO_CHANNEL_SOURCE && appId === expectedAppId && registrationStatus === 'ENABLED';
  const effectiveSubType = subType ?? (isCommerceEnsureSummary ? AIRO_CHANNEL_SUB_TYPE : undefined);

  return {
    type,
    subType: effectiveSubType,
    appId,
    valid:
      type === AIRO_CHANNEL_TYPE &&
      effectiveSubType === AIRO_CHANNEL_SUB_TYPE &&
      appId === expectedAppId,
  };
}

function readyResponse(
  storeId: string,
  channelId: string,
  binding: AppCommerceBinding | null,
  env: CommerceEnvVars,
  purpose: CommerceProvisionPurpose
): unknown {
  const commerceHomeUrl = binding?.storeUrl ?? undefined;
  return {
    status: 'ready',
    storeId,
    channelId,
    ...(commerceHomeUrl ? { commerceHomeUrl } : {}),
    apiBaseUrl: env.apiBaseUrl,
    currencyCode: env.currencyCode,
    commerceSetupReady: true,
    ...(purpose === 'payments' ? { paymentSetupReady: true } : {}),
    ...(binding ? { selectedCommerceResources: selectedCommerceResourcesFromBinding(binding) } : {}),
  };
}

function resumeInputFromSetupInput(
  setupInput: Record<string, unknown>
): Record<string, string> | undefined {
  const resumeInput: Record<string, string> = {};
  for (const field of ['businessId', 'storePreference', 'storeName'] as const) {
    const value = setupInput[field];
    if (typeof value === 'string' && value.length > 0) {
      resumeInput[field] = value;
    }
  }
  return Object.keys(resumeInput).length > 0 ? resumeInput : undefined;
}

function appendResumeInput<T extends Record<string, unknown>>(
  status: T,
  resumeInput: Record<string, string> | undefined
): T {
  return resumeInput ? { ...status, resumeInput } : status;
}

function unresolvedStatusFromSetupData(
  setupData: Record<string, unknown>,
  purpose: CommerceProvisionPurpose,
  resumeInput?: Record<string, string>
): unknown | null {
  if (setupData.storeChoiceRequired === true) {
    return appendResumeInput(
      {
        status: 'needs_store_choice',
        stores: getArrayField(setupData, 'existingStores') ?? [],
        instruction:
          'Present these stores via askQuestion, then call provision again with the chosen storeId or storePreference: "new", plus resumeInput when provided.',
      },
      resumeInput
    );
  }
  if (setupData.businessChoiceRequired === true) {
    return {
      status: 'needs_business_choice',
      businesses: getArrayField(setupData, 'businesses') ?? [],
      instruction:
        'Present these businesses via askQuestion, then call provision again with the chosen businessId.',
    };
  }
  if (setupData.needsOwnerIdentity === true || setupData.noExistingStoreFound === true) {
    return appendResumeInput(
      {
        status: 'needs_identity',
        instruction:
          setupData.noExistingStoreFound === true
            ? 'No stores found. Ask for first name, last name, and email to create one, then call provision again with resumeInput when provided.'
            : 'Ask for first name, last name, and email for new store creation, then call provision again with resumeInput when provided.',
      },
      resumeInput
    );
  }
  if (purpose === 'payments' && setupData.paymentsManualSetupRequired === true) {
    return {
      status: 'payments_manual_required',
      manageUrl: getStringField(setupData, ['manageUrl', 'manage_url']),
      instruction:
        'Store is connected but GoDaddy Payments requires manual setup. Direct the user to complete setup in Commerce Home using the manageUrl.',
    };
  }
  if (setupData.storeProvisioningInProgress === true) {
    return {
      status: 'provisioning_in_progress',
      instruction: 'Commerce store setup is still in progress. Do not call provision again yet.',
    };
  }

  return null;
}

function storesFromListResult(result: unknown): unknown[] {
  const data = setupDataFromResult(result);
  if (!data) return [];
  return getArrayField(data, 'stores') ?? getArrayField(data, 'existingStores') ?? [];
}

async function storeCreationConflictStatus(context: unknown): Promise<unknown> {
  try {
    const listResult = await callCommerceMcpTool(context, 'commerce_store_list', {});
    const stores = storesFromListResult(listResult);
    return {
      status: 'needs_store_choice',
      conflict: 'store_creation_conflict',
      stores,
      instruction:
        'Store creation returned 409 because the store already exists. Present the listed stores via askQuestion, then call provision again with the chosen storeId. Do not retry new-store creation.',
    };
  } catch (err) {
    logger.warn('commerce_provisioning.store_creation_conflict_list_failed', {
      error: formatToolError(err),
    });
    return {
      status: 'store_creation_conflict',
      conflict: 'store_creation_conflict',
      instruction:
        'Store creation returned 409 because the store already exists, but existing stores could not be listed. Explain the conflict and retry provisioning only after the user can choose the existing store.',
    };
  }
}

async function ensureAiroChannelBinding(
  appId: string,
  storeId: string,
  context: unknown
): Promise<EnsuredChannelBinding | string> {
  const channelResult = await callCommerceMcpTool(context, 'commerce_app_channel_ensure', {
    storeId,
    channelType: AIRO_CHANNEL_TYPE,
    channelSubType: AIRO_CHANNEL_SUB_TYPE,
    channelName: AIRO_CHANNEL_NAME,
    channelProviderId: AIRO_CHANNEL_PROVIDER_ID,
    externalApp: {
      id: appId,
      name: AIRO_CHANNEL_NAME,
      source: AIRO_CHANNEL_SOURCE,
    },
  });

  const validation = validateAiroChannelResult(channelResult, appId);
  if (!validation.valid) {
    logger.warn('commerce_provisioning.invalid_airo_channel', {
      storeId,
      type: validation.type,
      subType: validation.subType,
      expectedAppId: appId,
      actualAppId: validation.appId,
    });
    return `commerce provisioning error: Commerce did not return a valid Airo App Builder channel for this app.`;
  }

  const channelReadyBinding = await persistCommerceBindingFromToolResult(
    context,
    channelResult,
    { storeId, channelName: AIRO_CHANNEL_NAME },
    'commerce_store_channel_ensure'
  );

  const resolvedChannelId =
    channelReadyBinding?.channelId ??
    (isRecord(channelResult)
      ? getStringField(channelResult, ['channelId', 'externalChannelId', 'channel_id'])
      : undefined);

  if (!resolvedChannelId) {
    return `commerce provisioning error: channel ensure did not return a channelId`;
  }

  if (!channelReadyBinding) {
    return `commerce provisioning error: channel binding could not be persisted`;
  }

  return {
    binding: channelReadyBinding,
    channelId: resolvedChannelId,
    channelResult,
  };
}

function terminal(result: unknown): CommerceProvisionMachineState {
  return { phase: 'terminal', result };
}

function initialProvisionState(
  appId: string,
  input: CommerceProvisionInput,
  purpose: CommerceProvisionPurpose,
  binding: AppCommerceBinding | null
): CommerceProvisionMachineState {
  const explicitInput = hasExplicitProvisionInput(input);

  if (!explicitInput && binding?.status === 'channel_ready' && binding.storeId && binding.channelId) {
    if (purpose === 'payments') {
      return { phase: 'payment_readiness_check_required', appId, binding };
    }

    return {
      phase: 'ready_projection_required',
      appId,
      purpose,
      binding,
      envSourceResult: binding,
      storeId: binding.storeId,
      channelId: binding.channelId,
    };
  }

  if (!explicitInput && binding?.status === 'store_bound' && binding.storeId) {
    return {
      phase: 'channel_ensure_required',
      appId,
      purpose,
      storeId: binding.storeId,
    };
  }

  return {
    phase: 'store_setup_required',
    appId,
    purpose,
    input,
    binding,
  };
}

async function transitionProvisionState(
  state: CommerceProvisionMachineState,
  context: unknown
): Promise<CommerceProvisionMachineState> {
  switch (state.phase) {
    case 'terminal':
      return state;

    case 'payment_readiness_check_required': {
      const setupInput = applyCommerceBindingDefaultsToStoreSetupInput({}, state.binding);
      const setupResult = await callCommerceMcpTool(context, 'commerce_store_setup', setupInput);
      const setupData = setupDataFromResult(setupResult);

      if (isRecord(setupData)) {
        const unresolvedStatus = unresolvedStatusFromSetupData(
          setupData,
          'payments',
          resumeInputFromSetupInput(setupInput)
        );
        if (unresolvedStatus) return terminal(unresolvedStatus);
      }

      const refreshedBinding =
        (await persistCommerceBindingFromToolResult(
          context,
          setupResult,
          setupInput,
          'commerce_store_setup'
        )) ?? state.binding;

      if (
        refreshedBinding.status === 'channel_ready' &&
        refreshedBinding.storeId &&
        refreshedBinding.channelId
      ) {
        return {
          phase: 'ready_projection_required',
          appId: state.appId,
          purpose: 'payments',
          binding: refreshedBinding,
          envSourceResult: setupResult,
          storeId: refreshedBinding.storeId,
          channelId: refreshedBinding.channelId,
        };
      }

      return terminal(
        `commerce provisioning error: existing Commerce binding could not be verified for GoDaddy Payments`
      );
    }

    case 'ready_projection_required': {
      const storeId = state.storeId ?? state.binding.storeId;
      const channelId = state.channelId ?? state.binding.channelId;
      if (!storeId || !channelId) {
        return terminal(`commerce provisioning error: ready binding is missing storeId or channelId`);
      }

      const env = await writeCommerceEnvVars(state.appId, state.binding, state.envSourceResult);
      return terminal(readyResponse(storeId, channelId, state.binding, env, state.purpose));
    }

    case 'channel_ensure_required': {
      const ensured = await ensureAiroChannelBinding(state.appId, state.storeId, context);
      if (typeof ensured === 'string') return terminal(ensured);

      return {
        phase: 'ready_projection_required',
        appId: state.appId,
        purpose: state.purpose,
        binding: ensured.binding,
        envSourceResult: state.envSourceResult ?? ensured.channelResult,
        storeId: ensured.binding.storeId ?? state.storeId,
        channelId: ensured.channelId,
      };
    }

    case 'store_setup_required': {
      const setupInput = applyCommerceBindingDefaultsToStoreSetupInput(
        state.input as Record<string, unknown>,
        state.binding
      );
      const setupResult = await callCommerceMcpTool(context, 'commerce_store_setup', setupInput);
      if (extractMcpErrorStatusCode(setupResult) === 409) {
        return terminal(await storeCreationConflictStatus(context));
      }

      const setupData = setupDataFromResult(setupResult);

      if (isRecord(setupData)) {
        const unresolvedStatus = unresolvedStatusFromSetupData(
          setupData,
          state.purpose,
          resumeInputFromSetupInput(setupInput)
        );
        if (unresolvedStatus) return terminal(unresolvedStatus);
      }

      const storeBoundBinding = await persistCommerceBindingFromToolResult(
        context,
        setupResult,
        setupInput,
        'commerce_store_setup'
      );

      const resolvedStoreId =
        storeBoundBinding?.storeId ??
        (isRecord(setupData) ? getStringField(setupData, ['storeId', 'store_id']) : undefined);

      if (!resolvedStoreId) {
        return terminal(`commerce provisioning error: store setup did not return a storeId`);
      }

      if (
        storeBoundBinding?.status === 'channel_ready' &&
        storeBoundBinding.storeId &&
        storeBoundBinding.channelId
      ) {
        return {
          phase: 'ready_projection_required',
          appId: state.appId,
          purpose: state.purpose,
          binding: storeBoundBinding,
          envSourceResult: setupResult,
          storeId: storeBoundBinding.storeId,
          channelId: storeBoundBinding.channelId,
        };
      }

      return {
        phase: 'channel_ensure_required',
        appId: state.appId,
        purpose: state.purpose,
        storeId: resolvedStoreId,
        envSourceResult: setupResult,
      };
    }
  }
}

export async function provisionCommerceForApp(
  input: CommerceProvisionInput,
  context: unknown,
  purpose: CommerceProvisionPurpose
): Promise<unknown> {
  const appId = requireAppId(context);
  const binding = readCurrentCommerceBinding(context);
  let state = initialProvisionState(appId, input, purpose, binding);
  let transitionCount = 0;

  while (state.phase !== 'terminal') {
    transitionCount += 1;
    if (transitionCount > 10) {
      return `commerce provisioning error: provision state machine exceeded transition limit`;
    }
    state = await transitionProvisionState(state, context);
  }

  return state.result;
}
