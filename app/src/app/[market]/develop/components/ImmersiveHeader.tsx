'use client';

import Link from 'next/link';
import { type JSX } from 'react';
import Tag from '@ux/tag';

import { useAppIdFromParams } from '@/app/[market]/develop/components/utils';
import { AiroLogo } from '@/components/layout/AiroLogo';
import UserMenu from '@/components/layout/UserMenu';
import { useTranslations } from '@/hooks/useTranslations';
import { logClickEvent } from '@/utils/instrumentation';

/**
 * Minimal top bar for the immersive layout (AIROBUILD-2679 Phase 2).
 *
 * Replaces the full `DevelopHeader` while the immersive layout is active so the
 * chat reads as an immersive experience — not a bare browser-fullscreen view —
 * without the Preview/Edit/Code/Brand toggles or chat-collapse control that would
 * pull the user out of the immersive flow. Just the Airo logo (home link) and the
 * user dropdown, composed from the same primitives the full header uses.
 */
export function ImmersiveHeader(): JSX.Element {
  const t = useTranslations();
  const appId: string = useAppIdFromParams();

  return (
    <header
      data-testid="immersive-header"
      className="flex shrink-0 items-center justify-between gap-2 p-1.5 md:p-2.5"
    >
      <div className="flex items-center gap-1" data-partial="componentAiro">
        <Link
          href="/"
          className="flex items-center"
          onClick={() => logClickEvent('develop.header.airo_ai_link', appId ? { appId } : undefined)()}
        >
          <AiroLogo className="relative" />
        </Link>
        <Tag emphasis="highlight" highcontrast>{t('builder_beta')}</Tag>
      </div>
      <UserMenu location="develop" />
    </header>
  );
}
