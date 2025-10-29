import Link from 'next/link'
import clsx from 'clsx'
import { UserMenu } from '@/components/auth'
import SiteSelector from '@/components/layout/SiteSelector'
import { generateClickEID } from '@/utils/instrumentation'
import { HeaderProps } from './types'
import ChevronLeftIcon from '@ux/icon/chevron-left';
import Image from 'next/image';
import Box from '@ux/box'
import Tag from '@ux/tag';

export default function Header({ actions, onShowMockLogin, location = 'unknown' }: HeaderProps) {
  return (
    <header className={clsx(
      "text-intents-ux-boxHighContrast-foregroundColor",
      {
        "header-bg bg-intents-ux-boxHighContrast-backgroundColor": location !== 'homepage',
      }
    )}>
      <div className="mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          <div className="flex items-center space-x-3">
            <Link
              href="https://airo.ai"
              className="flex items-center"
              data-eid={ generateClickEID(`${location}.header.airo_ai_link`) }
            >
              <div className="flex items-center justify-center gap-4">
                <ChevronLeftIcon />
                <Image src="/airo.svg" alt="GoDaddy Airo" width={58} height={24} className="-top-0.5 relative" />
              </div>
            </Link>
            <Tag emphasis="info">Beta</Tag>
          </div>
          <Box orientation="horizontal" gap="md">
            {actions && actions}
            <SiteSelector location={location} />
            <UserMenu
              onShowMockLogin={onShowMockLogin}
              location={location}
            />
          </Box>
        </div>
      </div>
    </header>
  )
}
