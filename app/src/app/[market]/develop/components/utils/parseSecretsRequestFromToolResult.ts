import type {
  SecretDefinition,
  SecretsRequestPayload,
} from '@/app/[market]/develop/components/ChatSecretsRequestMessage'
import { logger } from '@/lib/request-context'

export interface ParseSecretsRequestContext {
  toolCallId?: string
}

/**
 * Result of parsing a tool result for secrets request.
 * Discriminated union allows consumers to distinguish between:
 * - 'none': Not a secrets request (secretsRequired is falsy)
 * - 'invalid': Malformed payload (secretsRequired is true but payload is invalid)
 * - 'ok': Valid secrets request with parsed payload
 */
export type ParseSecretsRequestResult =
  | { kind: 'none' }
  | { kind: 'invalid'; reason: string }
  | { kind: 'ok'; payload: SecretsRequestPayload }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseSecretDefinition(value: unknown): SecretDefinition | null {
  if (!isRecord(value)) {
    return null
  }
  if (typeof value.name !== 'string') {
    return null
  }
  const definition: SecretDefinition = { name: value.name }
  if (typeof value.description === 'string') {
    definition.description = value.description
  }
  if (typeof value.required === 'boolean') {
    definition.required = value.required
  }
  if (typeof value.isExisting === 'boolean') {
    definition.isExisting = value.isExisting
  }
  if (typeof value.defaultValue === 'string') {
    definition.defaultValue = value.defaultValue
  }
  return definition
}

function warnInvalidPayload(context: ParseSecretsRequestContext | undefined, reason: string) {
  logger.warn('secrets.request.payload.invalid', {
    toolCallId: context?.toolCallId,
    reason,
  })
}

function unwrapSecretsToolResult(result: unknown): Record<string, unknown> | null {
  if (!isRecord(result)) {
    return null
  }
  if (result.secretsRequired !== undefined || result.secretsRequest !== undefined) {
    return result
  }
  if (isRecord(result.output)) {
    return result.output
  }
  return result
}

/**
 * Parse a tool result for a secrets request.
 * @returns Discriminated union allowing consumers to distinguish between
 *   not-a-secrets-request vs. malformed-payload and show inline errors.
 */
export function parseSecretsRequest(
  result: unknown,
  context?: ParseSecretsRequestContext,
): ParseSecretsRequestResult {
  const record = unwrapSecretsToolResult(result)
  if (!record || !record.secretsRequired) {
    return { kind: 'none' }
  }
  const raw = record.secretsRequest
  if (!isRecord(raw)) {
    warnInvalidPayload(context, 'secretsRequest')
    return { kind: 'invalid', reason: 'secretsRequest' }
  }
  if (raw.mode !== 'add' && raw.mode !== 'update') {
    warnInvalidPayload(context, 'mode')
    return { kind: 'invalid', reason: 'mode' }
  }
  if (typeof raw.title !== 'string' || typeof raw.description !== 'string') {
    warnInvalidPayload(context, 'title_or_description')
    return { kind: 'invalid', reason: 'title_or_description' }
  }
  if (!Array.isArray(raw.secrets)) {
    warnInvalidPayload(context, 'secrets')
    return { kind: 'invalid', reason: 'secrets' }
  }

  const secrets: SecretDefinition[] = []
  for (const item of raw.secrets) {
    const definition = parseSecretDefinition(item)
    if (!definition) {
      warnInvalidPayload(context, 'secret_definition')
      return { kind: 'invalid', reason: 'secret_definition' }
    }
    secrets.push(definition)
  }

  return {
    kind: 'ok',
    payload: {
      type: 'secrets_request',
      title: raw.title,
      description: raw.description,
      secrets,
      mode: raw.mode,
      allowMultiple: typeof raw.allowMultiple === 'boolean' ? raw.allowMultiple : false,
      showSettingsLink: typeof raw.showSettingsLink === 'boolean' ? raw.showSettingsLink : true,
      autoSubmit: typeof raw.autoSubmit === 'boolean' ? raw.autoSubmit : false,
      existingSecretNames: Array.isArray(raw.existingSecretNames)
        ? raw.existingSecretNames.filter((name): name is string => typeof name === 'string')
        : undefined,
    },
  }
}

/**
 * Legacy helper that returns null for both 'none' and 'invalid'.
 * Use parseSecretsRequest() directly to distinguish the cases.
 * @deprecated Use parseSecretsRequest() for better error handling
 */
export function parseSecretsRequestFromToolResult(
  result: unknown,
  context?: ParseSecretsRequestContext,
): SecretsRequestPayload | null {
  const parsed = parseSecretsRequest(result, context)
  return parsed.kind === 'ok' ? parsed.payload : null
}
