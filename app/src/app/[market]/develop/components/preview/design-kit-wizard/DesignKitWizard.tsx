'use client';

import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { type JSX, useEffect, useRef, useState } from 'react';
import Button from '@ux/button';
import WandIcon from '@ux/icon/wand';
import text from '@ux/text';

import { ViewMode } from '@/app/[market]/develop/components/types';
import { useChatContext } from '@/contexts/ChatContext';
import { useDevelopPageStore } from '@/stores/useDevelopPageStore';
import { AssemblingKit } from './AssemblingKit';
import { DesignKitPanels } from './DesignKitPanels';
import { useWizardPhase } from './useWizardPhase';
import { WebsiteHandoff, WebsiteHandoffDone } from './WebsiteHandoff';

// The wizard chrome is Airo-branded (`--color-ai`), not the user's generated
// brand colour — those appear only in the working-phase showcase.
const AIRO = 'var(--color-ai)';

/**
 * Build the brand-showcase iframe URL from the preview URL.
 *
 * `previewUrl` already carries a `?airoShareToken=…` query (the BFF injects it so the
 * cross-site iframe authenticates via the URL instead of a 3P cookie). So we must set the
 * PATH to `/brand-showcase.html` and add the cache-bust as a query param — a naive
 * `${previewUrl}/brand-showcase.html?v=N` grafts the path onto the token's query VALUE
 * (e.g. `…/?airoShareToken=tok/brand-showcase.html?v=N`), which requests the wrong thing
 * and the showcase never loads.
 */
export function buildShowcaseUrl(previewUrl: string, reloadKey: number): string {
  try {
    const url = new URL(previewUrl);
    url.pathname = '/brand-showcase.html';
    url.searchParams.set('v', String(reloadKey));
    return url.toString();
  } catch {
    return `${previewUrl.replace(/\/+$/, '')}/brand-showcase.html?v=${reloadKey}`;
  }
}

/**
 * Design Kit Wizard shell (AIROBUILD-2679 Phase 2 — chat-only, 2-phase model).
 *
 * Routes by phase:
 * - `gathering`: chat-only "assembling the kit" state, no buttons. The agent
 *   gathers core info and assembles the kit while AssemblingKit's rows fill.
 * - `working`: the editing panels + the standalone brand-showcase iframe + the
 *   Build / Skip / Create-website buttons.
 * - `ready`: the build has completed; play the launch send-off once, then flip
 *   to the Edit tab so the build overlay takes over.
 *
 * `ready` is driven by the real build-completion signal
 * (`useDevelopPageStore.app.initialBuildComplete`) — the agent never emits it.
 */
