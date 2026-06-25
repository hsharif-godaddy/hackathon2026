'use client';

import { motion, useReducedMotion } from 'framer-motion';
import { type CSSProperties, type JSX, type ReactNode, useEffect, useState } from 'react';
import Button from '@ux/button';
import SparklesIcon from '@ux/icon/sparkles';
import text from '@ux/text';

import { getSlotImageUrl } from '@/app/[market]/develop/components/media/MediaSlotDetail';
import { useServerPollingStore } from '@/stores/useServerPollingStore';
import { useBrandData } from './useBrandData';
import { useLazyFontFaces } from './useLazyFontFaces';

// The caption narrates the brand "ingredients" landing, then holds on the final
// "Building your website…" beat. The animation plays *during* the real build (the
// `website` phase); the wizard reveals the Preview tab when the build actually
// completes (`initialBuildComplete`), so this fills the wait rather than racing a
// fixed timer.

// The wizard chrome is Airo-branded; the brand's own palette/fonts/imagery live
// inside the blueprint itself.
const AIRO = 'var(--color-ai)';

// Neutral fallbacks so the blueprint always reads, even before brand data lands.
const FALLBACK = {
  primary: '#2b2722',
  primaryFg: '#ffffff',
  accent: '#8d7a5e',
  muted: '#8d8377',
} as const;

// CSS-keyframe loops for the closing "building" beat. A framer infinite loop
// would restart/flash on the frequent re-renders here (see Stepper), so the
// shimmer + indeterminate bar are pure CSS, guarded for reduced motion.
const BP_STYLE = `
@keyframes dkBpShine { 0% { transform: translateX(-130%); } 60%, 100% { transform: translateX(130%); } }
@keyframes dkBpIndet { 0% { transform: translateX(-110%); } 100% { transform: translateX(330%); } }
.dk-bp-shine { animation: dkBpShine 2.6s ease-in-out 0.3s infinite; }
.dk-bp-indet { animation: dkBpIndet 1.6s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) { .dk-bp-shine, .dk-bp-indet { animation: none; } }
`;

// Assembly beats (ms). The page builds across these — starting from the whole
// design kit, then each ingredient — and holds on the final "Building your
// website…" until the real build completes (4–8 min). Spaced ~2–2.5s apart so the
// assembly feels deliberate rather than rushed; every timed element keys off a beat
// so the caption, feeder chips and blueprint stay in lockstep.
const BEAT = {
  kit: 0,
  colours: 2000,
  logo: 4500,
  type: 7000,
  imagery: 9500,
  building: 12000,
} as const;

const PHASES: ReadonlyArray<readonly [number, string]> = [
  [BEAT.kit, 'Applying your design kit'],
  [BEAT.colours, 'Applying your colours'],
  [BEAT.logo, 'Placing your logo'],
  [BEAT.type, 'Setting your type'],
  [BEAT.imagery, 'Adding your imagery'],
  [BEAT.building, 'Building your website…'],
];

const truncate = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/**
 * "Blueprint build" website animation — plays *during* the website build.
 *
 * A website assembles itself section by section from the user's real brand kit —
 * colours pour into the regions, the logo lands in the header, the heading +
 * body fonts set the hero copy, and the inspo images slot into the hero and
 * gallery — narrated by a phase caption that then holds on "Building your
 * website…". It fills the build window; the wizard reveals the Preview tab when the
 * real build completes (`initialBuildComplete`), where PreviewPane's build overlay
 * carries the remaining loading.
 *
 * Reduced motion shows the assembled page statically on the final caption.
 *
 * data-testid: `design-kit-finalizing`.
 */
