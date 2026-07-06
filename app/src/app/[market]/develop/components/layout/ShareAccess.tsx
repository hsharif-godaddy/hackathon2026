'use client';

import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Users3Icon from '@ux/icon/users3';
import XIcon from '@ux/icon/x';

import IconButton from '@/app/[market]/develop/components/IconButton';
import TeamPanel from '@/app/[market]/develop/components/settings/TeamPanel';
import { useSwitchboard } from '@/hooks/useSwitchboard';
import { useTranslations } from '@/hooks/useTranslations';
import { stopReconcilePolling, triggerCollaboratorReconcile } from '@/lib/mgmt-airo/trigger-collaborator-reconcile';
import { logger } from '@/lib/request-context';
import { useDevelopPageStore } from '@/stores/useDevelopPageStore';

/**
 * "Share access" — develop-header toolbar entry that opens team / Users
 * management (the `multiusersEsm` panel via `TeamPanel`), positioned just before
 * the Share-link button. Single home for team management (the former Settings →
 * "Users" nav item was removed — see useSettingsNavItems).
 *
 * Alignment: it renders in the develop CONTENT AREA — below the header and to
 * the inline-end of the chat panel — so the header and chat panel stay visible
 * and interactive (not a whole-screen takeover). Because the CDS `ComponentLoader`
 * always `createPortal`s the bundle to `document.body` (fixed, z-1000, see
 * cdsLoader.tsx + the `.cds-team-portal` rule in globals.scss), we can't nest it
 * in the content-area DOM. Instead we publish the content-area bounds as CSS
 * variables on :root — `--sa-top` (header height) and `--sa-inline-start` (chat
 * panel offset) — and both our backdrop and `.cds-team-portal` inset to them.
 *
 * Layering (all in the document.body stacking context so z-index is comparable
 * to the body-level CDS portal):
 *   - backdrop z-999 (opaque; hosts TeamPanel's inline loading/no-venture/error
 *     states; gives the transparent-by-default bundle a solid surface)
 *   - CDS bundle portal z-1000 (`.cds-team-portal`)
 *   - close button z-1001 (stays clickable above the bundle)
 *
 * Visible only when multi-user is on (`aab-multi-user`). The legacy
 * delegate-access cohort (`appbuilder-settings-team`) keeps its "Manage access"
 * (SSO /access) link in Project settings (ProjectPanel), exactly as on main, so
 * the two don't double up. The overlay (and the heavy CDS bundle) mount only
 * while open.
 */
