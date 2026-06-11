/**
 * Animated "logo being generated" placeholder, emitted as a self-contained SVG
 * string. Used in two places that must stay visually identical:
 *
 *  - agents writes it to the customer app workspace and serves it as an <img>
 *    src while an async logo job is in flight (see agents `logo-shimmer.ts`).
 *  - the builder UI renders it inline in `LogoShimmer.tsx`.
 *
 * Design: a deep "liquid ink" gradient with drifting colour blobs, over which an
 * abstract four-petal bloom mark draws itself in (stroke-dashoffset), fills with
 * colour, and — for the horizontal/vertical lockups — a faux wordmark types in
 * beside/below it. The whole foreground then fades out and the loop restarts.
 *
 * Animation is pure CSS embedded in a <style> block (NOT SMIL) for two reasons:
 *   1. it runs both as an <img> document and inline in the DOM, and
 *   2. it can honour `prefers-reduced-motion` (SMIL cannot) — under reduced
 *      motion every element snaps to its finished state with no motion.
 *
 * All ids/classes/keyframes are namespaced by `idPrefix` so multiple instances
 * can be inlined on the same page without colliding. When inlining in React,
 * pass a DOM-safe unique prefix (e.g. a sanitised `useId()`).
 */

export type ShimmerOrientation = 'square' | 'horizontal' | 'vertical'

export interface BuildShimmerOptions {
  /** Accessible label when the SVG stands alone (an <img>). Default 'Generating logo'. */
  ariaLabel?: string
  /**
   * When true the SVG is marked `aria-hidden` (no role/label) — use when an
   * ancestor element already provides the accessible status text, as the
   * builder-UI wrapper does. Default false.
   */
  decorative?: boolean
  /**
   * Milliseconds elapsed since a shared session epoch, applied as a negative
   * `animation-delay` so the loop resumes at the correct phase instead of
   * restarting from 0. Pass this when the SVG may be re-mounted by the host
   * (e.g. React reconciliation) so the animation appears continuous across
   * mounts. Default 0 (start from the beginning) — correct for a standalone
   * <img> that mounts once.
   */
  elapsedMs?: number
}

interface BarSpec {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
  /** % of the cycle where the ghost bar starts/finishes scaling in. */
  readonly typeStart: number
  readonly typeEnd: number
  /** % of the cycle where the coloured fill begins (finishes 10% later). */
  readonly colourStart: number
}

interface OrientationSpec {
  readonly w: number
  readonly h: number
  readonly rx: number
  /** Loop duration (seconds). */
  readonly cyc: number
  /** Bloom centre + scale within the canvas. */
  readonly cx: number
  readonly cy: number
  readonly scale: number
  /** Per-petal draw window as [start%, end%] of the cycle. */
  readonly draw: ReadonlyArray<readonly [number, number]>
  /** Petal/glow fill ramp window [start%, end%]. */
  readonly fillA: number
  readonly fillB: number
  /** Faux wordmark bars (empty for square). */
  readonly bars: ReadonlyArray<BarSpec>
}

const PETAL_PATH = 'M0 0 C 19 -24 19 -55 0 -72 C -19 -55 -19 -24 0 0 Z'

/** Escape a string for safe interpolation into an XML/SVG attribute value.
 *  The SVG is consumed via innerHTML / an <img> src, so an unescaped label could
 *  break out of the attribute. Callers are static today; this keeps it safe if a
 *  dynamic label is ever passed. */
function escapeXmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const SPECS: Record<ShimmerOrientation, OrientationSpec> = {
  square: {
    w: 240, h: 240, rx: 28, cyc: 5.0,
    cx: 120, cy: 120, scale: 1,
    draw: [[10, 18], [16, 24], [22, 30], [28, 36]],
    fillA: 52, fillB: 64,
    bars: [],
  },
  horizontal: {
    w: 360, h: 150, rx: 24, cyc: 5.4,
    cx: 82, cy: 75, scale: 0.62,
    draw: [[8, 16], [14, 22], [20, 28], [26, 34]],
    fillA: 60, fillB: 72,
    bars: [
      { x: 150, y: 60, w: 168, h: 18, typeStart: 42, typeEnd: 56, colourStart: 62 },
      { x: 150, y: 90, w: 84, h: 13, typeStart: 50, typeEnd: 60, colourStart: 66 },
      { x: 244, y: 90, w: 60, h: 13, typeStart: 54, typeEnd: 64, colourStart: 68 },
    ],
  },
  vertical: {
    w: 200, h: 280, rx: 26, cyc: 5.4,
    cx: 100, cy: 96, scale: 0.74,
    draw: [[8, 16], [14, 22], [20, 28], [26, 34]],
    fillA: 60, fillB: 72,
    bars: [
      { x: 46, y: 182, w: 108, h: 18, typeStart: 42, typeEnd: 56, colourStart: 62 },
      { x: 60, y: 212, w: 52, h: 13, typeStart: 50, typeEnd: 60, colourStart: 66 },
      { x: 120, y: 212, w: 40, h: 13, typeStart: 54, typeEnd: 64, colourStart: 68 },
    ],
  },
}

