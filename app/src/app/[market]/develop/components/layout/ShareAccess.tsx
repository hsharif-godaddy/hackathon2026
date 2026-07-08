'use client';

import type React from 'react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import Users3Icon from '@ux/icon/users3';

import IconButton from '@/app/[market]/develop/components/IconButton';
import TeamPanel from '@/app/[market]/develop/components/settings/TeamPanel';
import { SettingsSection } from '@/app/[market]/develop/components/types';
import { useSwitchboard } from '@/hooks/useSwitchboard';
import { useTranslations } from '@/hooks/useTranslations';
import { stopReconcilePolling, triggerCollaboratorReconcile } from '@/lib/mgmt-airo/trigger-collaborator-reconcile';
import { logger } from '@/lib/request-context';
import { useDevelopPageStore } from '@/stores/useDevelopPageStore';

export function ShareAccessButton(): React.ReactElement | null {
  const multiUser = useSwitchboard('aab-multi-user');
  const setActiveSettingsSection = useDevelopPageStore((state) => state.setActiveSettingsSection);
  const t = useTranslations();

  if (multiUser !== true) {
    return null;
  }

  return (
    <IconButton
      icon={<Users3Icon className="size-2.5" />}
      label={t('builder_share_access_label', undefined, 'Share access')}
      showLabelWhenActive={false}
      type="button"
      onClick={() => {
        logger.info('develop.share_access.open');
        setActiveSettingsSection(SettingsSection.TEAM);
      }}
      data-testid="share-access-button"
    />
  );
}

export default function ShareAccess(): React.ReactElement | null {
  const [open, setOpen] = useState(false);
  const [headerBottom, setHeaderBottom] = useState(0);
  const [headerInlineStart, setHeaderInlineStart] = useState(0);
  const multiUser = useSwitchboard('aab-multi-user');
  const chatPaneWidth = useDevelopPageStore((state) => state.chatPaneWidth);
  const isChatPaneCollapsed = useDevelopPageStore((state) => state.isChatPaneCollapsed);
  const isMobile = useDevelopPageStore((state) => state.isMobile);
  const currentAppId = useDevelopPageStore((state) => state.currentAppId);
  const activeSettingsSection = useDevelopPageStore((state) => state.activeSettingsSection);
  const setActiveSettingsSection = useDevelopPageStore((state) => state.setActiveSettingsSection);

  // In classic Develop: offset by chat sidebar. In Commander: use header's
  // measured left edge (aligns with Commander content area). Mobile: 0.
  const inlineStart: number = isMobile ? 0 : headerInlineStart;

  // Open the canvas when activeSettingsSection is TEAM (triggered by the
  // ProjectPanel "Share access" button). Close when it changes to anything else.
  // No ref guard — the effect must fire on mount too (handles mobile remount where
  // the store already holds TEAM from a prior interaction).
  useEffect(() => {
    setOpen(activeSettingsSection === SettingsSection.TEAM);
  }, [activeSettingsSection]);

  // Close when the user interacts outside the team UI — clicking a header
  // tab, the chat pane, etc. navigates away from the canvas. This is not a
  // "modal dismiss" but natural canvas-to-view navigation: the click closes
  // the canvas first, then the underlying button's handler fires on the
  // now-visible content.
  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const KEEP_OPEN_SELECTOR: string = [
      '[data-testid="share-access-fullpage"]',
      '[data-testid="share-access-button"]',
      '.cds-team-portal',
      '.ux-flyout',
      '[data-radix-popper-content-wrapper]',
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
      // Reset store so the ProjectPanel button can re-trigger the canvas
      // (zustand won't emit if value is already TEAM).
      if (activeSettingsSection === SettingsSection.TEAM) {
        setActiveSettingsSection(SettingsSection.PROJECT);
      }
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [open, activeSettingsSection, setActiveSettingsSection]);

  // Track header position so the canvas starts below and beside it.
  // Desktop Develop: top = header bottom, left = chatPaneWidth.
  // Desktop Commander: top = header bottom, left = header left (dock edge).
  // Mobile: all 0 (full viewport).
  useEffect(() => {
    if (!open || isMobile) {
      return undefined;
    }
    const developHeader: Element | null = document.querySelector('[data-testid="airo-header"]');
    const header: Element | null = developHeader ?? document.querySelector('[data-testid="commander-header"]');
    if (!header) {
      return undefined;
    }
    const isClassic: boolean = developHeader !== null;
    const measure = (): void => {
      const rect: DOMRect = header.getBoundingClientRect();
      setHeaderBottom(rect.bottom);
      setHeaderInlineStart(isClassic ? (isChatPaneCollapsed ? 8 : chatPaneWidth + 16) : rect.left);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(header);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [open, isMobile, isChatPaneCollapsed, chatPaneWidth]);

  // The multiusersEsm bundle writes venture/FGA tuples directly (never calls
  // our BFF), so without reconcile an invited user gets no collaborator row and
  // never appears in "shared with me". Fire on open to catch invites from a
  // prior session, and on close so a revoke made right before closing is
  // mirrored immediately without waiting for the 30s poll.
  useEffect(() => {
    if (!open || multiUser !== true || !currentAppId) {
      return undefined;
    }
    triggerCollaboratorReconcile(currentAppId);
    return () => {
      triggerCollaboratorReconcile(currentAppId);
    };
  }, [open, multiUser, currentAppId]);

  // Tear down any in-flight reconcile poll when the app changes, multi-user
  // turns off, or this controller unmounts.
  useEffect(() => {
    if (multiUser !== true || !currentAppId) {
      return undefined;
    }
    return () => stopReconcilePolling(currentAppId);
  }, [multiUser, currentAppId]);

  // Lift develop chrome (tooltips, growls) above the team portal while open.
  useEffect(() => {
    if (!open) {
      return undefined;
    }
    document.body.classList.add('share-access-open');
    return () => document.body.classList.remove('share-access-open');
  }, [open]);

  // The CDS ComponentLoader always createPortals the bundle to document.body
  // (fixed, z-1000), so we can't nest it in the content-area DOM. Publish the
  // content-area bounds as CSS vars so .cds-team-portal insets to them.
  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const root: HTMLElement = document.documentElement;
    root.style.setProperty('--sa-top', `${headerBottom}px`);
    root.style.setProperty('--sa-inline-start', `${inlineStart}px`);
    return () => {
      root.style.removeProperty('--sa-top');
      root.style.removeProperty('--sa-inline-start');
    };
  }, [open, headerBottom, inlineStart]);

  const t = useTranslations();

  const enabled: boolean = multiUser === true;
  if (!enabled) {
    return null;
  }

  const canPortal: boolean = typeof document !== 'undefined';

  const contentAreaInset: React.CSSProperties = {
    insetBlockStart: 'var(--sa-top, 0px)',
    insetBlockEnd: 0,
    insetInlineStart: 'var(--sa-inline-start, 0px)',
    insetInlineEnd: 0,
  };

  if (!open || !canPortal) {
    return null;
  }

  return createPortal(
    <div
      role="region"
      aria-label={t('builder_share_access_dialog_label', undefined, 'Share access')}
      style={contentAreaInset}
      className="fixed z-[999] flex flex-col overflow-auto bg-intents-ux-box-backgroundColor"
      data-testid="share-access-fullpage"
    >
      <div className="m-auto w-full p-4">
        <TeamPanel />
      </div>
    </div>,
    document.body
  );
}
