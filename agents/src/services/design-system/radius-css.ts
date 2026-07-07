import type { WorkspaceFiles } from '../../workspace/files.js'
import { Logger } from '../../logging/index.js'

const logger: Logger = Logger.create({ component: 'design-system-radius' })

const GLOBALS_CSS_PATH: string = 'src/styles/globals.css'
// Matches the single `--radius:` custom-property declaration at the start of its
// line (capturing the indentation in group 1, which the replacement re-emits).
// The colon immediately after `radius` excludes the `--radius-sm`/`--radius-lg`
// longhands. The line-start anchor (`m` flag) skips a same-line `/* --radius: */`
// comment; this is safe against an own-line `--radius:` inside a multi-line block
// comment only because the v8 template ships exactly one live declaration.
const RADIUS_VAR_REGEX: RegExp = /^(\s*)--radius:\s*[^;]+;/m

/**
 * Deterministically write a design kit's base radius into the app's `--radius`
 * CSS variable in `src/styles/globals.css`. The v8 template derives every shadcn
 * `lg`/`md`/`sm` border-radius from `--radius`, so this single write propagates
 * to all components — closing the gap where a kit's radius (e.g. anchor.json
 * `radius.base`) never reached the generated app (AIROBUILD-2976).
 *
 * Best-effort: never throws. Returns `false` when the radius is invalid (non-finite
 * or negative), there is no `--radius` declaration to replace, or the file cannot
 * be read, so the caller (the kit install path) can ignore the outcome.
 */
export async function updateCssRadius(files: WorkspaceFiles, radiusBasePx: number): Promise<boolean> {
  if (!Number.isFinite(radiusBasePx) || radiusBasePx < 0) {
    logger.warn('design_system.radius.skipped', { reason: 'invalid_radius', radiusBasePx })
    return false
  }
  try {
    const content: string = await files.readText({ path: GLOBALS_CSS_PATH })
    const updated: string = content.replace(RADIUS_VAR_REGEX, `$1--radius: ${radiusBasePx}px;`)
    if (updated === content) {
      logger.warn('design_system.radius.skipped', { reason: 'no_radius_declaration' })
      return false
    }
    await files.write({ path: GLOBALS_CSS_PATH, content: updated })
    logger.info('design_system.radius.applied', { radiusBasePx })
    return true
  } catch (err) {
    logger.warn('design_system.radius.failed', { error: err instanceof Error ? err.message : String(err) })
    return false
  }
}

// Mirrors RADIUS_VAR_REGEX for the button-radius longhand. `--radius-button:`
// cannot collide with `--radius:` (the base regex requires a colon immediately
// after `radius`), so the two writers stay isolated.
const RADIUS_BUTTON_VAR_REGEX: RegExp = /^(\s*)--radius-button:\s*[^;]+;/m

/**
 * Deterministically write a design kit's button radius into the app's
 * `--radius-button` CSS variable in `src/styles/globals.css`. The v8 template's
 * Button `cva` consumes `rounded-[var(--radius-button)]`, so this single write
 * makes every `<Button>` match the kit's button shape (pill / sharp / subtle) —
 * correct-by-construction, covering the shadcn Button `cva` case that a
 * className codemod cannot reach (AIROBUILD-3249).
 *
 * Best-effort: never throws. Returns `false` when the radius is invalid, there is
 * no `--radius-button` declaration to replace, or the file cannot be read.
 */
export async function updateCssButtonRadius(files: WorkspaceFiles, radiusButtonPx: number): Promise<boolean> {
  if (!Number.isFinite(radiusButtonPx) || radiusButtonPx < 0) {
    logger.warn('design_system.radius_button.skipped', { reason: 'invalid_radius', radiusButtonPx })
    return false
  }
  try {
    const content: string = await files.readText({ path: GLOBALS_CSS_PATH })
    const updated: string = content.replace(RADIUS_BUTTON_VAR_REGEX, `$1--radius-button: ${radiusButtonPx}px;`)
    if (updated === content) {
      logger.warn('design_system.radius_button.skipped', { reason: 'no_radius_button_declaration' })
      return false
    }
    await files.write({ path: GLOBALS_CSS_PATH, content: updated })
    logger.info('design_system.radius_button.applied', { radiusButtonPx })
    return true
  } catch (err) {
    logger.warn('design_system.radius_button.failed', { error: err instanceof Error ? err.message : String(err) })
    return false
  }
}
