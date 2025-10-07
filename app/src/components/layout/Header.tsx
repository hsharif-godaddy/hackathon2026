import Image from 'next/image'
import Link from 'next/link'
import clsx from 'clsx'
import Box from '@ux/box'
import { UserMenu } from '@/components/auth'
import SiteSelector from '@/components/layout/SiteSelector'
import { generateClickEID } from '@/utils/instrumentation'
import { HeaderProps } from './types'

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
              href="/"
              className="flex items-center"
              data-eid={ generateClickEID(`${location}.header.logo`) }
            >
              <div className="flex items-center justify-center">
                <Image src="/airo.svg" alt="GoDaddy Airo" width={58} height={24} />
              </div>
            </Link>
          </div>
          <Box orientation="horizontal" gap="md">
            {actions && actions}
            <SiteSelector />
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
