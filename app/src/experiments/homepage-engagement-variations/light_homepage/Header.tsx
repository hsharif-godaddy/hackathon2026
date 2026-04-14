'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import Box from '@ux/box';
import ChevronLeftIcon from '@ux/icon/chevron-left';
import Tag from '@ux/tag';

import { AiroLogo } from '@/components/layout/AiroLogo';
import AppPublish from '@/components/layout/AppPublish';
import AppSelector from '@/components/layout/AppSelector';
import HeaderUpgradeButton from '@/components/layout/HeaderUpgradeButton';
import IframeCloseButton from '@/components/layout/IframeCloseButton';
import { HeaderProps } from '@/components/layout/types';
import { useAuthContext } from '@/components/providers/AuthProvider';
import DiscordLink from '@/experiments/homepage-engagement-variations/light_homepage/DiscordLink';
import InviteFriends from '@/experiments/homepage-engagement-variations/light_homepage/InviteFriends';
import UserMenu from '@/experiments/homepage-engagement-variations/light_homepage/UserMenu';
import { useBreakpoints } from '@/hooks/useBreakpoints';
import { useTranslations } from '@/hooks/useTranslations';
import { generateClickEID } from '@/utils/instrumentation';

export default function Header({
  actions,
  onShowMockLogin,
  location = 'unknown',
  className,
}: HeaderProps) {
  const t = useTranslations();
  const { isAuthenticated, isAuthDisabled, isLoading } = useAuthContext();
  const { isBelowSmBreakpoint } = useBreakpoints();
  const pathname = usePathname();
  const isDevelopPage = pathname?.includes('/develop');

  // Only show authenticated UI components when auth is confirmed (not loading) and user is authenticated
  // This prevents authenticated API calls from being made
  const showAuthenticatedUI = !isLoading && (isAuthenticated || isAuthDisabled);

  const isHomepage = location === 'homepage';
  const godaddyUrl = 'https://www.godaddy.com';

  return (
    <header data-testid="airo-header" className={clsx(
      'text-intents-ux-text-textColor',
      {
        "bg-gradient bg-intents-ux-boxHighContrast-backgroundColor": location !== 'homepage' && !location.startsWith('landing'),
      },
      className
    )}>
      <div className="mx-auto px-2 sm:px-3 lg:px-4">
        <div className="flex justify-between items-center h-8">
          <div className="flex items-center space-x-1.5" data-partial="componentAiro">
            {isHomepage && (
              <Link
                href={godaddyUrl}
                className="flex items-center mr-2"
                data-eid={ generateClickEID(`${location}.header.godaddy_link`) }
                aria-label={t('builder_abstract_animation_header_back_to_godaddy')}
              >
                <ChevronLeftIcon className="w-4 h-4" />
              </Link>
            )}
            <Link
              href={isHomepage ? godaddyUrl : '/'}
              className="flex items-center"
              data-eid={ generateClickEID(`${location}.header.airo_ai_link`) }
            >
              <div className="flex items-center justify-center gap-1 md:gap-2">
                <AiroLogo className="relative" design='color' />
              </div>
            </Link>
            <Tag emphasis="highlight" highcontrast>{t('builder_beta', undefined, 'beta')}</Tag>
          </div>
          <Box orientation="horizontal" className={isBelowSmBreakpoint ? 'gap-1 ml-2' : 'gap-2'}>
            {actions && actions}
            <Box orientation="horizontal" className={isBelowSmBreakpoint ? 'gap-0.5' : 'gap-1'}>
              {showAuthenticatedUI && !isDevelopPage && (
                <InviteFriends location={location} />
              )}
              {!isDevelopPage && (
                <DiscordLink location={location} />
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
