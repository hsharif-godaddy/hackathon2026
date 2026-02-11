'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import Box from '@ux/box';
import Tag from '@ux/tag';

import { UserMenu } from '@/components/auth';
import AppPublish from '@/components/layout/AppPublish';
import AppSelector from '@/components/layout/AppSelector';
import DiscordLink from '@/components/layout/DiscordLink';
import HeaderUpgradeButton from '@/components/layout/HeaderUpgradeButton';
import InviteFriends from '@/components/layout/InviteFriends';
import { useAuthContext } from '@/components/providers/AuthProvider';
import { useResponsive } from '@/hooks/useResponsive';
import { useTranslations } from '@/hooks/useTranslations';
import { generateClickEID } from '@/utils/instrumentation';
import { AiroLogo } from './AiroLogo';
import { HeaderProps } from './types';

export default function Header({ actions, onShowMockLogin, location = 'unknown' }: HeaderProps) {
  const t = useTranslations();
  const { isAuthenticated, isAuthDisabled, isLoading } = useAuthContext();
  const { isMobile } = useResponsive();
  const pathname = usePathname();
  const isDevelopPage = pathname?.includes('/develop');

  // Only show authenticated UI components when auth is confirmed (not loading) and user is authenticated
  // This prevents authenticated API calls from being made
  const showAuthenticatedUI = !isLoading && (isAuthenticated || isAuthDisabled);

  return (
    <header data-testid="airo-header" className={clsx(
      "text-intents-ux-boxHighContrast-foregroundColor",
      {
        "bg-gradient bg-intents-ux-boxHighContrast-backgroundColor": location !== 'homepage',
      }
    )}>
      <div className="mx-auto px-2 sm:px-3 lg:px-4">
        <div className="flex justify-between items-center h-8">
          <div className="flex items-center space-x-1.5" data-partial="componentAiro">
            <Link
              href="/"
              className="flex items-center"
              data-eid={ generateClickEID(`${location}.header.airo_ai_link`) }
            >
              <div className="flex items-center justify-center gap-1 md:gap-2">
                <AiroLogo className="relative" design="dark" />
              </div>
            </Link>
            <Tag emphasis="highlight" highcontrast>{t('builder_beta', undefined, 'beta')}</Tag>
          </div>
          <Box orientation="horizontal" className={isMobile ? 'gap-1 ml-2' : 'gap-2'}>
            {actions && actions}
            <Box orientation="horizontal" className={isMobile ? 'gap-0.5' : 'gap-1'}>
              {showAuthenticatedUI && !isDevelopPage && <InviteFriends location={location} />}
              {!isDevelopPage && <DiscordLink location={location} />}
              <UserMenu
                onShowMockLogin={onShowMockLogin}
                location={location}
              />
            </Box>
            {showAuthenticatedUI && (
              <>
                <div className="h-3 w-px bg-ai-dark self-center" />
                <div className="flex items-center gap-1 sm:gap-1">
                  <AppSelector location={location} />
                  <HeaderUpgradeButton location={location} />
                  <AppPublish location={location} />
                </div>
              </>
            )}
          </Box>
        </div>
      </div>
    </header>
  )
}
