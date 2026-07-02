/** Canonical query param selecting the agent "mode" at create/homepage entry points. */
export const MODE_PARAM = 'mode'
/** Legacy alias kept working during the `?template=` → `?mode=` transition. */
export const LEGACY_MODE_PARAM = 'template'

/**
 * Reads the mode selection, preferring the canonical `mode` param and falling
 * back to the legacy `template` param. The parameter type accepts both
 * `URLSearchParams` and Next's `ReadonlyURLSearchParams` since both expose `.get`.
 */
export function getModeParam(params: { get(key: string): string | null }): string | null {
  return params.get(MODE_PARAM) ?? params.get(LEGACY_MODE_PARAM)
}
