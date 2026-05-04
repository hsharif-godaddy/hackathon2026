/** Agent ids registered at factory startup for profile-specific initial-v3 modular prompts. */
let registeredIds = new Set<string>()

export function setRegisteredInitialV3ModularAgentIds(ids: ReadonlySet<string>): void {
  registeredIds = new Set(ids)
}

export function getRegisteredInitialV3ModularAgentIds(): ReadonlySet<string> {
  return registeredIds
}
