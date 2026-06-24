/**
 * Single source of truth for the mgmt-airo base URL, so the
 * `process.env.MGMT_AIRO_BASE_URL || '…'` default isn't copy-pasted (and can't
 * silently diverge) across the mgmt-airo helpers.
 */
export function getMgmtAiroBaseUrl(): string {
  return process.env.MGMT_AIRO_BASE_URL || 'https://mgmt.nstk.net';
}
