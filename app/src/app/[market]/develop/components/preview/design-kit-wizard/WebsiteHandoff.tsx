'use client';

import { motion, useReducedMotion } from 'framer-motion';
import { type CSSProperties, type JSX, type ReactNode, useEffect, useRef, useState } from 'react';
import Button from '@ux/button';
import SparklesIcon from '@ux/icon/sparkles';
import text from '@ux/text';

import { getSlotImageUrl } from '@/app/[market]/develop/components/media/MediaSlotDetail';
import { useServerPollingStore } from '@/stores/useServerPollingStore';
import { useBrandData } from './useBrandData';
import { useLazyFontFaces } from './useLazyFontFaces';

// Total run length, then we hand off to the Edit tab. The develop agent takes a
// few minutes to its first render, so this plays ONCE as an evocative "building"
// beat — the Edit tab carries its own loading state from there.
const TOTAL_MS = 11000;
const REDUCED_MS = 1500; // reduced motion: show the assembled page briefly, then hand off

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

const PHASES: ReadonlyArray<readonly [number, string]> = [
  [0, 'Applying your colours'],
  [1700, 'Placing your logo'],
  [3000, 'Setting your type'],
  [5700, 'Adding your imagery'],
  [8200, 'Building your website…'],
];

const truncate = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/**
 * Step-5 "blueprint build" send-off.
 *
 * A website assembles itself section by section from the user's real brand kit —
 * colours pour into the regions, the logo lands in the header, the heading +
 * body fonts set the hero copy, and the inspo images slot into the hero and
 * gallery — narrated by a phase caption. It runs once (~11s) and then calls
 * `onComplete`, which the wizard uses to flip to the Edit tab where the develop
 * agent's build (and its own loading state) takes over.
 *
 * Reduced motion shows the assembled page statically, then hands off.
 *
 * data-testid: `design-kit-finalizing` (step-5 content contract).
 */