export default function ShareAccess(): React.ReactElement | null {
  const [open, setOpen] = useState(false);
  const [headerBottom, setHeaderBottom] = useState(0);
  const multiUser = useSwitchboard('aab-multi-user');
  const chatPaneWidth = useDevelopPageStore((state) => state.chatPaneWidth);
  const isChatPaneCollapsed = useDevelopPageStore((state) => state.isChatPaneCollapsed);
  const currentAppId = useDevelopPageStore((state) => state.currentAppId);
  const activeSettingsSection = useDevelopPageStore((state) => state.activeSettingsSection);

  // Inline-start offset of the content area — mirrors page.tsx's content motion
  // div (`isChatPaneCollapsed ? 8 : chatPaneWidth + 16`).
  const inlineStart = isChatPaneCollapsed ? 8 : chatPaneWidth + 16;

  // Close the overlay when the user navigates to another settings section.
  // The Users overlay is a body-portaled layer over the content area, so a
  // "wide" settings panel (e.g. Domains) would otherwise render *behind* it and
  // be unreachable without closing Users first. Closing on section change keeps
  // the two from fighting over the same space. Uses a ref so it only fires on an
  // actual change (not the initial mount).
  const prevSectionRef = useRef(activeSettingsSection);
  useEffect(() => {
    if (prevSectionRef.current !== activeSettingsSection) {
      prevSectionRef.current = activeSettingsSection;
      setOpen(false);
    }
  }, [activeSettingsSection]);

  // Dismiss on any interaction OUTSIDE the team UI (e.g. clicking the Domains
  // nav / chat panel), so the user never has to hit Close first to reach a panel
  // behind the overlay. The CDS bundle renders in its own body portal
  // (.cds-team-portal) and its menus portal to body too, so those — plus our
  // backdrop, the close button, and the toolbar toggle — count as "inside".
  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const KEEP_OPEN_SELECTOR = [
      '[data-testid="share-access-fullpage"]',
      '[data-testid="share-access-close"]',
      '[data-testid="share-access-button"]',
      '.cds-team-portal',
      '.ux-flyout',
      '[data-radix-popper-content-wrapper]',
      // The team bundle's own dialogs/menus portal to body OUTSIDE .cds-team-portal
      // (e.g. the "remove user" confirmation). Clicking them must NOT dismiss the
      // overlay — only a click on the bare page/chat behind it should.
      '[role="dialog"]',
      '[role="alertdialog"]',
      '[role="menu"]',
      '.ux-modal',
      '.ux-disrupt',
      '.ux-disrupt-backdrop',
      '.ux-dialog',
    ].join(',');
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as HTMLElement | null;
      if (target && target.closest(KEEP_OPEN_SELECTOR)) {
        return;
      }
      setOpen(false);
    };
    // Capture phase so we observe the click before the bundle handles it; we
    // never preventDefault/stopPropagation, so inside interactions are untouched.
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [open]);

  // Close on Escape while open.
  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  // Track the header height so the overlay starts just below it.
  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const header = document.querySelector('[data-testid="airo-header"]');
    if (!header) {
      return undefined;
    }
    const measure = (): void => setHeaderBottom(header.getBoundingClientRect().bottom);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(header);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [open]);

  // Mirror the venture's FGA membership into the mgmt-airo collaborator table
  // when the Team panel OPENS. The multiusersEsm bundle writes venture/FGA tuples
  // directly (it never calls our BFF), so without this an invited user gets no
  // collaborator row and never shows up in their "shared with me" listing. A
  // single reconcile on open catches invites made in a prior session. The
  // ongoing convergence after an invite/resend/revoke is handled by TeamPanel's
  // reconcileOnTeamChange, which (re)starts a 30s poll for up to 5 minutes that
  // runs independent of the panel's open/close state. The route is
  // owner-authorized + idempotent and 404s when aab-multi-user is off, so
  // calling it on open is safe.
  useEffect(() => {
    if (!open || multiUser !== true || !currentAppId) {
      return undefined;
    }
    triggerCollaboratorReconcile(currentAppId);
    // Also reconcile once on close: a revoke made just before closing is mirrored
    // immediately, without waiting for the next 30s poll tick.
    return () => {
      triggerCollaboratorReconcile(currentAppId);
    };
  }, [open, multiUser, currentAppId]);

  // Tear down any in-flight reconcile poll when the app changes, multi-user turns
  // off, or this controller unmounts — NOT on panel close (the poll is meant to
  // outlive the panel so a just-made invite still converges after closing).
  useEffect(() => {
    if (multiUser !== true || !currentAppId) {
      return undefined;
    }
    return () => stopReconcilePolling(currentAppId);
  }, [multiUser, currentAppId]);

  // Mark the body while open so globals.scss can lift develop chrome (tooltips,
  // growls — body-portaled with z:auto) above the team overlay; otherwise the
  // team portal (z-1000) covers a header-icon tooltip that drops into the
  // content area. Scoped so it only applies while Share access is open.
  useEffect(() => {
    if (!open) {
      return undefined;
    }
    document.body.classList.add('share-access-open');
    return () => document.body.classList.remove('share-access-open');
  }, [open]);

  // Publish the content-area bounds as CSS vars for the body-level portal +
  // backdrop to inset to. Cleared on close.
  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const root = document.documentElement;
    root.style.setProperty('--sa-top', `${headerBottom}px`);
    root.style.setProperty('--sa-inline-start', `${inlineStart}px`);
    return () => {
      root.style.removeProperty('--sa-top');
      root.style.removeProperty('--sa-inline-start');
    };
  }, [open, headerBottom, inlineStart]);

  const t = useTranslations();

  // Multi-user collaboration only. Legacy delegate access
  // (appbuilder-settings-team) stays in Project settings (ProjectPanel) as on
  // main — so this header button is strictly the multi-user surface and the two
  // don't double up.
  const enabled = multiUser === true;
  if (!enabled) {
    return null;
  }

  const canPortal = typeof document !== 'undefined';

  // Inset the box to the content area (header + chat panel stay visible).
  const contentAreaInset: React.CSSProperties = {
    insetBlockStart: 'var(--sa-top, 0px)',
    insetBlockEnd: 0,
    insetInlineStart: 'var(--sa-inline-start, 0px)',
    insetInlineEnd: 0,
  };

  return (
    <>
      <IconButton
        icon={<Users3Icon className="size-2.5" />}
        label={t('builder_share_access_label', undefined, 'Share access')}
        showLabelWhenActive={false}
        type="button"
        onClick={() => {
          logger.info('develop.share_access.open');
          setOpen(true);
        }}
        aria-haspopup="dialog"
        aria-expanded={open}
        data-testid="share-access-button"
      />

      {open &&
        canPortal &&
        createPortal(
          <>
            {/* Opaque backdrop in the content area, just BELOW the CDS bundle
                portal (z-1000). Hosts TeamPanel's inline states; the bundle
                paints in its own portal directly above this on the same surface. */}
            <div
              role="dialog"
              aria-modal="true"
              aria-label={t('builder_share_access_dialog_label', undefined, 'Share access')}
              style={contentAreaInset}
              className="fixed z-[999] flex flex-col overflow-auto bg-intents-ux-box-backgroundColor"
              data-testid="share-access-fullpage"
            >
              {/* m-auto centers a short child (the loading spinner / messages)
                  but collapses for tall content so it scrolls from the top. */}
              <div className="m-auto w-full p-4">
                <TeamPanel />
              </div>
            </div>

            {/* Close — ABOVE the z-1000 bundle portal so it stays clickable. */}
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label={t('builder_share_access_close', undefined, 'Close')}
              data-testid="share-access-close"
              style={{
                insetBlockStart: 'calc(var(--sa-top, 0px) + 0.75rem)',
                insetInlineEnd: '0.75rem',
              }}
              className="fixed z-[1001] flex items-center justify-center rounded-full border border-intents-ux-box-borderColor bg-intents-ux-box-backgroundColor p-2 shadow-md"
            >
              <XIcon className="size-2.5" />
            </button>
          </>,
          document.body
        )}
    </>
  );
}