/** Build the animated shimmer SVG markup for one orientation. */
export function buildLogoShimmerSvg(
  orientation: ShimmerOrientation,
  idPrefix: string,
  options: BuildShimmerOptions = {},
): string {
  const s = SPECS[orientation]
  const p = idPrefix
  const ariaLabel = options.ariaLabel ?? 'Generating logo'

  // ---- keyframes -----------------------------------------------------------
  const drawKf = s.draw
    .map((win, i) => `@keyframes ${p}draw${i}{0%,${win[0]}%{stroke-dashoffset:100}${win[1]}%,100%{stroke-dashoffset:0}}`)
    .join('')
  const typeKf = s.bars
    .map((b, i) => `@keyframes ${p}type${i}{0%,${b.typeStart}%{transform:scaleX(0)}${b.typeEnd}%,100%{transform:scaleX(1)}}`)
    .join('')
  const colKf = s.bars
    .map((b, i) => `@keyframes ${p}col${i}{0%,${b.colourStart}%{fill-opacity:0}${b.colourStart + 10}%,100%{fill-opacity:.92}}`)
    .join('')

  const dx1 = Math.round(s.w * 0.16), dy1 = Math.round(s.h * 0.18)
  const dx2 = -Math.round(s.w * 0.16), dy2 = -Math.round(s.h * 0.16)
  const dx3 = -Math.round(s.w * 0.12), dy3 = Math.round(s.h * 0.18)

  const animClasses: string[] = [
    `${p}fg`, `${p}rot`, `${p}glow`, `${p}fl`, `${p}b1`, `${p}b2`, `${p}b3`,
    ...s.draw.map((_, i) => `${p}d${i}`),
    ...s.bars.flatMap((_, i) => [`${p}t${i}`, `${p}c${i}`]),
  ]

  const assigns =
    `.${p}fg{animation:${p}fg ${s.cyc}s linear infinite}` +
    `.${p}rot{animation:${p}rot ${s.cyc}s cubic-bezier(.4,0,.2,1) infinite;transform-origin:${s.cx}px ${s.cy}px}` +
    `.${p}glow{animation:${p}glow ${s.cyc}s linear infinite}` +
    `.${p}fl{animation:${p}fill ${s.cyc}s linear infinite}` +
    `.${p}b1{animation:${p}b1 6.8s ease-in-out infinite}` +
    `.${p}b2{animation:${p}b2 7.8s ease-in-out infinite}` +
    `.${p}b3{animation:${p}b3 9s ease-in-out infinite}` +
    s.draw.map((_, i) => `.${p}d${i}{animation:${p}draw${i} ${s.cyc}s linear infinite}`).join('') +
    s.bars
      .map((b, i) =>
        `.${p}t${i}{animation:${p}type${i} ${s.cyc}s cubic-bezier(.4,0,.2,1) infinite;transform-origin:${b.x}px ${b.y + b.h / 2}px}` +
        `.${p}c${i}{animation:${p}col${i} ${s.cyc}s linear infinite}`,
      )
      .join('')

  // Reduced motion: snap to the finished logo, scoped to THIS instance only.
  const staticState =
    `.${p}fg{opacity:1}.${p}rot{transform:none}.${p}glow{opacity:.9}.${p}fl{fill-opacity:.85}` +
    s.draw.map((_, i) => `.${p}d${i}{stroke-dashoffset:0}`).join('') +
    s.bars.map((_, i) => `.${p}t${i}{transform:scaleX(1)}.${p}c${i}{fill-opacity:.92}`).join('')
  const reducedMotion =
    `@media(prefers-reduced-motion:reduce){` +
    animClasses.map((c) => `.${c}`).join(',') + `{animation:none!important}` +
    staticState +
    `}`

  // Resume the loop at its wall-clock phase (negative animation-delay) so a host
  // re-mount continues the animation instead of restarting it. Must come AFTER the
  // shorthand `animation:` assignments (which reset delay to 0) and before the
  // reduced-motion block (whose `animation:none!important` wins regardless).
  const elapsedMs = options.elapsedMs ?? 0
  const delayRule =
    elapsedMs > 0
      ? `${animClasses.map((c) => `.${c}`).join(',')}{animation-delay:-${(elapsedMs / 1000).toFixed(3)}s}`
      : ''

  const css =
    `@keyframes ${p}fg{0%{opacity:0}8%{opacity:1}85%{opacity:1}95%,100%{opacity:0}}` +
    `@keyframes ${p}rot{from{transform:rotate(0)}to{transform:rotate(16deg)}}` +
    `@keyframes ${p}fill{0%,${s.fillA}%{fill-opacity:0}${s.fillB}%,100%{fill-opacity:.85}}` +
    `@keyframes ${p}glow{0%,${s.fillA}%{opacity:0}${s.fillB}%,100%{opacity:.9}}` +
    `@keyframes ${p}b1{0%,100%{transform:translate(0,0)}50%{transform:translate(${dx1}px,${dy1}px)}}` +
    `@keyframes ${p}b2{0%,100%{transform:translate(0,0)}50%{transform:translate(${dx2}px,${dy2}px)}}` +
    `@keyframes ${p}b3{0%,100%{transform:translate(0,0)}50%{transform:translate(${dx3}px,${dy3}px)}}` +
    drawKf + typeKf + colKf + assigns + delayRule + reducedMotion

  // ---- markup --------------------------------------------------------------
  const defs =
    `<clipPath id="${p}cp"><rect width="${s.w}" height="${s.h}" rx="${s.rx}"/></clipPath>` +
    `<radialGradient id="${p}base" cx="50%" cy="40%" r="80%"><stop offset="0%" stop-color="#161a30"/><stop offset="100%" stop-color="#0a0c16"/></radialGradient>` +
    `<radialGradient id="${p}q1"><stop offset="0%" stop-color="#8b5cf6" stop-opacity="0.9"/><stop offset="100%" stop-color="#8b5cf6" stop-opacity="0"/></radialGradient>` +
    `<radialGradient id="${p}q2"><stop offset="0%" stop-color="#2563eb" stop-opacity="0.8"/><stop offset="100%" stop-color="#2563eb" stop-opacity="0"/></radialGradient>` +
    `<radialGradient id="${p}q3"><stop offset="0%" stop-color="#22d3ee" stop-opacity="0.6"/><stop offset="100%" stop-color="#22d3ee" stop-opacity="0"/></radialGradient>` +
    `<linearGradient id="${p}petal" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#a78bfa"/><stop offset="100%" stop-color="#7c8cff"/></linearGradient>` +
    `<linearGradient id="${p}txt" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="#67e8f9"/><stop offset="100%" stop-color="#c4b5fd"/></linearGradient>` +
    `<radialGradient id="${p}glowGrad" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="#c4b5fd" stop-opacity="0.55"/><stop offset="70%" stop-color="#8b5cf6" stop-opacity="0.12"/><stop offset="100%" stop-color="#8b5cf6" stop-opacity="0"/></radialGradient>` +
    `<filter id="${p}bl"><feGaussianBlur stdDeviation="22"/></filter>` +
    `<filter id="${p}gr"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/></filter>`

  let petals = ''
  for (let i = 0; i < 4; i++) {
    petals +=
      `<g transform="rotate(${i * 90})">` +
      `<path d="${PETAL_PATH}" fill="url(#${p}petal)" fill-opacity="0" stroke="none" class="${p}fl"/>` +
      `<path d="${PETAL_PATH}" pathLength="100" stroke-dasharray="100" stroke-dashoffset="100" fill="none" class="${p}d${i}"/>` +
      `</g>`
  }
  const bloom =
    `<g class="${p}rot"><g transform="translate(${s.cx} ${s.cy}) scale(${s.scale})" stroke="#eef0ff" stroke-opacity="0.92" stroke-width="${(2.4 / s.scale).toFixed(2)}" stroke-linejoin="round" stroke-linecap="round">` +
    `<circle r="60" fill="url(#${p}glowGrad)" stroke="none" opacity="0" class="${p}glow"/>${petals}</g></g>`

  const bars = s.bars
    .map((b, i) => {
      const r = (b.h / 2).toFixed(1)
      return (
        `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="${r}" fill="#ffffff" fill-opacity="0.16" class="${p}t${i}"/>` +
        `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="${r}" fill="url(#${p}txt)" fill-opacity="0" class="${p}c${i}"/>`
      )
    })
    .join('')

  const blobs =
    `<g filter="url(#${p}bl)">` +
    `<g class="${p}b1"><circle cx="${Math.round(s.w * 0.3)}" cy="${Math.round(s.h * 0.4)}" r="${Math.round(s.w * 0.42)}" fill="url(#${p}q1)"/></g>` +
    `<g class="${p}b2"><circle cx="${Math.round(s.w * 0.72)}" cy="${Math.round(s.h * 0.6)}" r="${Math.round(s.w * 0.36)}" fill="url(#${p}q2)"/></g>` +
    `<g class="${p}b3"><circle cx="${Math.round(s.w * 0.55)}" cy="${Math.round(s.h * 0.32)}" r="${Math.round(s.w * 0.26)}" fill="url(#${p}q3)"/></g></g>`

  const overlay =
    `<rect width="${s.w}" height="${s.h}" filter="url(#${p}gr)" opacity="0.08" style="mix-blend-mode:overlay"/>` +
    `<rect x="0.75" y="0.75" width="${s.w - 1.5}" height="${s.h - 1.5}" rx="${s.rx - 0.75}" fill="none" stroke="#fff" stroke-opacity="0.08"/>`

  const a11y = options.decorative ? 'aria-hidden="true"' : `role="img" aria-label="${escapeXmlAttr(ariaLabel)}"`

  return (
    `<svg viewBox="0 0 ${s.w} ${s.h}" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg" ${a11y}>` +
    `<style>${css}</style>` +
    `<defs>${defs}</defs>` +
    `<g clip-path="url(#${p}cp)">` +
    `<rect width="${s.w}" height="${s.h}" fill="url(#${p}base)"/>` +
    blobs +
    `<g class="${p}fg">${bloom}${bars}</g>` +
    overlay +
    `</g></svg>`
  )
}