export function WebsiteHandoff({
  appId,
  onComplete,
}: {
  appId: string;
  onComplete: () => void;
}): JSX.Element {
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
  const subcopy = truncate(data?.voice?.sampleCopy?.body || data?.summary?.text || '', 96);

  const moodImages = data?.imagery?.moodImages ?? [];
  const heroImageUrl = moodImages[0] ? getSlotImageUrl(moodImages[0].slot, moodImages[0].url, previewBaseUrl) : null;
  const galleryImages = moodImages.slice(0, 3);

  // Load the brand's heading + body faces so the blueprint renders in them.
  useEffect(() => {
    requestFonts([headingFamily, bodyFamily].filter((f): f is string => !!f));
  }, [requestFonts, headingFamily, bodyFamily]);

  const [phaseLabel, setPhaseLabel] = useState<string>(reduce ? PHASES[PHASES.length - 1][1] : PHASES[0][1]);
  const building = phaseLabel === PHASES[PHASES.length - 1][1];

  // Fire onComplete exactly once. Read the latest callback via a ref so a parent
  // re-render with a fresh closure doesn't tear down + reschedule the timers
  // (mirrors AssemblingKit's seal timer).
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  const firedRef = useRef(false);

  useEffect(() => {
    const fire = (): void => {
      if (firedRef.current) return;
      firedRef.current = true;
      onCompleteRef.current();
    };

    if (reduce) {
      const t = window.setTimeout(fire, REDUCED_MS);
      return () => window.clearTimeout(t);
    }

    const timers = PHASES.slice(1).map(([ms, label]) => window.setTimeout(() => setPhaseLabel(label), ms));
    timers.push(window.setTimeout(fire, TOTAL_MS));
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
          <Feeder delayMs={200} label="Colours">
            {[primary, accent, muted, pal.background ?? '#e9e4dc'].map((c, i) => (
              <span key={c + i} className="h-3 w-3 rounded-full ring-1 ring-black/5" style={{ backgroundColor: c }} />
            ))}
          </Feeder>
          <Feeder delayMs={1700} label="Logo">
            <span className="grid h-[18px] w-[18px] place-items-center rounded-md text-[11px] font-semibold" style={{ background: primary, color: primaryFg, ...headFont }}>{monogram}</span>
          </Feeder>
          <Feeder delayMs={3000} label={[headingFamily, bodyFamily].filter(Boolean).join(' · ') || 'Typography'}>
            <span className="text-[15px] font-semibold leading-none" style={{ ...headFont, color: primary }}>Aa</span>
            <span className="text-[13px] font-medium leading-none" style={{ ...bodyFont, color: accent }}>Aa</span>
          </Feeder>
          <Feeder delayMs={5700} label="Imagery">
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

        {/* header */}
        <div className="flex h-[34px] items-center justify-between border-b border-[#efedf1] px-3">
          <motion.div className="flex items-center gap-1.5" {...pop(2150, { scale: 0.6 })}>
            <span className="grid h-[18px] w-[18px] place-items-center rounded-md text-[11px] font-semibold" style={{ background: primary, color: primaryFg, ...headFont }}>{monogram}</span>
            <span className="text-[12px] font-semibold tracking-wide" style={{ ...headFont, color: primary }}>{truncate(brandName, 16)}</span>
          </motion.div>
          <div className="flex gap-2.5">
            {[2550, 2680, 2810].map((d) => (
              <motion.span key={d} className="block h-1.5 w-[22px] rounded-full bg-[#e6e4ea]" {...mp(d, 240, { y: -3 })} />
            ))}
          </div>
        </div>

        {/* hero */}
        <div className="relative flex h-[150px] flex-col justify-center gap-2 px-4" style={{ background: '#edeaf0' }}>
          <motion.div aria-hidden className="absolute inset-0" style={{ background: heroGradient }} {...mp(950, 650, {}, { opacity: 1 })} />
          {heroImageUrl && (
            <motion.div
              aria-hidden
              className="absolute inset-0 bg-cover bg-center"
              style={{ backgroundImage: `url('${heroImageUrl}')` }}
              {...mp(6000, 800, {}, { opacity: 1 })}
            />
          )}
          {/* dark scrim so the headline reads over any palette / image */}
          <div aria-hidden className="absolute inset-0" style={{ background: 'linear-gradient(120deg, rgba(0,0,0,0.5), rgba(0,0,0,0.12) 60%, transparent)' }} />
          <div className="relative flex flex-col gap-2">
            <motion.div className="max-w-[78%] text-[21px] font-semibold leading-[1.05] text-white [text-shadow:0_1px_8px_rgba(0,0,0,0.3)]" style={headFont} {...mp(3400, 600, { y: 10 })}>
              {truncate(headline, 42)}
            </motion.div>
            {subcopy && (
              <motion.div className="max-w-[76%] text-[11px] leading-[1.35] text-white/90 [text-shadow:0_1px_6px_rgba(0,0,0,0.3)]" style={bodyFont} {...mp(4500, 600, { y: 8 })}>
                {subcopy}
              </motion.div>
            )}
            <motion.span
              className="self-start rounded-full px-3 py-1 text-[10.5px] font-medium"
              style={{ background: primary, color: primaryFg, ...bodyFont }}
              {...mp(5000, 450, { y: 6 })}
            >
              Get started
            </motion.span>
          </div>
        </div>

        {/* gallery */}
        <div className="flex gap-1.5 px-3 pt-3">
          {[0, 1, 2].map((i) => {
            const img = galleryImages[i];
            const url = img ? getSlotImageUrl(img.slot, img.url, previewBaseUrl) : null;
            const rot = i === 0 ? -3 : i === 2 ? 3 : 0;
            return (
              <motion.div
                key={i}
                className="h-[52px] flex-1 rounded-[7px] bg-cover bg-center shadow-[inset_0_0_0_1px_rgba(0,0,0,0.04)]"
                style={{ backgroundImage: url ? `url('${url}')` : `linear-gradient(135deg, ${accent}, ${primary})`, backgroundColor: '#e6e4ea' }}
                {...mp(6400 + i * 220, 520, { y: 12, rotate: rot })}
              />
            );
          })}
        </div>

        {/* body text */}
        <div className="flex flex-col gap-1.5 px-3 pb-7 pt-3">
          {['92%', '99%', '70%'].map((w, i) => (
            <motion.span key={w} className="h-[7px] rounded-full bg-[#e6e4ea]" style={{ width: w }} {...mp(7100 + i * 150, 360, { y: 6 })} />
          ))}
        </div>

        {/* footer */}
        <motion.div className="absolute inset-x-0 bottom-0 flex h-[22px] items-center gap-1.5 px-3" style={{ background: primary }} {...mp(1250, 500, {}, { opacity: 1 })}>
          <span className="h-[5px] w-[30px] rounded-full bg-white/45" />
          <span className="h-[5px] w-[30px] rounded-full bg-white/45" />
        </motion.div>

        {/* closing shimmer sweep (CSS loop; brief — we hand off shortly after) */}
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
