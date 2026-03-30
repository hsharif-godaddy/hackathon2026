/**
 * Minimal domain row shape for attach-widget / domain-tool checks.
 * Matches site store and app-details domain payloads (string statuses).
 */
export interface SiteDomainForAttachCheck {
  fqdn: string
  domainType?: string | null
  status?: string | null
}

/**
 * True when a non-prefix FQDN on the app is already connected or in a
 * transitional attach state (empty status, active, pending).
 * `deleting` is excluded so re-attach is not blocked during slow/failed detach.
 * Failed / error / inactive rows are excluded so the UI can offer retry.
 */
export function fqdnIsConnectedOrProvisioningOnSite(
  domains: SiteDomainForAttachCheck[] | undefined,
  fqdn: string
): boolean {
  if (!domains?.length) return false
  const target = fqdn.trim().toLowerCase()
  return domains.some((d) => {
    if (d.domainType === 'prefix') return false
    if (d.fqdn.trim().toLowerCase() !== target) return false
    const s = (d.status ?? '').toLowerCase()
    if (!s) return true
    if (s === 'active' || s === 'pending') return true
    return false
  })
}
