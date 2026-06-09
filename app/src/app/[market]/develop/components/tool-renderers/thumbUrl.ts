/**
 * Returns a display-friendly, downsized URL for image thumbnails so the
 * "View source" grid doesn't pull full-resolution images into ~80px cells.
 *
 * Handles the CDNs we actually rebuild from (Squarespace, Wix) plus a safe
 * generic fallback. Every transform only ever *lowers* a size the CDN already
 * honours — we never invent a parameter an unknown host might choke on, and an
 * unrecognised URL is returned untouched.
 */

// Target longest edge for grid thumbnails (cells render at ~80px; 300 leaves
// headroom for retina without shipping full-res).
const THUMB_PX = 300

export function thumbUrl(url: string): string {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return url
  }

  // Squarespace: `?format=original` → a fixed-width variant. Images are served
  // from `*.squarespace-cdn.com` and `*.sqsp.net` (the bare `squarespace`
  // substring covers both `squarespace.com` and `squarespace-cdn.com`).
  if (u.hostname.includes('squarespace') || u.hostname.includes('sqsp.net')) {
    if (u.searchParams.get('format') === 'original') {
      u.searchParams.set('format', `${THUMB_PX}w`)
      return u.toString()
    }
  }

  // Wix: dimensions live in the `/v1/fill/w_<W>,h_<H>,...` path segment. Cap each
  // to THUMB_PX (fill crops anyway, so exact aspect doesn't matter for a thumb).
  if (u.hostname.includes('wixstatic.com') || u.hostname.includes('wix.com')) {
    const capped = u.pathname
      .replace(/w_\d+/g, `w_${THUMB_PX}`)
      .replace(/h_\d+/g, `h_${THUMB_PX}`)
    if (capped !== u.pathname) {
      u.pathname = capped
      return u.toString()
    }
  }

  // Generic: many CDNs honour a `w`/`width` query param. Only ever lower it —
  // touching a param the host already exposes is safe; raising it isn't useful.
  for (const param of ['w', 'width']) {
    const raw = u.searchParams.get(param)
    if (raw && /^\d+$/.test(raw) && Number(raw) > THUMB_PX) {
      u.searchParams.set(param, String(THUMB_PX))
      return u.toString()
    }
  }

  return url
}