export function WebsiteHandoff({ appId }: { appId: string }): JSX.Element {
  const reduce = useReducedMotion();
  const { data } = useBrandData(appId);
  const previewBaseUrl = useServerPollingStore((s) => s.getServerState(appId))?.url ?? null;
  const requestFonts = useLazyFontFaces();

  // --- Brand-derived assets (with graceful fallbacks) ---
  const pal = data?.palette ?? {};
  const primary = pal.primary ?? FALLBACK.primary;
  const primaryFg = pal.primaryForeground ?? FALLBACK.primaryFg;
  const accent = pal.accent ?? pal.secondary ?? FALLBACK.accent;
  const muted = pal.muted ?? FALLBACK.muted;

  const headingFamily = data?.typography?.heading?.family;
  const bodyFamily = data?.typography?.body?.family;
  const headFont: CSSProperties = headingFamily ? { fontFamily: `'${headingFamily}', Georgia, serif` } : { fontFamily: 'Georgia, serif' };
  const bodyFont: CSSProperties = bodyFamily ? { fontFamily: `'${bodyFamily}', system-ui, sans-serif` } : {};

  const brandName = data?.brandName && data.brandName !== 'Your Brand' ? data.brandName : 'Your brand';
  const monogram = brandName.trim().charAt(0).toUpperCase() || 'A';
  const headline = data?.voice?.sampleCopy?.headline || data?.tagline || brandName;
  const subcopy = truncate(data?.voice?.sampleCopy?.body || data?.summary?.text || '', 72);

  const moodImages = data?.imagery?.moodImages ?? [];
  const heroImageUrl = moodImages[0] ? getSlotImageUrl(moodImages[0].slot, moodImages[0].url, previewBaseUrl) : null;
  const galleryImages = moodImages.slice(0, 3);

  // Load the brand's heading + body faces so the blueprint renders in them.
  useEffect(() => {
    requestFonts([headingFamily, bodyFamily].filter((f): f is string => !!f));
  }, [requestFonts, headingFamily, bodyFamily]);

  const [phaseLabel, setPhaseLabel] = useState<string>(reduce ? PHASES[PHASES.length - 1][1] : PHASES[0][1]);
  const building = phaseLabel === PHASES[PHASES.length - 1][1];

  // Advance the caption through the narrative beats, then hold on the final
  // "Building your website…" until the wizard reveals the Preview tab. Reduced motion
  // starts (and stays) on that final caption.
  useEffect(() => {
    if (reduce) return undefined;
    const timers = PHASES.slice(1).map(([ms, label]) => window.setTimeout(() => setPhaseLabel(label), ms));
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [reduce]);

  // Motion-prop helper: hold at `from` until `delayMs`, then settle. Reduced
  // motion renders the settled state immediately (no enter animation).
  const mp = (
    delayMs: number,
    durMs: number,
    from: Record<string, number>,
    to: Record<string, number> = { opacity: 1, y: 0, scale: 1 },
  ): Record<string, unknown> =>
    reduce
      ? { initial: false, animate: to }
      : { initial: { opacity: 0, ...from }, animate: to, transition: { delay: delayMs / 1000, duration: durMs / 1000, ease: 'easeOut' } };

  const pop = (delayMs: number, from: Record<string, number>): Record<string, unknown> =>
    reduce
      ? { initial: false, animate: { opacity: 1, scale: 1, y: 0 } }
      : { initial: { opacity: 0, ...from }, animate: { opacity: 1, scale: 1, y: 0 }, transition: { delay: delayMs / 1000, type: 'spring', stiffness: 260, damping: 18 } };

  const heroGradient = `linear-gradient(135deg, ${primary}, ${accent})`;

  return (
    <div
      data-testid="design-kit-finalizing"
      className="relative mx-auto flex min-h-[60vh] w-full max-w-3xl flex-col items-center justify-center overflow-hidden px-4 py-6"
    >
      <style>{BP_STYLE}</style>

      {/* Ambient Airo wash behind the page. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ background: 'radial-gradient(58% 50% at 50% 42%, var(--color-ai-glow), transparent 72%)' }}
      />

      {/* Feeder chips — a brand "ingredient" descends into the page each phase. */}
      {!reduce && (
        <>
          <Feeder delayMs={BEAT.kit + 200} label="Design kit">
            <span className="flex h-[18px] w-[18px] flex-col overflow-hidden rounded-[5px] ring-1 ring-black/10" style={{ background: '#fff' }}>
              <span className="h-[7px] w-full" style={{ background: primary }} />
              <span className="ms-[2px] mt-[2px] h-[2px] w-[10px] rounded-full" style={{ background: accent }} />
              <span className="ms-[2px] mt-[2px] h-[2px] w-[7px] rounded-full bg-[#d9d5cf]" />
            </span>
          </Feeder>
          <Feeder delayMs={BEAT.colours + 200} label="Colours">
            {[primary, accent, muted, pal.background ?? '#e9e4dc'].map((c, i) => (
              <span key={c + i} className="h-3 w-3 rounded-full ring-1 ring-black/5" style={{ backgroundColor: c }} />
            ))}
          </Feeder>
          <Feeder delayMs={BEAT.logo + 100} label="Logo">
            <span className="grid h-[18px] w-[18px] place-items-center rounded-md text-[11px] font-semibold" style={{ background: primary, color: primaryFg, ...headFont }}>{monogram}</span>
          </Feeder>
          <Feeder delayMs={BEAT.type + 100} label={[headingFamily, bodyFamily].filter(Boolean).join(' · ') || 'Typography'}>
            <span className="text-[15px] font-semibold leading-none" style={{ ...headFont, color: primary }}>Aa</span>
            <span className="text-[13px] font-medium leading-none" style={{ ...bodyFont, color: accent }}>Aa</span>
          </Feeder>
          <Feeder delayMs={BEAT.imagery + 100} label="Imagery">
            <span
              className="h-[15px] w-[22px] rounded-[4px] bg-cover bg-center"
              style={{ backgroundImage: heroImageUrl ? `url('${heroImageUrl}')` : heroGradient, backgroundColor: accent }}
            />
          </Feeder>
        </>
      )}

      {/* ---- the website blueprint ---- */}
      <motion.div
        className="relative w-[340px] overflow-hidden rounded-xl border border-intents-ux-box-borderColor bg-white shadow-[0_18px_44px_-18px_rgba(0,0,0,0.4)]"
        {...pop(0, { scale: 0.94 })}
      >
        {/* browser chrome */}
        <div className="flex h-[22px] items-center gap-1.5 border-b border-intents-ux-box-borderColor bg-[#f3f2f5] px-2.5">
          <span className="h-1.5 w-1.5 rounded-full bg-[#d3d1d8]" />
          <span className="h-1.5 w-1.5 rounded-full bg-[#d3d1d8]" />
          <span className="h-1.5 w-1.5 rounded-full bg-[#d3d1d8]" />
          <span className="ms-2 h-[9px] w-[130px] rounded-full bg-[#e6e4ea]" />
        </div>

        {/* header — the bar lays in with the structure; the logo + nav fill at the logo beat */}
        <motion.div className="flex h-[34px] items-center justify-between border-b border-[#efedf1] px-3" {...mp(BEAT.kit + 300, 420, { y: 6 })}>
          <motion.div className="flex items-center gap-1.5" {...pop(BEAT.logo + 200, { scale: 0.6 })}>
            <span className="grid h-[18px] w-[18px] place-items-center rounded-md text-[11px] font-semibold" style={{ background: primary, color: primaryFg, ...headFont }}>{monogram}</span>
            <span className="text-[12px] font-semibold tracking-wide" style={{ ...headFont, color: primary }}>{truncate(brandName, 16)}</span>
          </motion.div>
          <div className="flex gap-2.5">
            {[BEAT.logo + 500, BEAT.logo + 650, BEAT.logo + 800].map((d) => (
              <motion.span key={d} className="block h-1.5 w-[22px] rounded-full bg-[#e6e4ea]" {...mp(d, 240, { y: -3 })} />
            ))}
          </div>
        </motion.div>

        {/* hero — the block lays in with the structure (neutral), then colour, type and
            imagery fill it. Headline + CTA only; body copy lives under the photos. */}
        <motion.div className="relative flex h-[150px] flex-col justify-center gap-2.5 px-4" style={{ background: '#edeaf0' }} {...mp(BEAT.kit + 450, 450, { y: 8 })}>
          <motion.div aria-hidden className="absolute inset-0" style={{ background: heroGradient }} {...mp(BEAT.colours + 300, 650, {}, { opacity: 1 })} />
          {heroImageUrl && (
            <motion.div
              aria-hidden
              className="absolute inset-0 bg-cover bg-center"
              style={{ backgroundImage: `url('${heroImageUrl}')` }}
              {...mp(BEAT.imagery + 200, 800, {}, { opacity: 1 })}
            />
          )}
          {/* dark scrim so the headline reads over any palette / image */}
          <div aria-hidden className="absolute inset-0" style={{ background: 'linear-gradient(120deg, rgba(0,0,0,0.5), rgba(0,0,0,0.12) 60%, transparent)' }} />
          <div className="relative flex flex-col gap-3">
            <motion.div className="line-clamp-2 max-w-[80%] text-[21px] font-semibold leading-[1.05] text-white [text-shadow:0_1px_8px_rgba(0,0,0,0.3)]" style={headFont} {...mp(BEAT.type + 200, 600, { y: 10 })}>
              {truncate(headline, 42)}
            </motion.div>
            <motion.span
              className="self-start rounded-full px-3 py-1 text-[10.5px] font-medium"
              style={{ background: primary, color: primaryFg, ...bodyFont }}
              {...mp(BEAT.type + 800, 450, { y: 6 })}
            >
              Get started
            </motion.span>
          </div>
        </motion.div>

        {/* gallery — placeholder tiles lay in with the structure; the imagery fills them */}
        <div className="flex gap-1.5 px-3 pt-3">
          {[0, 1, 2].map((i) => {
            const img = galleryImages[i];
            const url = img ? getSlotImageUrl(img.slot, img.url, previewBaseUrl) : null;
            const rot = i === 0 ? -3 : i === 2 ? 3 : 0;
            return (
              <motion.div
                key={i}
                className="relative h-[52px] flex-1 overflow-hidden rounded-[7px] bg-[#e6e4ea] shadow-[inset_0_0_0_1px_rgba(0,0,0,0.04)]"
                {...mp(BEAT.kit + 600 + i * 120, 420, { y: 10, rotate: rot })}
              >
                <motion.div
                  aria-hidden
                  className="absolute inset-0 bg-cover bg-center"
                  style={{ backgroundImage: url ? `url('${url}')` : `linear-gradient(135deg, ${accent}, ${primary})` }}
                  {...mp(BEAT.imagery + 400 + i * 220, 520, {}, { opacity: 1 })}
                />
              </motion.div>
            );
          })}
        </div>

        {/* body — the brand voice copy sits here on the plain card, off the imagery */}
        <div className="flex flex-col gap-2 px-3 pb-7 pt-3">
          {subcopy && (
            <motion.p
              className="line-clamp-2 text-[11px] leading-[1.4]"
              style={{ color: '#413c37', ...bodyFont }}
              {...mp(BEAT.imagery + 1300, 500, { y: 6 })}
            >
              {subcopy}
            </motion.p>
          )}
          {['92%', '99%', '70%'].map((w, i) => (
            <motion.span key={w} className="h-[7px] rounded-full bg-[#e6e4ea]" style={{ width: w }} {...mp(BEAT.kit + 800 + i * 100, 360, { y: 6 })} />
          ))}
        </div>

        {/* footer — neutral bar lays in with the structure, then the brand colour washes in */}
        <motion.div className="absolute inset-x-0 bottom-0 flex h-[22px] items-center gap-1.5 overflow-hidden bg-[#e6e4ea] px-3" {...mp(BEAT.kit + 950, 420, { y: 6 })}>
          <motion.div aria-hidden className="absolute inset-0" style={{ background: primary }} {...mp(BEAT.colours + 500, 500, {}, { opacity: 1 })} />
          <span className="relative h-[5px] w-[30px] rounded-full bg-white/45" />
          <span className="relative h-[5px] w-[30px] rounded-full bg-white/45" />
        </motion.div>

        {/* closing shimmer sweep (CSS loop while we hold on the building beat) */}
        {building && !reduce && (
          <span
            aria-hidden
            className="dk-bp-shine pointer-events-none absolute inset-0"
            style={{ background: 'linear-gradient(105deg, transparent 38%, rgba(255,255,255,0.42) 50%, transparent 62%)' }}
          />
        )}
      </motion.div>

      {/* status caption + indeterminate progress */}
      <div className="mt-5 flex flex-col items-center gap-2.5">
        <div className="flex items-center gap-1.5">
          {building && <SparklesIcon className="h-3.5 w-3.5" style={{ color: AIRO }} />}
          <text.span className="font-semibold" style={{ color: AIRO }}>{phaseLabel}</text.span>
        </div>
        {building && !reduce && (
          <span className="relative block h-1 w-[220px] overflow-hidden rounded-full" style={{ background: 'color-mix(in srgb, var(--color-ai) 14%, transparent)' }}>
            <span className="dk-bp-indet absolute h-1 w-[38%] rounded-full" style={{ background: 'linear-gradient(90deg, var(--color-ai-light), var(--color-ai-muted))' }} />
          </span>
        )}
      </div>
    </div>
  );
}

/** A pill chip that drops from the top into the page, then fades — one per phase. */
function Feeder({ delayMs, label, children }: { delayMs: number; label: string; children: ReactNode }): JSX.Element {
  return (
    <motion.div
      aria-hidden
      className="absolute left-1/2 top-2 z-10 flex items-center gap-1.5 rounded-full border border-intents-ux-box-borderColor bg-white px-2.5 py-1.5 text-[11px] shadow-[0_8px_22px_-10px_rgba(0,0,0,0.35)]"
      style={{ color: '#6b6a72' }}
      initial={{ opacity: 0, x: '-50%', y: -6, scale: 0.9 }}
      animate={{ opacity: [0, 1, 1, 0], x: '-50%', y: [-6, 0, 70, 130], scale: [0.9, 1, 0.96, 0.8] }}
      transition={{ delay: delayMs / 1000, duration: 1.3, times: [0, 0.18, 0.65, 1], ease: 'easeInOut' }}
    >
      {children}
      <span className="ms-0.5">{label}</span>
    </motion.div>
  );
}

/**
 * Calm static panel shown if the user returns to the Logo & Brand tab after the
 * build hand-off has already played. We don't replay the sequence or force the
 * view switch again — we just offer a way back to watching the build.
 */
export function WebsiteHandoffDone({ onGo }: { onGo: () => void }): JSX.Element {
  return (
    <div
      data-testid="design-kit-finalizing"
      className="relative mx-auto flex min-h-[44vh] w-full max-w-3xl flex-col items-center justify-center gap-5 px-4 text-center"
    >
      <div
        className="flex h-14 w-14 items-center justify-center rounded-full text-white"
        style={{ background: 'linear-gradient(135deg, var(--color-ai-dark), var(--color-ai-light))', boxShadow: '0 0 30px 4px var(--color-ai-glow)' }}
      >
        <SparklesIcon className="h-5 w-5" />
      </div>
      <div className="flex flex-col gap-1">
        <text.span className="text-lg font-semibold text-intents-ux-box-foregroundColor">Your website is on its way</text.span>
        <text.p as="caption" emphasis="passive">We&rsquo;re building your site from this brand kit.</text.p>
      </div>
      <Button design="primary" data-testid="design-kit-watch-build" onClick={onGo} text="Watch it build" />
    </div>
  );
}

/**
 * Wrapping-up celebration shown the instant the real build completes, just before
 * the wizard reveals the finished site (chrome returns + Preview tab). A short,
 * upbeat beat — the wizard switches to Preview right after.
 *
 * data-testid: `design-kit-website-ready`.
 */
// Radial sparkle burst directions (degrees) for the celebration payoff.
const BURST_DEGREES = [0, 36, 72, 108, 144, 180, 216, 252, 288, 324];

export function WebsiteReadyCelebration(): JSX.Element {
  const reduce = useReducedMotion();
  return (
    <div
      data-testid="design-kit-website-ready"
      className="relative mx-auto flex min-h-[60vh] w-full max-w-3xl flex-col items-center justify-center gap-5 px-4 text-center"
    >
      {/* Pulsing ambient Airo burst behind the payoff. */}
      <motion.div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ background: 'radial-gradient(48% 42% at 50% 40%, var(--color-ai-glow), transparent 70%)' }}
        initial={reduce ? false : { opacity: 0.4, scale: 0.85 }}
        animate={reduce ? { opacity: 1 } : { opacity: [0.4, 1, 0.85], scale: [0.85, 1.08, 1] }}
        transition={{ duration: 1.8, ease: 'easeOut' }}
      />

      <div className="relative flex h-16 w-16 items-center justify-center">
        {/* Expanding ring ripple. */}
        {!reduce && (
          <motion.span
            aria-hidden
            className="absolute inset-0 rounded-full"
            style={{ border: '2px solid var(--color-ai-light)' }}
            initial={{ scale: 0.5, opacity: 0.9 }}
            animate={{ scale: 2.4, opacity: 0 }}
            transition={{ duration: 1.2, ease: 'easeOut' }}
          />
        )}

        {/* Radial sparkle burst — dots fly out from the badge and fade. */}
        {!reduce &&
          BURST_DEGREES.map((deg) => {
            const rad = (deg * Math.PI) / 180;
            return (
              <motion.span
                key={deg}
                aria-hidden
                data-testid="design-kit-celebration-spark"
                className="absolute left-1/2 top-1/2 h-1.5 w-1.5 rounded-full"
                style={{ background: deg % 72 === 0 ? 'var(--color-ai)' : 'var(--color-ai-light)' }}
                initial={{ x: 0, y: 0, scale: 0, opacity: 1 }}
                animate={{ x: Math.cos(rad) * 52, y: Math.sin(rad) * 52, scale: [0, 1, 0], opacity: [1, 1, 0] }}
                transition={{ duration: 0.95, delay: 0.12, ease: 'easeOut' }}
              />
            );
          })}

        {/* The badge pops with a springy, slightly over-rotated entrance. */}
        <motion.div
          initial={reduce ? false : { scale: 0.3, opacity: 0, rotate: -18 }}
          animate={{ scale: 1, opacity: 1, rotate: 0 }}
          transition={{ type: 'spring', stiffness: 280, damping: 11 }}
          className="relative flex h-16 w-16 items-center justify-center rounded-full text-white"
          style={{ background: 'linear-gradient(135deg, var(--color-ai-dark), var(--color-ai-light))', boxShadow: '0 0 52px 10px var(--color-ai-glow)' }}
        >
          <SparklesIcon className="h-7 w-7" />
        </motion.div>
      </div>

      <motion.div
        initial={reduce ? false : { opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.22, duration: 0.45, ease: 'easeOut' }}
        className="relative flex flex-col gap-1.5"
      >
        <text.span className="text-xl font-semibold text-intents-ux-box-foregroundColor">Your website is ready!</text.span>
        <text.p as="caption" emphasis="passive">You&rsquo;re going to love it — bringing it in now…</text.p>
      </motion.div>
    </div>
  );
}
