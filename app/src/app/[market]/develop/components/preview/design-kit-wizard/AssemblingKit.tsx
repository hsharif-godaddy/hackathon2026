'use client';

import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import type { JSX, ReactNode } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import CheckmarkIcon from '@ux/icon/checkmark';
import SparklesIcon from '@ux/icon/sparkles';
import text from '@ux/text';

import { getSlotImageUrl } from '@/app/[market]/develop/components/media/MediaSlotDetail';
import { getLogoDisplayUrl, type LogoData } from '@/app/[market]/develop/components/widgets/logo-utils';
import { BRAND_DATA_UPDATED_EVENT } from '@/hooks/useBrandData';
import { useMediaManifest } from '@/hooks/useMediaManifest';
import { useServerPollingStore } from '@/stores/useServerPollingStore';
import { DESIGN_KIT_EID, fireDesignKitImpression } from './designKitEvents';
import { useBrandData } from './useBrandData';
import { useLazyFontFaces } from './useLazyFontFaces';

// The design-kit wizard generates a single horizontal logo (slot `logo/horizontal`);
// the other slots are the fallback order the brand book / LogoPanel also use.
const LOGO_SLOT_NAMES = ['logo/primary', 'logo/horizontal', 'logo/vertical'] as const;

/**
 * Step-2 "assembling the kit" — the juicy moment.
 *
 * A slim Airo-purple progress bar runs along the top; each brand element is a
 * full-width row that drops into place, fades in its values and lands with a
 * glow + check. When every piece is in, the kit is "packaged": a "Your brand
 * kit is ready" box rises to the front while the progress bar and rows recede
 * behind it (sealed up, ready for the next screen). Only once that sequence
 * finishes do we fire `onAssembled` — the signal `DesignKitWizard` waits for
 * before crossfading to step 3, so the transition never cuts the payoff short.
 *
 * Driven by the `brand-data-updated` (BRAND_DATA_UPDATED_EVENT) / `logo-generated`
 * events (immediate refetch so the last rows land in time) plus brand-data.
 *
 * Chrome is Airo-branded (`--color-ai`), NOT the user's generated brand colour;
 * those appear only in the step-4 showcase.
 *
 * data-testid contract (kept for unit + E2E tests): `design-kit-assembling`
 * root, and `assemble-tile-${key}` with `data-filled` on each row.
 */

const AIRO = 'var(--color-ai)';
// Total time the "packaging" payoff plays before we let the wizard advance.
const SEAL_MS = 2200;
const SEAL_MS_REDUCED = 400;

// Order mirrors the agent's assembly sequence (wizard-flow.md) so the rows check
// off top-to-bottom: kit → colors → fonts → imagery → voice → summary → logo.
type AssetKey = 'kit' | 'colors' | 'fonts' | 'imagery' | 'voice' | 'summary' | 'logo';

interface Asset {
  key: AssetKey;
  label: string;
  filled: boolean;
  icon: ReactNode;
  content: ReactNode;
}

