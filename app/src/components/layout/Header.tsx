'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import Notifications from '@site/notifications';
import Box from '@ux/box';
import Tag from '@ux/tag';

import { AiroLogo } from '@/components/layout/AiroLogo';
import AppPublish from '@/components/layout/AppPublish';
import AppSelector from '@/components/layout/AppSelector';
import DiscordLink from '@/components/layout/DiscordLink';
import GoDaddyLink from '@/components/layout/GoDaddyLink';
import HeaderUpgradeButton from '@/components/layout/HeaderUpgradeButton';
import IframeCloseButton from '@/components/layout/IframeCloseButton';
import InviteFriends from '@/components/layout/InviteFriends';
import { HeaderProps } from '@/components/layout/types';
import UserMenu from '@/components/layout/UserMenu';
import { useAuthContext } from '@/components/providers/AuthProvider';
import { useTranslations } from '@/hooks/useTranslations';
import { isBuilderPagePath } from '@/lib/builder-route';
import { generateClickEID } from '@/utils/instrumentation';

const BELL_APP_KEYS: Record<string, string | undefined> = {
  homepage: 'airoAppBuilderLanding',
  sites: 'airoAppBuilderSites',
};

export default function Header({ actions, onShowMockLogin, location = 'unknown', className }: HeaderProps) {
  const t = useTranslations();
  const { isAuthenticated, isLoading } = useAuthContext();
  const pathname = usePathname();
  const isDevelopPage = isBuilderPagePath(pathname);

  // Only show authenticated UI components when auth is confirmed (not loading) and user is authenticated
  // This prevents authenticated API calls from being made
  const showAuthenticatedUI = !isLoading && isAuthenticated;
  const isHomepage = location === 'homepage';
  const isMarketingPage = isHomepage || location.startsWith('landing');
  const godaddyUrl = 'https://www.godaddy.com';
  const bellAppKey = BELL_APP_KEYS[location];
  return (
    <header data-testid="airo-header" className={clsx(
      "text-intents-ux-boxHighContrast-foregroundColor",
      {
        "bg-gradient bg-intents-ux-boxHighContrast-backgroundColor": location !== 'homepage' && !location.startsWith('landing'),
      },
      className
    )}>
      <div className="mx-auto px-2 sm:px-3 lg:px-4">
        <div className="flex justify-between items-center h-8">
          <div className="flex items-center space-x-1.5" data-partial="componentAiro">
            {isMarketingPage && (
              <GoDaddyLink location={location} className="mr-2" />
            )}
            <Link
              href={isHomepage ? godaddyUrl : '/'}
              className="flex items-center"
              data-eid={ generateClickEID(`${location}.header.airo_ai_link`) }
            >
              <div className="flex items-center justify-center gap-1 md:gap-2">
                <AiroLogo className="relative" design="dark" />
              </div>
            </Link>
            <Tag emphasis="highlight" highcontrast>{t('builder_beta')}</Tag>
          </div>
          <Box orientation="horizontal" className="gap-1 ml-2 sm:gap-2 sm:ml-0">
            {actions && actions}
            <Box orientation="horizontal" inlineAlignChildren="center" className="gap-0.5 sm:gap-1">
              {showAuthenticatedUI && !isDevelopPage && <InviteFriends location={location} />}
              {!isDevelopPage && <DiscordLink location={location} />}
              {showAuthenticatedUI && bellAppKey && (
                <Notifications id={`site-notifications-${location}`} appKey={bellAppKey} />
              )}
              <UserMenu
                onShowMockLogin={onShowMockLogin}
                location={location}
              />
              <IframeCloseButton location={location} />
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
