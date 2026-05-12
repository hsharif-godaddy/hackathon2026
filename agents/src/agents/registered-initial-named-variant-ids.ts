/** Agent ids registered at factory startup for named initial-agent manifest variants (e.g. initial-prompt-enhancer). */
let registeredNamedVariants = new Map<string, string>()

/**
 * Register named variant agent ids keyed by the variant name used in
 * `initial.promptVersion` profile values. Values are the agent ids.
 */
export function setRegisteredInitialNamedVariantIds(byVersion: ReadonlyMap<string, string>): void {
  registeredNamedVariants = new Map(byVersion)
}

export function getRegisteredInitialNamedVariantAgentId(versionName: string): string | undefined {
  return registeredNamedVariants.get(versionName)
}

export function getRegisteredInitialNamedVariantVersions(): ReadonlySet<string> {
  return new Set(registeredNamedVariants.keys())
}
