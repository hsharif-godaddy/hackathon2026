import { ALLOWED_OVERRIDE_MODELS } from './constants.js'

export function resolveOverride(params: {
  modelSelectorEnabled: boolean
  perProjectModel?: string
  jwtModelOverride?: string
}): string | undefined {
  const perProject = params.modelSelectorEnabled ? params.perProjectModel : undefined
  return perProject || params.jwtModelOverride || undefined
}

export function guardAllowedOverrideModel(
  effectiveOverride: string | undefined,
  agentName: string,
  logWarn: (event: string, data: Record<string, unknown>) => void,
): string | undefined {
  if (!effectiveOverride) {
    return undefined
  }
  if (!ALLOWED_OVERRIDE_MODELS.has(effectiveOverride)) {
    logWarn('model.override.rejected', {
      effectiveOverride,
      agentName,
      reason: 'not in allowed override set',
    })
    return undefined
  }
  return effectiveOverride
}
