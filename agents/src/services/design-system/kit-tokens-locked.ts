import { AppMetadataRepository } from '../../database/index.js'
import { logger } from '../../logging/index.js'
import type { KnownAppMetadata } from '@airo/shared'

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
 * NOTE: this is the forced-install "tokens applied in code" lock signal —
 * NARROWER than the "is a kit installed at all" question. They are NOT the same
 * helper: a wizard-installed kit IS installed but its tokens were not applied in
 * code, so it must stay unlocked. The broader "is a kit installed" check landed
 * with AIROBUILD-2696 as `docs/ui-kit/kit-meta.json` presence (workspace stat in
 * MessageExecutionService, which stats once and stashes `metadata.kitMetaExists`);
 * reuse that signal — not this lock marker — when you need "any kit installed".
 */
export function kitTokensLocked(appId: string): boolean {
  try {
    return new AppMetadataRepository().get(appId).designKitTokensLocked === true
  } catch {
    return false
  }
}

/**
 * Record the `designKitTokensLocked` marker — the kit's tokens were applied
 * DETERMINISTICALLY IN CODE (forced-install or the auto-select install tool), so
 * the agent's colorScheme/fontTheme tools must not override them. Best-effort: a
 * metadata hiccup must never block the install, so it just falls back to unlocked.
 */
export function lockKitTokens(appId: string): void {
  try {
    new AppMetadataRepository().merge(appId, { designKitTokensLocked: true } satisfies Partial<KnownAppMetadata>)
  } catch (err) {
    // best-effort — leave unlocked on any write error, but surface a diagnostic
    // trail (mirrors forced-install.ts's lock_marker_failed): a silently dropped
    // lock leaves colorScheme/fontTheme unlocked and re-opens the low-contrast
    // regression this marker exists to prevent, so the miss must not be invisible.
    logger.warn('design_kit.lock_tokens.failed', { appId, err: String(err) })
  }
}
