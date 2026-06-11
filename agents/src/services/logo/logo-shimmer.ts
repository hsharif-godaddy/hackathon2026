import { buildLogoShimmerSvg, type ShimmerOrientation } from '@airo/shared/logo-shimmer'
import { logger } from '../../logging/index.js'
import type { LogoLayout } from '../LogoService.js'
import type { WorkspaceFiles } from '../../workspace/files.js'

/** LogoLayout and the shared ShimmerOrientation are the same three values. */
const ORIENTATIONS: readonly ShimmerOrientation[] = ['square', 'horizontal', 'vertical']

/** Basename per orientation. Served from the dev-supervisor
 *  /airo-assets/uploads/* served-from-disk path (the only non-allowlisted
 *  form the resolver serves; empty/inline/data: URLs return HTTP 500). */
const BASENAME: Record<ShimmerOrientation, string> = {
  square: 'airo-logo-shimmer-square.svg',
  horizontal: 'airo-logo-shimmer-horizontal.svg',
  vertical: 'airo-logo-shimmer-vertical.svg',
}

const slotUrlFor = (o: ShimmerOrientation): string => `/airo-assets/uploads/${BASENAME[o]}`
const writePathFor = (o: ShimmerOrientation): string => `public/assets/uploads/${BASENAME[o]}`

/** Slot currentUrl for each orientation's shimmer placeholder. */
export const LOGO_SHIMMER_SLOT_URLS: Record<ShimmerOrientation, string> = {
  square: slotUrlFor('square'),
  horizontal: slotUrlFor('horizontal'),
  vertical: slotUrlFor('vertical'),
}

/** Pre-variant single-file URL; kept so slots written before the orientation
 *  split are still recognised as shimmer placeholders (snapshot/revert logic). */
const LEGACY_SHIMMER_SLOT_URL = '/airo-assets/uploads/airo-logo-shimmer.svg'

const ALL_SHIMMER_URLS: ReadonlySet<string> = new Set<string>([
  ...Object.values(LOGO_SHIMMER_SLOT_URLS),
  LEGACY_SHIMMER_SLOT_URL,
])

/** True when a slot's currentUrl points at any shimmer placeholder (any orientation). */
export function isShimmerUrl(url: string | undefined | null): boolean {
  return typeof url === 'string' && ALL_SHIMMER_URLS.has(url)
}

/** Idempotently ensure the shimmer SVG for one orientation exists on disk;
 *  returns its slot URL. */
export async function ensureShimmerAsset(
  workspace: WorkspaceFiles,
  appId: string,
  orientation: ShimmerOrientation,
): Promise<string> {
  const path = writePathFor(orientation)
  try {
    const stat = await workspace.stat({ paths: [path] })
    const entry = stat.entries[0]
    if (entry && entry.error === undefined && entry.kind === 'file') {
      logger.debug('logo.shimmer.asset_exists', { appId, path, orientation })
      return slotUrlFor(orientation)
    }
  } catch (err) {
    logger.warn('logo.shimmer.stat_error', {
      appId, orientation, error: err instanceof Error ? err.message : String(err),
    })
  }

  const svg = buildLogoShimmerSvg(orientation, `s${orientation[0]}`)
  await workspace.write({ path, content: svg })
  logger.info('logo.shimmer.asset_written', { appId, path, orientation })
  return slotUrlFor(orientation)
}

/** Ensure the shimmer assets for the given layouts and return a slotPath-agnostic
 *  map of layout → slot URL. */
export async function ensureShimmerAssets(
  workspace: WorkspaceFiles,
  appId: string,
  layouts: readonly LogoLayout[],
): Promise<Record<LogoLayout, string>> {
  const out = {} as Record<LogoLayout, string>
  const wanted = layouts.length > 0 ? layouts : ORIENTATIONS
  for (const layout of wanted) {
    out[layout] = await ensureShimmerAsset(workspace, appId, layout)
  }
  return out
}
