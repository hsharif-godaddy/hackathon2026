/**
 * Canonical Airo platform host suffixes.
 *
 * The cell token is the DNS label immediately preceding one of these suffixes in
 * every app URL shape — publish "<app>.<cell><suffix>", preview
 * "<app>.preview.<cell><suffix>", agent "<app>.agent.<cell><suffix>" — across the
 * prod ("*.airoapp.ai") and test ("*.test-airoapp.ai") domains.
 *
 * Single source of truth: consumed by MediaManifestService (preview-host detection)
 * and by the post-clone identity rewrite (cell anchoring). Add new platform domains
 * here so every consumer picks them up automatically.
 */
export const AIRO_HOST_SUFFIXES = ['.airoapp.ai', '.test-airoapp.ai'] as const;
