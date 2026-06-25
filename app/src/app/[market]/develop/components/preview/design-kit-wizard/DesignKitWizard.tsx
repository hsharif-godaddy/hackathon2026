'use client';

import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { type JSX, useEffect, useRef } from 'react';
import WandIcon from '@ux/icon/wand';
import text from '@ux/text';

import { ViewMode } from '@/app/[market]/develop/components/types';
import { useDevelopPageStore } from '@/stores/useDevelopPageStore';
import { AssemblingKit } from './AssemblingKit';
import { useWizardPhase } from './useWizardPhase';
import { WebsiteHandoff, WebsiteHandoffDone, WebsiteReadyCelebration } from './WebsiteHandoff';

// The wizard chrome is Airo-branded (`--color-ai`), not the user's generated
// brand colour — those appear only once the site is built.
const AIRO = 'var(--color-ai)';

// How long the "your website is ready" celebration holds before we reveal the
// finished site on the Preview tab.
const CELEBRATE_MS = 2600;

type WizardVisual = 'building-brand' | 'building-website' | 'celebrating' | 'resume-done';

/**
 * Design Kit Wizard shell (AIROBUILD-2679 Phase 2; AIROBUILD-2855 immersive flow).
 *
 * Routes by phase — the flow is agent-driven (no manual build/refine buttons):
 * - `gathering`: chat-only; the agent gathers info and the user picks a vibe. The
 *   wizard content is off-screen (chat is full-width) so this just renders the
 *   assembling view as a fallback.
 * - `brand`: chat docks left and the "Building Your Brand" progress panel fills as
 *   the agent assembles the kit (AssemblingKit in steady `progress` mode — no seal).
 * - `website`: the agent has handed off; the website-assembly animation plays while
 *   the build runs (chat still docked left).
 * - build complete: a brief "your website is ready" celebration, then we reveal the
 *   finished site on the Preview tab (chrome returns as the view leaves BRAND).
 * - resume: returning to an already-finished build shows a calm "watch it build"
 *   panel instead of replaying the assembly.
 *
 * The reveal is driven by the real build-completion signal
 * (`useDevelopPageStore.app.initialBuildComplete`) — the agent never emits `ready`.
 */
export function DesignKitWizard({
  appId,
}: {
  appId: string;
}): JSX.Element {
  const { phase } = useWizardPhase(appId);
  const reduce = useReducedMotion();

  const setViewMode = useDevelopPageStore((s) => s.setViewMode);

  // Drive the reveal from the real build-completion signal — the agent never emits
  // `ready`. Scope to this app so a stale store entry for another app can't flip us.
  const initialBuildComplete = useDevelopPageStore(
    (s) => (s.app?.id === appId ? (s.app?.initialBuildComplete ?? false) : false),
  );
  const inHandoff = phase === 'ready' || initialBuildComplete;

  // Distinguish a live build (mounted while gathering/brand/website, then the build
  // completed) from resuming straight into a finished build: only the latter shows
  // the calm "watch it build" panel. Captured once on first render.
  const startedAtReadyRef = useRef<boolean | null>(null);
  if (startedAtReadyRef.current === null) startedAtReadyRef.current = inHandoff;

  // The website-assembly animation plays *during* the build (the `website` phase).
  // When the real build completes we play a brief "your website is ready" beat, then
  // reveal the finished site on the Preview tab — PreviewPane's build overlay carries
  // any remaining loading there. Resuming into a finished build shows the calm panel
  // and waits for the user, so only auto-reveal for a live build.
  useEffect(() => {
    if (!(inHandoff && startedAtReadyRef.current === false)) return undefined;
    const t = window.setTimeout(() => setViewMode(ViewMode.PREVIEW), CELEBRATE_MS);
    return () => window.clearTimeout(t);
  }, [inHandoff, setViewMode]);

  // Which visual to render. The website-assembly animation plays during the build;
  // the moment it completes we celebrate, then (via the effect above) reveal the
  // finished site. Resuming into a finished build shows the calm "watch it build" panel.
  const visual: WizardVisual = ((): WizardVisual => {
    if (startedAtReadyRef.current) return 'resume-done';
    if (inHandoff) return 'celebrating';
    if (phase === 'website') return 'building-website';
    return 'building-brand';
  })();

  return (
    <div
      className="flex h-full w-full flex-col overflow-auto bg-intents-ux-boxLowContrast-backgroundColor"
      data-testid="design-kit-wizard"
    >
      {/* The compact header only frames the brand phase; the website-assembly
          animation and the resume panel carry their own captions. */}
      {visual === 'building-brand' && (
        <div className="mb-4 w-full px-4 pt-4">
          {/* Compact header: Airo wand + title inline, phase subtitle below */}
          <div className="mb-3 flex flex-col items-center text-center">
            <div className="flex items-center gap-2.5">
              <motion.span
                initial={reduce ? false : { scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: 'spring', stiffness: 400, damping: 18 }}
                className="flex h-8 w-8 items-center justify-center rounded-xl"
                style={{ background: 'color-mix(in srgb, var(--color-ai) 12%, white)', color: AIRO }}
              >
                <WandIcon className="h-4 w-4" />
              </motion.span>
              <h1 className="text-xl font-semibold tracking-tight text-intents-ux-box-foregroundColor">Building your brand.</h1>
            </div>
            <text.p as="caption" emphasis="passive" className="mt-1.5">
              Airo is crafting your brand — about <span className="font-semibold" style={{ color: AIRO }}>4–6 minutes</span>.
            </text.p>
          </div>
        </div>
      )}

      <div className="w-full px-4 pb-4">
        <AnimatePresence mode="wait">
          <motion.div
            key={visual}
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: -10 }}
            transition={{ duration: 0.35, ease: 'easeOut' }}
          >
            {visual === 'building-brand' && (
              // The steady "Building Your Brand" progress panel: 7 rows + progress
              // bar fill as the agent assembles the kit. No seal payoff, no buttons.
              <AssemblingKit appId={appId} step={2} mode="progress" />
            )}

            {visual === 'building-website' && (
              // Stage c (AIROBUILD-2856): the website-assembly animation plays during
              // the build, holding until the real build completes.
              <WebsiteHandoff appId={appId} />
            )}

            {visual === 'celebrating' && (
              // Build done: a short "your website is ready" payoff before the reveal.
              <WebsiteReadyCelebration />
            )}

            {visual === 'resume-done' && (
              // Resuming straight into a finished build: a calm panel back to the
              // build, rather than replaying the assembly.
              <WebsiteHandoffDone onGo={() => setViewMode(ViewMode.PREVIEW)} />
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