/**
 * The shimmer's drifting-colour-blob backdrop ONLY — no ink base, no bloom mark,
 * no wordmark, no border. Transparent, so it can be layered over an existing
 * (dimmed) logo during a regeneration as a soft moving aurora, consistent with
 * the skeleton's atmosphere but without hard edges. The host controls opacity /
 * blend; this just paints soft blobs that drift and (via `elapsedMs`) resume
 * their phase across re-mounts. `preserveAspectRatio="none"` so it always fills
 * whatever box it is stretched into. Marked decorative (aria-hidden) — the host
 * wrapper provides the status text.
 */
export function buildLogoShimmerBackdropSvg(
  idPrefix: string,
  options: { elapsedMs?: number } = {},
): string {
  const p = idPrefix
  const W = 240
  const H = 240
  const dx1 = Math.round(W * 0.16), dy1 = Math.round(H * 0.18)
  const dx2 = -Math.round(W * 0.16), dy2 = -Math.round(H * 0.16)
  const dx3 = -Math.round(W * 0.12), dy3 = Math.round(H * 0.18)
  const animClasses = [`${p}b1`, `${p}b2`, `${p}b3`]
  const selectors = animClasses.map((c) => `.${c}`).join(',')

  const elapsedMs = options.elapsedMs ?? 0
  const delayRule = elapsedMs > 0 ? `${selectors}{animation-delay:-${(elapsedMs / 1000).toFixed(3)}s}` : ''

  const css =
    `@keyframes ${p}b1{0%,100%{transform:translate(0,0)}50%{transform:translate(${dx1}px,${dy1}px)}}` +
    `@keyframes ${p}b2{0%,100%{transform:translate(0,0)}50%{transform:translate(${dx2}px,${dy2}px)}}` +
    `@keyframes ${p}b3{0%,100%{transform:translate(0,0)}50%{transform:translate(${dx3}px,${dy3}px)}}` +
    `.${p}b1{animation:${p}b1 6.8s ease-in-out infinite}` +
    `.${p}b2{animation:${p}b2 7.8s ease-in-out infinite}` +
    `.${p}b3{animation:${p}b3 9s ease-in-out infinite}` +
    delayRule +
    `@media(prefers-reduced-motion:reduce){${selectors}{animation:none!important}}`

  const defs =
    `<radialGradient id="${p}q1"><stop offset="0%" stop-color="#8b5cf6" stop-opacity="0.9"/><stop offset="100%" stop-color="#8b5cf6" stop-opacity="0"/></radialGradient>` +
    `<radialGradient id="${p}q2"><stop offset="0%" stop-color="#2563eb" stop-opacity="0.8"/><stop offset="100%" stop-color="#2563eb" stop-opacity="0"/></radialGradient>` +
    `<radialGradient id="${p}q3"><stop offset="0%" stop-color="#22d3ee" stop-opacity="0.6"/><stop offset="100%" stop-color="#22d3ee" stop-opacity="0"/></radialGradient>` +
    `<filter id="${p}bl"><feGaussianBlur stdDeviation="22"/></filter>`

  const blobs =
    `<g filter="url(#${p}bl)">` +
    `<g class="${p}b1"><circle cx="${Math.round(W * 0.3)}" cy="${Math.round(H * 0.4)}" r="${Math.round(W * 0.42)}" fill="url(#${p}q1)"/></g>` +
    `<g class="${p}b2"><circle cx="${Math.round(W * 0.72)}" cy="${Math.round(H * 0.6)}" r="${Math.round(W * 0.36)}" fill="url(#${p}q2)"/></g>` +
    `<g class="${p}b3"><circle cx="${Math.round(W * 0.55)}" cy="${Math.round(H * 0.32)}" r="${Math.round(W * 0.26)}" fill="url(#${p}q3)"/></g></g>`

  return (
    `<svg viewBox="0 0 ${W} ${H}" width="100%" height="100%" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">` +
    `<style>${css}</style>` +
    `<defs>${defs}</defs>` +
    blobs +
    `</svg>`
  )
}
