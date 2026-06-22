import { AppMetadataRepository } from '../../database/index.js'

// Construct per call (NOT a module-level singleton): AppMetadataRepository resolves
// the DB eagerly in a field initializer (`private db = getDatabase()`), so a
// module-level instance would call getDatabase() at IMPORT time — throwing in any
// module that transitively imports this helper (e.g. font-theme.ts) before the DB
// singleton is initialized, which breaks test collection. Per-call construction is
// cheap (getDatabase() is a singleton + a Logger.create) and import-safe.

/**
 * True when the app's design-kit tokens were applied DETERMINISTICALLY IN CODE
 * by the forced-install path (`forced-install.ts` → `applyKitDesignTokens`),
 * recorded as the `designKitTokensLocked` app-metadata marker. Synchronous,
 * in-process SQLite read — cheap enough to call inside a tool execute handler.
 *
 * Used to lock the colorScheme/fontTheme tools so the model can't override the
 * in-code-applied kit palette/fonts (see apply-kit-design.ts). Only the
 * gallery/`-attached` path sets this; the design-kit WIZARD applies the kit by
 * CALLING those tools in apply mode and never runs applyKitDesignTokens, so it
 * never sets the marker and keeps the tools usable.
 *
 * Best-effort: returns false on any read error so a metadata hiccup never blocks
 * a tool, it just falls back to the unlocked behavior.
 *
 * TODO(AIROBUILD-2696): this is the forced-install "tokens applied in code" lock
 * signal — NARROWER than 2696's "is a kit installed at all" question. They are
 * NOT the same helper: a wizard-installed kit IS installed but its tokens were
 * not applied in code, so it must stay unlocked. Keep this signal distinct when
 * 2696 introduces a kit-installed check.
 */
export function kitTokensLocked(appId: string): boolean {
  try {
    return new AppMetadataRepository().get(appId).designKitTokensLocked === true
  } catch {
    return false
  }
}
