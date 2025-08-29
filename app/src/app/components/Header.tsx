import Link from 'next/link'
import Image from 'next/image'
import { UserMenu, SignOutButton, SignInButton } from '@/components/auth'
import { HeaderProps } from './types'

export default function Header({ onStartBuilding, promptText, isLoading }: HeaderProps) {
  return (
    <header className="border-b border-gray-100 bg-white/80 backdrop-blur-sm">
      <div className="mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          <div className="flex items-center space-x-3">
            <div className="w-64 h-64 flex items-center justify-center">
              <Image src="/logo.svg" alt="Airo Logo" width={140} height={140} />
            </div>
          </div>
          <div className="flex items-center space-x-8">
            <UserMenu />
            <Link href="/apps" className="text-gray-600 hover:text-gray-900 transition-colors">
              My Apps
            </Link>
            <button
              onClick={onStartBuilding}
              disabled={!promptText.trim() || isLoading}
              className="bg-gradient-to-r from-purple-600 to-blue-600 text-white px-4 py-2 rounded-lg hover:from-purple-700 hover:to-blue-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
            >
              {isLoading ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                  <span>Creating...</span>
                </>
              ) : (
                <span>Get Started</span>
              )}
            </button>
            <SignInButton />
            <SignOutButton />
          </div>
        </div>
      </div>
    </header>
  )
}
