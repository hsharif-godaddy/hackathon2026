'use client';

import Link from 'next/link'
import clsx from 'clsx'
import Box from '@ux/box'
import Tag from '@ux/tag';
import ChevronLeftIcon from '@ux/icon/chevron-left';
import { UserMenu } from '@/components/auth'
import { useAuthContext } from '@/components/providers/AuthProvider'
import AppSelector from '@/components/layout/AppSelector'
import AppPublish from '@/components/layout/AppPublish'
import { useIsMobile } from '@/hooks/use-mobile'
import { generateClickEID } from '@/utils/instrumentation'
import { HeaderProps } from './types'
import { AiroLogo } from './AiroLogo';
import { useTranslations } from '@/hooks/useTranslations';

export default function Header({ actions, onShowMockLogin, location = 'unknown' }: HeaderProps) {
  const t = useTranslations();
  const { isAuthenticated, isAuthDisabled } = useAuthContext();
  const showAuthenticatedUI = isAuthenticated || isAuthDisabled;
  const isMobile = useIsMobile();

  return (
    <header className={clsx(
      "text-intents-ux-boxHighContrast-foregroundColor",
      {
        "header-bg bg-intents-ux-boxHighContrast-backgroundColor": location !== 'homepage',
      }
    )}>
      <div className="mx-auto px-2 sm:px-3 lg:px-4">
        <div className="flex justify-between items-center h-8">
          <div className="flex items-center space-x-1.5" data-partial="componentAiro">
            <Link
              href="https://airo.ai"
              className="flex items-center"
              data-eid={ generateClickEID(`${location}.header.airo_ai_link`) }
            >
              <div className="flex items-center justify-center gap-1 md:gap-2">
                <AiroLogo className="relative" design="dark" />
              </div>
            </Link>
            <Tag emphasis="highlight" highcontrast>{t('builder_beta', undefined, 'beta')}</Tag>
          </div>
          <Box orientation="horizontal" gap={isMobile ? 'md' : 'lg'}>
            {actions && actions}
            <UserMenu
              onShowMockLogin={onShowMockLogin}
              location={location}
            />
            { showAuthenticatedUI && <div className="h-3 w-px bg-ai-dark self-center" /> }
            <AppSelector location={location} />
            <AppPublish location={location} />
          </Box>
        </div>
      </div>
    </header>
  )
}
