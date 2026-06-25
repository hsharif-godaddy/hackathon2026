'use client';

import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { type JSX, useRef } from 'react';
import WandIcon from '@ux/icon/wand';
import text from '@ux/text';

import { ViewMode } from '@/app/[market]/develop/components/types';
import { useDevelopPageStore } from '@/stores/useDevelopPageStore';
import { AssemblingKit } from './AssemblingKit';
import { useWizardPhase } from './useWizardPhase';
import { WebsiteHandoff, WebsiteHandoffDone } from './WebsiteHandoff';

// The wizard chrome is Airo-branded (`--color-ai`), not the user's generated
// brand colour — those appear only once the site is built.
const AIRO = 'var(--color-ai)';

/**
 * Design Kit Wizard shell (AIROBUILD-2679 Phase 2; AIROBUILD-2855 immersive flow).
 *
 * Routes by phase — the flow is agent-driven (no manual build/refine buttons):
 * - `gathering`: chat-only; the agent gathers info and the user picks a vibe. The
 *   wizard content is off-screen (chat is full-width) so this just renders the
 *   assembling view as a fallback.
 * - `brand`: chat docks left and the "Building Your Brand" progress panel fills as
 *   the agent assembles the kit (AssemblingKit in steady `progress` mode — no seal).
 * - `website`: the agent has handed off; the website is building (chat still left).
 * - `ready`: the build has completed; play the launch send-off once, then flip to
 *   the Edit tab so the build overlay takes over.
 *
 * `ready` is driven by the real build-completion signal
 * (`useDevelopPageStore.app.initialBuildComplete`) — the agent never emits it.
 */
export function DesignKitWizard({
  appId,
}: {
  appId: string;
}): JSX.Element {
  const { phase } = useWizardPhase(appId);
  const reduce = useReducedMotion();

  // The `ready` phase hands off to the build: the launch sequence plays, then we
  // flip the view to the Edit tab so the build overlay takes over.
  const setViewMode = useDevelopPageStore((s) => s.setViewMode);
  const handleHandoffComplete = (): void => {
    setViewMode(ViewMode.EDIT);
  };

  // Drive the hand-off from the real build-completion signal — the agent never
  // emits `ready`. Scope to this app so a stale store entry for another app can't
  // flip us. The hand-off shows when the build is done OR the persisted phase is
  // already `ready`, so the reveal does not wait on the setPhase round-trip below.
  const initialBuildComplete = useDevelopPageStore(
    (s) => (s.app?.id === appId ? (s.app?.initialBuildComplete ?? false) : false),
  );
  const inHandoff = phase === 'ready' || initialBuildComplete;

  // Distinguish the live build (mounted while gathering/brand/website, then reached
  // the hand-off) from resuming straight into it: only the former replays the launch
  // animation. Captured once on first render.
  const startedAtReadyRef = useRef<boolean | null>(null);
  if (startedAtReadyRef.current === null) startedAtReadyRef.current = inHandoff;

  // Which visual to render. `ready` (hand-off) renders its own full-screen send-off.
  const visual: 'building-brand' | 'building-website' | 'handoff' =
    inHandoff ? 'handoff' : phase === 'website' ? 'building-website' : 'building-brand';

  const title: string =
    phase === 'website' ? 'Building your website.' : 'Building your brand.';
  const subtitle: JSX.Element =
    phase === 'website' ? (
      <>Airo is assembling your site from this brand — almost there.</>
    ) : (
      <>Airo is crafting your brand — about <span className="font-semibold" style={{ color: AIRO }}>4–6 minutes</span>.</>
    );

  return (
    <div
      className="flex h-full w-full flex-col overflow-auto bg-intents-ux-boxLowContrast-backgroundColor"
      data-testid="design-kit-wizard"
    >
      {/* The hand-off (ready) renders its own full-screen send-off, so suppress the
          compact wizard header during it. */}
      {visual !== 'handoff' && (
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
              <h1 className="text-xl font-semibold tracking-tight text-intents-ux-box-foregroundColor">{title}</h1>
            </div>
            <text.p as="caption" emphasis="passive" className="mt-1.5">{subtitle}</text.p>
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
              // Stage c (AIROBUILD-2856) replaces this with the website-assembly
              // animation. ponytail: a calm spinner panel until then.
              <div
                data-testid="design-kit-building-website"
                className="mx-auto flex min-h-[44vh] w-full max-w-3xl flex-col items-center justify-center gap-4 text-center"
              >
                <span
                  className="h-9 w-9 animate-spin rounded-full border-2 border-[color-mix(in_srgb,var(--color-ai)_25%,transparent)] border-t-[color-mix(in_srgb,var(--color-ai)_90%,transparent)]"
                  aria-hidden
                />
                <text.span as="caption" emphasis="passive">Assembling your site from this brand…</text.span>
              </div>
            )}

            {visual === 'handoff' && (
              startedAtReadyRef.current
                ? <WebsiteHandoffDone onGo={() => setViewMode(ViewMode.EDIT)} />
                : <WebsiteHandoff appId={appId} onComplete={handleHandoffComplete} />
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
