/**
 * Minimal domain row shape for attach-widget / domain-tool checks.
 * Matches site store and app-details domain payloads (string statuses).
 */
export interface SiteDomainForAttachCheck {
  fqdn: string
  domainType?: string | null
  status?: string | null
}

function isConnectedOrProvisioningStatus(status: string | null | undefined): boolean {
  const s = (status ?? '').toLowerCase()
  return !s || s === 'active' || s === 'pending'
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
    return isConnectedOrProvisioningStatus(d.status)
  })
}

/**
 * Returns the first non-prefix custom domain that is connected or provisioning,
 * preferring an active entry over a pending/transitional one.
 * Returns undefined when no such domain exists.
 */
export function getConnectedOrProvisioningDomain(
  domains: SiteDomainForAttachCheck[] | undefined
): SiteDomainForAttachCheck | undefined {
  if (!domains?.length) return undefined
  const candidates = domains.filter(
    (d) => d.domainType !== 'prefix' && !!d.fqdn && isConnectedOrProvisioningStatus(d.status)
  )
  return candidates.find((d) => (d.status ?? '').toLowerCase() === 'active') ?? candidates[0]
}