export function AssemblingKit({
  appId,
  step,
  onAssembled,
  mode = 'payoff',
}: {
  appId: string;
  step: number;
  /** Fires once the kit is fully assembled AND the packaging animation has
   *  finished (or immediately if the wizard advanced with nothing to package).
   *  DesignKitWizard waits for this before transitioning to step 3.
   *  Never fires in `progress` mode. */
  onAssembled?: () => void;
  /**
   * `payoff` (default): once the kit is complete and the agent has advanced, play
   * the seal/packaging payoff (rows collapse into the "kit ready" box) then fire
   * `onAssembled`. `progress` (AIROBUILD-2855 "Building Your Brand" panel): a steady
   * progress panel — the bar + 7 rows fill as data lands, but the seal never plays
   * and `onAssembled` never fires.
   */
  mode?: 'progress' | 'payoff';
}): JSX.Element {
  const { data, refetch } = useBrandData(appId);
  const { manifest } = useMediaManifest({ appId });
  const previewBaseUrl = useServerPollingStore((state) => state.getServerState(appId))?.url ?? null;
  const reduce = useReducedMotion();
  const [logoReady, setLogoReady] = useState(false);
  // The `logo-generated` event carries an absolute logo URL; capture it so the
  // thumbnail shows the instant the logo lands, without waiting for a manifest
  // refetch. Falls back to the persisted manifest slot (robust on remount).
  const [eventLogoUrl, setEventLogoUrl] = useState<string | null>(null);
  // `sealing` drives the packaging payoff: rows converge to the centre and fade
  // behind the "kit ready" box that rises in front. `collapseYs` holds each
  // row's measured offset to the rows' centre so they collapse INTO the box.
  const [sealing, setSealing] = useState(false);
  const [collapseYs, setCollapseYs] = useState<number[]>([]);
  const rowsRef = useRef<HTMLDivElement>(null);
  const assembledFiredRef = useRef(false);

  useEffect(() => {
    fireDesignKitImpression(DESIGN_KIT_EID.assembling, { source: 'system' });
  }, []);

  // Re-fetch brand data immediately when the agent mutates brand assets so rows
  // fill live (and the last-written row lands before the step advances).
  useEffect(() => {
    const onUpdate = (e: Event): void => {
      const detail = (e as CustomEvent).detail as { appId?: string } | undefined;
      if (!detail?.appId || detail.appId === appId) void refetch?.();
    };
    const onLogo = (e: Event): void => {
      // The logo event detail is a LogoData (absolute CDN urls, no appId), so it
      // can't be app-scoped here — the manifest lookup below is the scoped source.
      const detail = (e as CustomEvent).detail as LogoData | undefined;
      const url = detail ? getLogoDisplayUrl(detail) : undefined;
      if (url) setEventLogoUrl(url);
      setLogoReady(true);
      onUpdate(e);
    };
    window.addEventListener(BRAND_DATA_UPDATED_EVENT, onUpdate);
    window.addEventListener('logo-generated', onLogo);
    return () => {
      window.removeEventListener(BRAND_DATA_UPDATED_EVENT, onUpdate);
      window.removeEventListener('logo-generated', onLogo);
    };
  }, [appId, refetch]);

  const requestFonts = useLazyFontFaces();

  const kit = data?.kit?.name ? data.kit : undefined;
  const projectName = data?.brandName && data.brandName !== 'Your Brand' ? data.brandName : undefined;
  const swatches = [
    data?.palette?.primary,
    data?.palette?.secondary,
    data?.palette?.accent,
    data?.palette?.background,
    data?.palette?.muted,
  ].filter((c): c is string => typeof c === 'string');
  const headingFamily = data?.typography?.heading?.family;
  const bodyFamily = data?.typography?.body?.family;

  // Load the kit's heading + body faces so the Fonts row renders in the real
  // typefaces (the "Aa" specimen + the family names), not a browser fallback.
  useEffect(() => {
    requestFonts([headingFamily, bodyFamily].filter((f): f is string => !!f));
  }, [requestFonts, headingFamily, bodyFamily]);
  const moodImages = data?.imagery?.moodImages ?? [];
  const voiceWords = (data?.voice?.weAre ?? []).filter(Boolean).slice(0, 4);
  const summaryText = data?.summary?.text;
  // Render the logo on its intended brand background so a light-on-transparent
  // (or dark-on-transparent) mark stays visible in the thumbnail.
  const logoBg = data?.palette?.background ?? '#ffffff';
  const logoUrl = useMemo(() => {
    if (eventLogoUrl) return eventLogoUrl;
    for (const slot of LOGO_SLOT_NAMES) {
      const url = manifest?.[slot]?.currentUrl;
      if (url) return getSlotImageUrl(slot, url, previewBaseUrl);
    }
    return null;
  }, [eventLogoUrl, manifest, previewBaseUrl]);

  const assets: Asset[] = [
    {
      key: 'kit',
      label: 'Design kit',
      filled: !!kit,
      icon: <IconKit />,
      content: (
        <div className="min-w-0 truncate">
          <text.span className="font-semibold">{kit?.name}</text.span>
        </div>
      ),
    },
    {
      key: 'colors',
      label: 'Color',
      filled: swatches.length > 0,
      icon: <IconColors />,
      content: (
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex shrink-0 items-center gap-1.5">
            {swatches.slice(0, 6).map((hex, i) => (
              <motion.span
                key={hex + i}
                initial={reduce ? false : { scale: 0, y: 5 }}
                animate={{ scale: 1, y: 0 }}
                transition={{ delay: 0.16 + i * 0.06, type: 'spring', stiffness: 500, damping: 18 }}
                className="h-5 w-5 rounded-full border border-intents-ux-box-borderColor"
                style={{ backgroundColor: hex }}
              />
            ))}
          </div>
        </div>
      ),
    },
    {
      key: 'fonts',
      label: 'Fonts',
      filled: !!headingFamily,
      icon: <IconFonts />,
      content: (
        <div className="flex min-w-0 items-baseline gap-2.5 leading-none">
          <span className="shrink-0 text-xl font-semibold tracking-tight" style={headingFamily ? { fontFamily: headingFamily } : undefined}>Aa</span>
          {headingFamily && (
            <text.span as="caption" emphasis="passive" className="truncate">
              <span style={{ fontFamily: headingFamily }}>{headingFamily}</span>
              {bodyFamily && bodyFamily !== headingFamily && (
                <>
                  {' / '}
                  <span style={{ fontFamily: bodyFamily }}>{bodyFamily}</span>
                </>
              )}
            </text.span>
          )}
        </div>
      ),
    },
    {
      key: 'imagery',
      // Complete once the mood images are in — the descriptor keyword arrives
      // later (the brand tool) and isn't needed to mark imagery done.
      label: 'Imagery',
      filled: moodImages.length > 0,
      icon: <IconImagery />,
      content: (
        <div className="flex min-w-0 items-center gap-1.5">
          {moodImages.slice(0, 4).map((img, i) => (
            <motion.img
              key={img.slot}
              initial={reduce ? false : { scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.12 + i * 0.08, type: 'spring', stiffness: 420, damping: 20 }}
              src={getSlotImageUrl(img.slot, img.url, previewBaseUrl)}
              alt=""
              className="h-9 w-9 shrink-0 rounded-md border border-intents-ux-box-borderColor object-cover"
            />
          ))}
        </div>
      ),
    },
    {
      key: 'voice',
      label: 'Voice',
      filled: voiceWords.length > 0,
      icon: <IconVoice />,
      content: (
        <div className="flex min-w-0 items-center gap-1 overflow-hidden">
          {voiceWords.map((w, i) => (
            <motion.span
              key={w + i}
              initial={reduce ? false : { opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.16 + i * 0.07 }}
              className="shrink-0 rounded-full bg-intents-ux-boxLowContrast-backgroundColor px-2 py-0.5"
            >
              <text.span as="caption" className="font-medium">{w}</text.span>
            </motion.span>
          ))}
        </div>
      ),
    },
    {
      key: 'summary',
      label: 'Summary',
      filled: !!summaryText,
      icon: <IconSummary />,
      content: (
        <div className="min-w-0 truncate">
          <text.span as="caption" emphasis="passive">{summaryText}</text.span>
        </div>
      ),
    },
    {
      key: 'logo',
      label: 'Logo',
      // Generated last (often in parallel with imagery); ready once the event or
      // the manifest yields a logo URL.
      filled: !!logoUrl || logoReady,
      icon: <IconLogo />,
      content: (
        <div className="flex items-center gap-2">
          {logoUrl ? (
            <span
              className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-md border border-intents-ux-box-borderColor"
              style={{ background: logoBg }}
            >
              <motion.img
                initial={reduce ? false : { scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: 'spring', stiffness: 420, damping: 20 }}
                src={logoUrl}
                alt=""
                className="h-full w-full object-contain"
              />
            </span>
          ) : (
            <span className="flex h-6 w-6 items-center justify-center rounded-md text-[10px] font-bold text-white" style={{ background: AIRO }}>
              {(projectName ?? 'A').trim().charAt(0).toUpperCase() || 'A'}
            </span>
          )}
          <text.span as="caption" emphasis="passive">Logo ready</text.span>
        </div>
      ),
    },
  ];

  const collected = assets.filter((a) => a.filled).length;
  const total = assets.length;
  const allDone = collected === total;
  const pct = total === 0 ? 0 : Math.round((collected / total) * 100);

  // Keep the latest onAssembled in a ref so the sealing timer (below) reads it
  // without taking it as a dependency — the parent passes a fresh closure each
  // render, and re-running that effect would clear the in-flight timer and
  // strand the wizard on step 2.
  const onAssembledRef = useRef(onAssembled);
  useEffect(() => {
    onAssembledRef.current = onAssembled;
  }, [onAssembled]);
  const sealStartedRef = useRef(false);

  // Kick off the packaging payoff only once the kit is complete AND the agent
  // has advanced to step 3 — so the collapse → box → shimmer plays right as we
  // transition, never finishing early and stalling with nothing to switch to.
  // Once started it runs to completion (sealStartedRef guards re-entry).
  useEffect(() => {
    if (mode === 'progress' || !allDone || step < 3 || sealStartedRef.current) return undefined;
    sealStartedRef.current = true;
    // Measure while the rows are still at rest: how far each must travel to reach
    // the rows' vertical centre (where the ready box rises). Done before flipping
    // `sealing` so the rows animate from their real resting positions.
    const container = rowsRef.current;
    if (container && !reduce) {
      const cRect = container.getBoundingClientRect();
      const centerY = cRect.top + cRect.height / 2;
      setCollapseYs(
        Array.from(container.children).map((child) => {
          const r = (child as HTMLElement).getBoundingClientRect();
          return centerY - (r.top + r.height / 2);
        }),
      );
    }
    setSealing(true);
    const t = setTimeout(() => {
      if (assembledFiredRef.current) return;
      assembledFiredRef.current = true;
      onAssembledRef.current?.();
    }, reduce ? SEAL_MS_REDUCED : SEAL_MS);
    return () => clearTimeout(t);
  }, [allDone, step, reduce, mode]);

  // Fallback: the agent advanced to step 3+ with nothing left to package — don't
  // strand the wizard on the assembling view, release it immediately.
  useEffect(() => {
    if (mode !== 'progress' && step >= 3 && !allDone && !assembledFiredRef.current) {
      assembledFiredRef.current = true;
      onAssembledRef.current?.();
    }
  }, [step, allDone, mode]);

  return (
    <div data-testid="design-kit-assembling" className="relative w-full">
      {/* Compact progress — fades up as the kit seals. */}
      <motion.div
        className="mb-3 flex items-center gap-3"
        animate={sealing && !reduce ? { opacity: 0, y: -10 } : { opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: 'easeInOut' }}
      >
        <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-intents-ux-box-backgroundColor">
          <motion.div
            className="absolute inset-y-0 left-0 rounded-full"
            style={{ background: 'linear-gradient(90deg, var(--color-ai-dark), var(--color-ai-light))' }}
            initial={false}
            animate={{ width: `${pct}%` }}
            transition={{ type: 'spring', stiffness: 90, damping: 18 }}
          />
          {allDone && !reduce && (
            <motion.div
              className="absolute inset-0 rounded-full"
              style={{ background: 'rgba(255,255,255,0.4)' }}
              initial={{ x: '-100%' }}
              animate={{ x: '100%' }}
              transition={{ duration: 0.9, ease: 'easeOut' }}
            />
          )}
        </div>
        <text.span as="caption" className="shrink-0 font-semibold tabular-nums" style={{ color: AIRO }}>
          {collected}/{total}
        </text.span>
      </motion.div>

      {/* Rows — each row converges to the centre, shrinks and fades behind the
          ready box on seal (collapsed INTO the box, staggered). */}
      <div ref={rowsRef} className="relative z-0 space-y-1.5">
        {assets.map((asset, i) => (
          <AssetRow
            key={asset.key}
            asset={asset}
            index={i}
            reduce={!!reduce}
            sealing={sealing}
            collapseY={collapseYs[i] ?? 0}
          />
        ))}
      </div>

      {/* The payoff: the assembled kit rises to the front, sealed and ready. */}
      <AnimatePresence>
        {sealing && (
          <motion.div
            key="ready"
            className="absolute inset-x-0 top-1/2 z-20 -translate-y-1/2"
            initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.82, y: 14 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.98, y: -6 }}
            // Rises after the rows have collapsed in (so it forms FROM them).
            transition={{ type: 'spring', stiffness: 230, damping: 22, delay: reduce ? 0 : 0.55 }}
          >
            {/* Soft halo so the box reads as lifting off the stack. */}
            {!reduce && (
              <motion.span
                aria-hidden
                className="pointer-events-none absolute -inset-6 rounded-[28px]"
                style={{ background: 'radial-gradient(60% 60% at 50% 50%, color-mix(in srgb, var(--color-ai) 26%, transparent), transparent 75%)' }}
                initial={{ opacity: 0, scale: 0.7 }}
                animate={{ opacity: [0, 1, 0.7], scale: [0.7, 1.05, 1] }}
                transition={{ duration: 0.9, ease: 'easeOut', delay: 0.55 }}
              />
            )}
            <KitReadyBanner
              swatches={swatches}
              headingFamily={headingFamily}
              projectName={projectName}
              kitName={kit?.name}
              reduce={!!reduce}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function AssetRow({
  asset,
  index,
  reduce,
  sealing,
  collapseY,
}: {
  asset: Asset;
  index: number;
  reduce: boolean;
  sealing: boolean;
  /** Pixels this row travels to reach the rows' centre during the seal. */
  collapseY: number;
}): JSX.Element {
  const { key, label, filled, icon, content } = asset;
  const [justLanded, setJustLanded] = useState(false);
  const prevFilled = useRef(filled);

  useEffect(() => {
    if (filled && !prevFilled.current) {
      setJustLanded(true);
      const t = setTimeout(() => setJustLanded(false), 1100);
      prevFilled.current = filled;
      return () => clearTimeout(t);
    }
    prevFilled.current = filled;
    return undefined;
  }, [filled]);

  const restAnim = filled
    ? { opacity: 1, x: 0, scale: 1 }
    : { opacity: reduce ? 0.7 : 0.5, x: 0, scale: 1 };

  return (
    <motion.div
      data-testid={`assemble-tile-${key}`}
      data-filled={filled}
      initial={reduce ? false : { opacity: 0, x: -14 }}
      animate={
        sealing
          ? reduce
            ? { opacity: 0 }
            : { y: collapseY, scale: 0.82, opacity: 0 }
          : justLanded && !reduce
            ? { opacity: [0.5, 1, 1], x: [-14, 5, 0], scale: [0.98, 1.02, 1] }
            : restAnim
      }
      transition={
        sealing
          ? {
              // Slow, clearly-staggered collapse; opacity fades late so each row
              // stays visible while it travels into the box.
              duration: 0.85,
              ease: [0.45, 0, 0.15, 1],
              delay: reduce ? 0 : index * 0.1,
              opacity: { duration: 0.45, delay: (reduce ? 0 : index * 0.1) + 0.4 },
            }
          : justLanded && !reduce
            ? { duration: 0.6, times: [0, 0.55, 1], ease: 'easeOut' }
            : { type: 'spring', stiffness: 300, damping: 26, delay: filled ? 0 : 0.04 * index }
      }
      className={`relative flex items-center gap-2.5 overflow-hidden rounded-xl border px-3 py-2 ${
        filled
          ? 'border-transparent bg-intents-ux-box-backgroundColor'
          : 'border-dashed border-intents-ux-box-borderColor bg-intents-ux-boxLowContrast-backgroundColor'
      }`}
      style={filled ? { boxShadow: '0 6px 22px -14px var(--color-ai-glow)' } : undefined}
    >
      {/* Airo-tinted wash that sweeps across the row as it lands. */}
      <AnimatePresence>
        {justLanded && !reduce && (
          <motion.span
            key="wash"
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{ background: 'linear-gradient(90deg, color-mix(in srgb, var(--color-ai) 16%, transparent), transparent 60%)' }}
            initial={{ opacity: 0.9, x: '-30%' }}
            animate={{ opacity: 0, x: '10%' }}
            transition={{ duration: 0.7, ease: 'easeOut' }}
          />
        )}
      </AnimatePresence>

      {/* Glow burst behind the icon as it lands. */}
      <AnimatePresence>
        {justLanded && !reduce && (
          <motion.span
            key="burst"
            aria-hidden
            initial={{ opacity: 0.5, scale: 0 }}
            animate={{ opacity: 0, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.9, ease: 'easeOut' }}
            className="pointer-events-none absolute left-5 top-1/2 h-12 w-12 -translate-y-1/2 rounded-full"
            style={{ background: 'radial-gradient(circle, color-mix(in srgb, var(--color-ai) 60%, transparent), transparent 70%)' }}
          />
        )}
      </AnimatePresence>

      {/* icon chip (no pop — just a smooth colour change as it fills) */}
      <span
        className={`relative flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors ${
          filled ? 'text-white' : 'bg-intents-ux-boxLowContrast-backgroundColor text-intents-ux-feedbackHighContrastPassive-feedbackColor'
        }`}
        style={filled ? { background: AIRO } : undefined}
      >
        {icon}
      </span>

      {/* label */}
      <span className="w-24 shrink-0">
        <text.span as="caption" emphasis={filled ? undefined : 'passive'} className="font-medium">{label}</text.span>
      </span>

      {/* content / waiting — values fade in as the row fills */}
      <div className="relative flex min-w-0 flex-1 items-center">
        {filled ? (
          <motion.div
            className="flex min-w-0 flex-1 items-center"
            initial={reduce ? false : { opacity: 0, x: 8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: reduce ? 0 : 0.14, duration: 0.4, ease: 'easeOut' }}
          >
            {content}
          </motion.div>
        ) : (
          <motion.span
            animate={reduce ? undefined : { opacity: [0.4, 0.7, 0.4] }}
            transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut', delay: index * 0.15 }}
          >
            <text.span as="caption" emphasis="passive">waiting…</text.span>
          </motion.span>
        )}
      </div>

      {/* check / pending dot */}
      <span className="shrink-0">
        <AnimatePresence mode="wait">
          {filled ? (
            <motion.span
              key="check"
              initial={reduce ? false : { scale: 0, rotate: -30 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: 'spring', stiffness: 600, damping: 16, delay: 0.05 }}
              className="flex h-5 w-5 items-center justify-center rounded-full text-white"
              style={{ background: AIRO }}
            >
              <CheckmarkIcon className="h-3 w-3" />
            </motion.span>
          ) : (
            <span key="dot" className="block h-5 w-5 rounded-full border border-dashed border-intents-ux-box-borderColor" />
          )}
        </AnimatePresence>
      </span>
    </motion.div>
  );
}

/**
 * The completion payoff: a compact "brand board" showing the assembled kit
 * (monogram, palette, type, names) with a shine. Positioned/animated by the
 * caller — this just renders the sealed box itself.
 */
function KitReadyBanner({
  swatches,
  headingFamily,
  projectName,
  kitName,
  reduce,
}: {
  swatches: string[];
  headingFamily?: string;
  projectName?: string;
  kitName?: string;
  reduce: boolean;
}): JSX.Element {
  const caption = [kitName, projectName].filter(Boolean).join(' · ') || 'Sealed and ready to refine';
  return (
    <div
      className="relative overflow-hidden rounded-xl px-4 py-2.5 text-white"
      style={{
        background: 'linear-gradient(135deg, var(--color-ai-dark), var(--color-ai-light))',
        boxShadow: '0 18px 50px -16px var(--color-ai-glow)',
      }}
    >
      {!reduce && (
        <motion.div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{ background: 'linear-gradient(105deg, transparent 30%, rgba(255,255,255,0.35) 50%, transparent 70%)' }}
          initial={{ x: '-120%' }}
          animate={{ x: '120%' }}
          // Plays after the box has risen — the shimmer is the closing beat.
          transition={{ duration: 1, ease: 'easeOut', delay: 1.05 }}
        />
      )}
      <div className="relative flex items-center gap-2.5">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white/20">
          <SparklesIcon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1 leading-tight">
          <span className="block text-[13px] font-semibold text-white">Your brand kit is ready</span>
          <span className="block truncate text-[11px] text-white/80">{caption}</span>
        </div>
        {/* mini board: palette + type specimen */}
        <div className="hidden items-center gap-2.5 sm:flex">
          <div className="flex items-center gap-1">
            {swatches.slice(0, 5).map((hex, i) => (
              <span key={hex + i} className="h-4 w-4 rounded-full ring-1 ring-white/40" style={{ backgroundColor: hex }} />
            ))}
          </div>
          <span className="text-lg font-semibold leading-none" style={headingFamily ? { fontFamily: headingFamily } : undefined}>Aa</span>
        </div>
      </div>
    </div>
  );
}

