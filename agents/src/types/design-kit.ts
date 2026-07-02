/**
 * Reference to the design kit an app was built with — the shape stamped into
 * app metadata under the `designKit` key. An umbrella over both an uploaded
 * ui-kit and an installed catalog design-system, distinguished by `source`.
 *
 * Keyed on `id` (the stable per-kit UUID) — the catalog's `slug` is being
 * deprecated in favor of `id` + `displayName`, so we don't stamp slug. A catalog
 * install always has an `id`; an upload only has one when the uploaded
 * `kit-meta.json` carries it (a catalog-derived kit), so `id` is required for
 * `catalog` and optional for `upload`. `kitId` (mosaic source brand-kit UUID)
 * exists only for the named/anchored kits.
 *
 * Named `designKit` (not `brandKit`) to avoid colliding with the existing
 * `brand.*` extracted brand-data concept. Lives here (not in the generic
 * `@airo/shared` app-metadata platform) because it's a design-kit feature
 * concern, not part of the metadata plumbing.
 */
import type { BrandKitTokens } from '@airo/shared/brand-data'

/**
 * Optional design-kit shape data stamped alongside the kit identity so the
 * website-build animation can mirror the chosen kit (AIROBUILD-3232 item 7):
 * element shape tokens and the full-page preview screenshot path. All
 * optional/additive — only catalog installs that carry them stamp them.
 */
interface DesignKitShape {
  /** Element shape tokens parsed from the kit's anchor.json (radius/flatness/casing). */
  tokens?: BrandKitTokens
  /** The kit's `images.preview` path, or its thumbnail when no full preview exists
   *  (relative to the brand-kit base URL). */
  previewPath?: string
}

export type DesignKitRef =
  | ({ source: 'catalog'; id: string; displayName: string; kitId?: string } & DesignKitShape)
  | ({ source: 'upload'; id?: string; displayName: string; kitId?: string } & DesignKitShape);