export function DesignKitWizard({
  appId,
  previewUrl,
}: {
  appId: string;
  previewUrl?: string;
}): JSX.Element {
  const { phase, setPhase } = useWizardPhase(appId);
  const { sendMessage } = useChatContext();
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

  // Distinguish the live build (mounted while gathering/working, then reached the
  // hand-off) from resuming straight into it: only the former replays the launch
  // animation. Captured once on first render.
  const startedAtReadyRef = useRef<boolean | null>(null);
  if (startedAtReadyRef.current === null) startedAtReadyRef.current = inHandoff;

  // `assembled` flips true only once AssemblingKit's "kit ready" packaging
  // animation has finished; we hold the gathering → working crossfade until then
  // so the payoff is never cut short. `cameThroughGathering` distinguishes the
  // live build (gathering → working, play the payoff) from resuming straight at
  // `working` (skip it — nothing was just assembled).
  const [assembled, setAssembled] = useState(false);
  const [cameThroughGathering, setCameThroughGathering] = useState(false);
  useEffect(() => {
    if (phase === 'gathering') setCameThroughGathering(true);
  }, [phase]);

  // True from clicking "Build my brand showcase" until the showcase is ready (the
  // BRAND_SHOWCASE_READY handler clears it). Also cleared on any phase change.
  const [building, setBuilding] = useState(false);
  useEffect(() => { setBuilding(false); }, [phase]);

  // Persist the `ready` phase so the develop page reveals the chrome (it reads
  // phaseByApp). The DOM hand-off above does not wait on this round-trip.
  useEffect(() => {
    if (initialBuildComplete && phase !== 'ready') void setPhase('ready');
  }, [initialBuildComplete, phase, setPhase]);

  // Working-phase showcase readiness. The iframe loads `${previewUrl}/brand-showcase.html`,
  // but until the agent has actually written that file, Vite's SPA fallback serves
  // the site's index.html (the website) instead. So we keep the iframe hidden behind
  // a loader and only reveal it once the real showcase announces itself via
  // postMessage('BRAND_SHOWCASE_READY') — the website never sends that. Until then we
  // reload the iframe on an interval so it picks up the file the moment it's written.
  const [showcaseReady, setShowcaseReady] = useState(false);
  const [showcaseReloadKey, setShowcaseReloadKey] = useState(0);
  const showcaseReadyRef = useRef(false);
  useEffect(() => {
    if (phase !== 'working') return undefined;
    setShowcaseReady(false);
    showcaseReadyRef.current = false;
    // The showcase iframe is loaded cross-site from the preview URL, so validate
    // that BRAND_SHOWCASE_READY actually came from that origin before acting on it
    // (don't trust a postMessage from an arbitrary window). If previewUrl can't be
    // parsed we leave expectedOrigin null and fall back to the prior behaviour.
    const expectedOrigin: string | null = (() => {
      if (!previewUrl) return null;
      try {
        return new URL(previewUrl).origin;
      } catch {
        return null;
      }
    })();
    const onMessage = (e: MessageEvent): void => {
      if (expectedOrigin !== null && e.origin !== expectedOrigin) return;
      if ((e.data as { type?: string } | null)?.type === 'BRAND_SHOWCASE_READY') {
        showcaseReadyRef.current = true;
        setShowcaseReady(true);
        setBuilding(false); // showcase is live — re-enable the Build button for rebuilds
      }
    };
    window.addEventListener('message', onMessage);
    const intervalId = window.setInterval(() => {
      if (!showcaseReadyRef.current) setShowcaseReloadKey((k) => k + 1);
    }, 2500);
    return () => {
      window.removeEventListener('message', onMessage);
      window.clearInterval(intervalId);
    };
  }, [phase, previewUrl]);

  const handleBuild = (): void => {
    // Don't change phase here. The showcase becomes ready only AFTER the agent
    // has written public/brand-showcase.html — so we just request the build and
    // show a building state; the iframe reveals itself on BRAND_SHOWCASE_READY.
    setBuilding(true);
    void sendMessage({ content: 'Build my brand showcase' });
  };

  const handleCreateWebsite = (): void => {
    // Do NOT setPhase('ready') — `ready` is build-driven (initialBuildComplete).
    void sendMessage({ content: 'Create my website' });
  };

  // Crossfade between the two working visual phases: assembly (gathering, plus
  // the working-phase payoff while the kit seals) and editing (working, once the
  // payoff has finished). We linger on 'assembling' when the phase has advanced
  // to working but the packaging payoff hasn't finished (cameThroughGathering &&
  // !assembled). `ready` renders its own send-off outside this crossfade.
  const visual: 'assembling' | 'editing' | 'handoff' =
    inHandoff
      ? 'handoff'
      : phase === 'gathering'
        ? 'assembling'
        : cameThroughGathering && !assembled
          ? 'assembling'
          : 'editing';

  const subtitle: JSX.Element =
    phase === 'gathering' ? (
      <>Airo is crafting the perfect brand for you — about <span className="font-semibold" style={{ color: AIRO }}>4–6 minutes</span>.</>
    ) : phase === 'working' ? (
      <>Fine-tune any element — your brand updates live as you go.</>
    ) : (
      <>Handing off to build your website…</>
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
              <h1 className="text-xl font-semibold tracking-tight text-intents-ux-box-foregroundColor">Building your brand.</h1>
            </div>
            <text.p as="caption" emphasis="passive" className="mt-1.5">{subtitle}</text.p>
          </div>
        </div>
      )}

      <div className="w-full">
        <AnimatePresence mode="wait">
          <motion.div
            key={visual}
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: -10 }}
            transition={{ duration: 0.35, ease: 'easeOut' }}
          >
            {visual === 'assembling' && (
              // gathering: rows fill (step=2). working-before-assembled: feed
              // step=3 so the seal/payoff plays and fires onAssembled.
              <AssemblingKit
                appId={appId}
                step={phase === 'working' ? 3 : 2}
                onAssembled={() => setAssembled(true)}
              />
            )}

            {visual === 'handoff' && (
              startedAtReadyRef.current
                ? <WebsiteHandoffDone onGo={() => setViewMode(ViewMode.EDIT)} />
                : <WebsiteHandoff appId={appId} onComplete={handleHandoffComplete} />
            )}

            {visual === 'editing' && (
              <>
                {/* The showcase area appears only once the user has requested a build
                    (or it is already live) — otherwise there is no file yet and the
                    loader would spin forever. */}
                {previewUrl && (building || showcaseReady) && (
                  <div className="relative mb-8 h-[60vh] w-full">
                    <motion.iframe
                      // Remount on each reload tick so a not-yet-written showcase is
                      // re-fetched until it exists; the cache-bust query is belt-and-suspenders.
                      key={showcaseReloadKey}
                      initial={false}
                      animate={{ opacity: showcaseReady ? 1 : 0 }}
                      transition={{ duration: 0.4 }}
                      data-testid="design-kit-showcase-iframe"
                      title="Brand showcase"
                      src={buildShowcaseUrl(previewUrl, showcaseReloadKey)}
                      className="h-full w-full rounded-xl border border-intents-ux-box-borderColor"
                    />
                    {!showcaseReady && (
                      <div
                        data-testid="design-kit-showcase-loading"
                        className="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-xl border border-intents-ux-box-borderColor bg-intents-ux-boxLowContrast-backgroundColor"
                      >
                        <span
                          className="h-8 w-8 animate-spin rounded-full border-2 border-[color-mix(in_srgb,var(--color-ai)_25%,transparent)] border-t-[color-mix(in_srgb,var(--color-ai)_90%,transparent)]"
                          aria-hidden
                        />
                        <text.span as="caption" emphasis="passive">Preparing your brand showcase…</text.span>
                      </div>
                    )}
                  </div>
                )}

                <div className="mb-4">
                  <h2 className="text-[22px] font-semibold tracking-tight text-intents-ux-box-foregroundColor">Design your visuals</h2>
                  <text.p as="caption" emphasis="passive" className="mt-0.5">
                    Everything below is live — tweak any element and your brand updates instantly.
                  </text.p>
                </div>

                <motion.div
                  initial={reduce ? { opacity: 0 } : { opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.45, ease: 'easeOut', delay: 0.05 }}
                >
                  <DesignKitPanels appId={appId} />
                </motion.div>

                <div className="mt-2 pt-2 flex items-center justify-end gap-3 border-t border-intents-ux-box-borderColor">
                  {/* Optional path: skip the brand showcase and go straight to the website. */}
                  <Button
                    design="secondary"
                    data-testid="design-kit-skip-to-website"
                    text="Skip to my website"
                    onClick={handleCreateWebsite}
                  />
                  <Button
                    design="primary"
                    data-testid="design-kit-build"
                    text={building ? 'Building your showcase…' : 'Build my brand showcase'}
                    disabled={building}
                    onClick={handleBuild}
                  />
                  <Button
                    design="primary"
                    data-testid="design-kit-create-website"
                    text="Create my website"
                    onClick={handleCreateWebsite}
                  />
                </div>
              </>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
