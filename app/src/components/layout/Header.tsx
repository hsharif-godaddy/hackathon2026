import Image from 'next/image'
import Link from 'next/link'
import { UserMenu } from '@/components/auth'
import { HeaderProps } from './types'
import Box from '@ux/box'
import { generateClickEID } from '@/utils/instrumentation'

export default function Header({ actions, className = "", onShowMockLogin, location = 'unknown' }: HeaderProps) {
  return (
    <header className={`border-b border-gray-100 bg-white/80 backdrop-blur-sm ${className}`}>
      <div className="mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          <div className="flex items-center space-x-3">
            <Link 
              href="/" 
              className="flex items-center" 
              data-eid={ generateClickEID(`${location}.header.logo`) }
            >
              <div className="flex items-center justify-center">
                <Image src="/logo.svg" alt="Airo Logo" width={140} height={140} />
              </div>
            </Link>
          </div>
          <Box orientation="horizontal" gap="md">
            {actions && actions}
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
