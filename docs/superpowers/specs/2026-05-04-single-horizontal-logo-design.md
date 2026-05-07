# Single Horizontal Logo Flow

**Date:** 2026-05-04
**Status:** Implemented (with deviations — see Implementation Notes below)

## Implementation Notes (2026-05-06)

The following sections describe the original design. The shipped implementation diverges in two places:

- **`LogoSingleWidget.tsx` was not created.** Instead, `LogoGridWidget` was reworked to handle both single-logo and multi-logo cases. For `logos.length === 1` it auto-selects the only logo on mount (firing the same slot-swap flow as a manual click), which removes the need for a separate widget. `LogoGeneratorToolRenderer` therefore renders `LogoGridWidget` for every logo count.
- **`LogoGridWidget` behavior changed.** The Save button, More Options control, helper text, and 2x2 grid are removed. The widget now stacks logos vertically at full chat width and auto-saves on click. The sections below saying these controls "remain unchanged" are stale.
- **Prompt schema changed.** `agents/src/prompts/initial/templates/logo-designer/core.md` now uses a `variations` array passed to `media-logo__generate_logo`, not a top-level `count`. The `count: 4 → count: 1` bullet below no longer matches the current tool contract.

## Problem

The current logo experience generates 4 logos in a 2x2 grid with "More Options", "Save", and helper text. This is less seamless than the color and font widget flows, which display a single inline result. Users must select and manually save a logo, adding friction to the brand setup flow.

## Solution

Simplify the logo flow to generate 1 horizontal logo, display it in a clean inline widget (matching color/font widget style), and rely on the backend's existing auto-save to media slots. Maintain backwards compatibility for older apps that have multi-logo data.

## Architecture

### New Files

**`app/src/app/[market]/develop/components/widgets/logo-utils.ts`**
Shared logo utilities extracted from `LogoGridWidget`:

- `LogoData` interface (the full type with all orientation URLs)
- `getLogoDisplayUrl(logo)` — URL resolution with fallback chain
- `getLogoSlotNames(logo)` / `getLogoSlotName(logo)` — slot name detection

All swap logic, placement context, and `LOGO_SLOT_PLACEMENT_INSTRUCTIONS` remain in `LogoGridWidget` (only the grid path needs them).

**`app/src/app/[market]/develop/components/widgets/LogoSingleWidget.tsx`**
Display-only widget for a single logo:

- Horizontal inline layout matching `ColorPaletteWidget` style: bordered row with rounded corners, logo image displayed prominently
- Orientation-agnostic — handles square, horizontal, and vertical logos via `getLogoDisplayUrl()` and `object-contain` (no forced aspect ratio)
- Fires `logo-select` CustomEvent on mount for brand book sync
- No save logic — the backend auto-saves during generation/editing
- No buttons, no helper text, no post-save suggestions
- Read-only (no click/hover interactions beyond the existing modal open in the renderer)

### Modified Files

**`app/src/app/[market]/develop/components/widgets/LogoGridWidget.tsx`**

- Remove `LogoData` interface, `getLogoDisplayUrl`, `getLogoSlotNames`, `getLogoSlotName` — import from `logo-utils.ts`
- All grid UI, More Options/Save buttons, helper text, swap logic, placement context remain unchanged

**`app/src/app/[market]/develop/components/tool-renderers/LogoGeneratorToolRenderer.tsx`**

- Import `LogoSingleWidget`
- Routing: `logos.length === 1` → `LogoSingleWidget`, `logos.length > 1` → `LogoGridWidget`
- Works for both `generate_logo` and `edit_logo` tool results
- Modal unchanged (already handles single logo — thumbnail strip and counter gated on `logos.length > 1`)

**`agents/src/prompts/initial/templates/logo-designer/core.md`**

- `count: 4` → `count: 1` (lines 169, 250)
- `layout: "all"` → `layout: "horizontal"` (lines 170, 250)
- Update surrounding text referencing "4 logos" or multiple orientations
- Update Step 7 `askQuestion` option "Generate more logo options" since the flow now generates 1 logo

### Backwards Compatibility

When resuming older apps that generated multiple logos:

- `LogoGeneratorToolRenderer` sees `logos.length > 1` → renders `LogoGridWidget`
- Full existing behavior preserved: 2x2 grid, More Options, Save, helper text, swap logic
- No migration needed — the routing is purely data-driven

### Logo Edit Flow

The edit tool (`media-logo__edit_logo`) typically returns 1 logo but may return any orientation. `LogoSingleWidget` is orientation-agnostic, so edit results route through the same `logos.length === 1` → single widget path.

## What This Does NOT Change

- Backend logo generation API (`LogoService.ts`, `/api/logo`)
- Media slot auto-save mechanism in `agents/src/skills/media-logo/tools/index.ts`
- Logo edit tool parameters or behavior
- Media manifest, slot structure, or iframe communication
- `LogoGridWidget` existing behavior (only import paths change)
- Modal view in `LogoGeneratorToolRenderer`
