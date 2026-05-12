import type { AgentConfig } from '@airo/ai-lib'

/**
 * Picks which initial agent config receives develop-variant handoff wiring for a profile.
 *
 * **Priority vs `agent-router`:** If both `initial.promptVersion === '2.0'` and a registered
 * `initial-v3-<profile>` modular variant exist, **2.0 wins here** (handoff is wired on
 * `initialV2Config`). The router still prefers the modular branch first and selects
 * `initial-v3-<profile>` for new sessions — so develop-handoff wiring may attach to v2 while
 * the live session agent is the modular v3 variant. Avoid setting both on one profile.
 *
 * **Named manifest variants:** when `promptVersion` is a non-numeric value (e.g.
 * `"prompt-enhancer"`) that maps to a registered named-variant config, that config is
 * returned so the factory can rewire its handoff tool to the profile's `develop-<name>`
 * variant. Without this, a profile with both `develop.*` flags and a non-numeric
 * `initial.promptVersion` would silently fall through to base `develop` on handoff.
 */
export function resolveInitialVariantForProfileHandoff(options: {
  promptVersion: string
  profileName: string
  profileInitialV3ModularConfigs: Record<string, AgentConfig>
  namedVariantInitialConfigs?: Record<string, AgentConfig>
  initialV2Config: AgentConfig
  initialV3Config: AgentConfig
}): AgentConfig | null {
  const modularVariantId = `initial-v3-${options.profileName}`
  const modularVariant = options.profileInitialV3ModularConfigs[modularVariantId]
  const usesV3Family = options.promptVersion === '3.0' || !!modularVariant
  if (options.promptVersion === '2.0') return options.initialV2Config
  if (usesV3Family) return modularVariant ?? options.initialV3Config
  const trimmed = options.promptVersion?.trim() ?? ''
  if (trimmed.length > 0 && !/^\d+(\.\d+)*$/.test(trimmed)) {
    const namedVariantId = `initial-${trimmed}`
    const namedVariant = options.namedVariantInitialConfigs?.[namedVariantId]
    if (namedVariant) return namedVariant
  }
  return null
}
