/**
 * Per-app metadata: an open bag of arbitrary keys, stamped early in an app's
 * life by any producer and surfaced in the debug console. Stored as a single
 * JSON object per app in the agents `app_metadata` table.
 *
 * This is the generic platform type — it intentionally knows nothing about any
 * specific signal's shape. Producers (e.g. design-kit provenance) define and own
 * their own key types and write them through `mergeAppMetadata`.
 *
 * Holds structural/behavioral build signals only — do NOT store customer PII
 * here; this object is rendered verbatim in the internal debug console.
 */
export type AppMetadata = Record<string, unknown>;

/**
 * Canonical well-known keys within the open `AppMetadata` bag. This interface
 * exists so producers/consumers of established signals are not stringly-typed;
 * the underlying record stays open and may hold keys not listed here.
 */
export interface KnownAppMetadata {
  /** Purchased domain carried in from the DPP handoff (mirrors SiteInfo.fqdn). */
  fqdn?: string;
}