/* — inline icons (currentColor) — */
function IconKit(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M2.5 5.5 8 2.5l5.5 3v5L8 13.5l-5.5-3z" strokeLinejoin="round" /><path d="M2.5 5.5 8 8.5l5.5-3M8 8.5v5" />
    </svg>
  );
}
function IconColors(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4" fill="currentColor">
      <circle cx="5" cy="6" r="2.4" /><circle cx="11" cy="6" r="2.4" opacity="0.7" /><circle cx="8" cy="11" r="2.4" opacity="0.5" />
    </svg>
  );
}
function IconFonts(): JSX.Element {
  return <span className="text-[12px] font-bold leading-none">Aa</span>;
}
function IconLogo(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="2.5" y="2.5" width="11" height="11" rx="2.5" /><circle cx="8" cy="8" r="2.2" fill="currentColor" stroke="none" />
    </svg>
  );
}
function IconImagery(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="2" y="3" width="12" height="10" rx="2" /><path d="m3.5 12 3.2-3.2 2.3 2.3 1.6-1.6L13 12" strokeLinecap="round" strokeLinejoin="round" /><circle cx="6" cy="6" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}
function IconVoice(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M3 4.5h10v6H7l-3 2.5v-2.5H3z" strokeLinejoin="round" />
    </svg>
  );
}
function IconSummary(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M4 3h8M4 6h8M4 9h6M4 12h4" strokeLinecap="round" />
    </svg>
  );
}
