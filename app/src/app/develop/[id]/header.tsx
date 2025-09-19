'use client'

import Link from 'next/link'
import Image from 'next/image'
import { useRef, useImperativeHandle, forwardRef } from 'react'
import { useParams } from 'next/navigation'
import TokenUsage, { TokenUsageRef } from '@/app/develop/components/TokenUsage'
import { UserMenu } from '@/components/auth'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
import { useServerPollingStore } from '@/stores/useServerPollingStore'
import { isFeatureEnabled } from '@/lib/features'
import Box from '@ux/box'
import Button from '@ux/button'
import Tag from '@ux/tag'
import { text } from '@ux/text'
import ComputerDesktopIcon from '@ux/icon/desktop'
import DevicePhoneMobileIcon from '@ux/icon/mobile-phone'
import ArrowTopRightOnSquareIcon from '@ux/icon/window-new'
import RefreshIcon from '@ux/icon/refresh'
import { generateClickEID } from '@/utils/instrumentation'

interface HeaderProps {
  app: { name?: string; port?: number } | null // App data from page state
  showUsageCost: boolean
  onPreviewRefresh: () => void
  onRestartServer: () => void
}

export interface HeaderRef {
  refreshTokenUsage: () => void
}

const Header = forwardRef<HeaderRef, HeaderProps>(function Header({
  app,
  showUsageCost,
  onPreviewRefresh,
  onRestartServer
}, ref) {
  const params = useParams()
  const appId = params.id as string
  const tokenUsageRef = useRef<TokenUsageRef>(null)
  
  // Expose refresh functionality to parent
  useImperativeHandle(ref, () => ({
    refreshTokenUsage: () => {
      tokenUsageRef.current?.refreshUsage()
    }
  }), [])
  
  // Get state from stores
  const {
    viewMode,
    previewViewMode,
    hasUnsavedChanges,
    isCheckingApp,
    isStartingApp,
    isRestarting,
    handleViewModeChange,
    setPreviewViewMode
  } = useDevelopPageStore()
  
  // Get real-time server status
  const { getServerState } = useServerPollingStore()
  
  const serverState = getServerState(appId)
  const actualPort = serverState?.port
  const serverUrl = serverState?.url
  
  return (
    <header className="border-b">
      <div className="mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-12">
          <div className="flex items-center space-x-4">
            <Link 
              href="/" 
              className="flex items-center space-x-3"
              data-eid={ generateClickEID('develop.header.logo') }
            >
              <Image src="/logo.svg" alt="Airo Logo" width={128} height={48} />
            </Link>
            <div className="h-6 w-px bg-intents-ux-boxLowContrast-borderColor" />
            <div className="flex items-center space-x-2">
              <text.strong 
                size={ -1 }
                text={ app ? app.name : `App ${appId}` }
              />
              {isCheckingApp && (
                <Tag emphasis="info" size="sm">
                  Checking App Status...
                </Tag>
              )}
              {isStartingApp && !isCheckingApp && (
                <Tag emphasis="warning" size="sm">
                  Starting App...
                </Tag>
              )}
              {isRestarting && !isCheckingApp && !isStartingApp && (
                <Tag emphasis="warning" size="sm">
                  Restarting App...
                </Tag>
              )}
            </div>
          </div>
          <div className="flex items-center space-x-4">
            {/* View Mode Toggle Buttons */}
            <Box orientation="horizontal" gap="sm">
              <Button 
                onClick={() => handleViewModeChange('preview', hasUnsavedChanges)}
                size="sm"
                design="control"
                active={viewMode === 'preview'}
                text="Preview"
                data-eid={ generateClickEID('develop.header.preview') }
              />
              {/* Code Editor Button - Feature Flag Controlled */}
              {isFeatureEnabled.codeEditor() && (
                <div className="relative">
                  <Button 
                    onClick={() => handleViewModeChange('code', hasUnsavedChanges)}
                    size="sm"
                    design="control"
                    active={viewMode === 'code'}
                    text="Code"
                  data-eid={ generateClickEID('develop.header.code') }
                  />
                  {hasUnsavedChanges && viewMode === 'code' && (
                    <div className="absolute -top-1 -right-1">
                      <Tag emphasis="warning" size="sm">
                        Unsaved changes
                      </Tag>
                    </div>
                  )}
                </div>
              )}
            </Box>

            {/* Preview controls when in preview mode */}
            {viewMode === 'preview' && (
              <div className="flex items-center space-x-3">
                {/* View Mode Toggles */}
                <Box orientation="horizontal" gap="sm" className="border rounded-md p-1">
                    <Button
                      onClick={() => setPreviewViewMode('desktop')}
                      data-eid={ generateClickEID('develop.header.preview_desktop_mode') }
                      size="sm"
                      design="control"
                      active={previewViewMode === 'desktop'}
                      className="p-1!"
                      aria-label="Desktop view"
                      icon={<ComputerDesktopIcon className="w-3 h-3" />}
                    />
                    <Button
                      onClick={() => setPreviewViewMode('mobile')}
                      data-eid={ generateClickEID('develop.header.preview_mobile_mode') }
                      size="sm"
                      design="control"
                      active={previewViewMode === 'mobile'}
                      className="p-1!"
                      aria-label="Mobile view"
                      icon={<DevicePhoneMobileIcon className="w-3 h-3" />}
                    />
                </Box>
                
                {/* App Control Buttons */}
                <div className="flex items-center space-x-1">
                  <Button
                    onClick={onPreviewRefresh}
                    data-eid={ generateClickEID('develop.header.refresh') }
                    title="Reload preview (refresh page content)"
                    aria-label="Reload preview"
                    icon={<RefreshIcon className="w-4! h-4!" />}
                    size="sm"
                    design="stateless"
                  />
                  
                  <Button 
                    onClick={onRestartServer}
                    data-eid={ generateClickEID('develop.header.restart') }
                    disabled={isRestarting}
                    className="p-1 hover:bg-orange-50 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Restart server (rebuild and restart development server)"
                    aria-label="Restart server"
                    icon={<RefreshIcon className={`w-4! h-4! text-intents-ux-feedbackHighContrastCritical-feedbackColor ${isRestarting && 'animate-reverse-spin'}`} />}
                    size="sm"
                    design="stateless"
                  />
                  
                  <Button 
                    onClick={() => {
                      if (serverUrl) {
                        window.open(serverUrl, '_blank')
                      } else if (actualPort) {
                        window.open(`http://localhost:${actualPort}`, '_blank')
                      }
                    }}
                    data-eid={ generateClickEID('develop.header.preview_new_tab') }
                    disabled={!actualPort || isCheckingApp || isRestarting || isStartingApp}
                    title="Open app in new tab"
                    aria-label="Open app in new tab"
                    icon={<ArrowTopRightOnSquareIcon className="w-4! h-4! text-intents-ux-feedbackHighContrastSuccess-feedbackColor" />}
                    size="sm"
                    design="stateless"
                  />
                </div>
              </div>
            )}
            
            {appId && (
              <TokenUsage ref={tokenUsageRef} appId={appId} enabled={showUsageCost} />
            )}
            <Box orientation="horizontal" gap="sm">
              <Button
                href="/sites"
                design="primary"
                data-partial="componentAiro"
                text="My Sites"
                data-eid={ generateClickEID('develop.header.my_sites') }
              />
              <UserMenu location="develop" />
            </Box>
          </div>
        </div>
      </div>
    </header>
  )
})

export default Header
