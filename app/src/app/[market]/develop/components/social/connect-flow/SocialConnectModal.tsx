'use client'

import { useEffect, useState } from 'react'
import Modal from '@ux/modal'

import { FlowStep } from '@/hooks/social/connect-flow/useSocialConnectFlowStateMachine'
import { useTranslations } from '@/hooks/useTranslations'
import { PLATFORM_TRANSFORMS } from '@/lib/social-platforms'
import SocialConnectFlow from './SocialConnectFlow'

interface SocialConnectModalProps {
  platform: string
  appId: string
  isOpen: boolean
  onClose: () => void
  onSuccess?: () => void
  selectedConnectionId?: string
  oauthState: string
  onOpenSocialFlowsConnect?: () => void
}

export function SocialConnectModal({
  platform,
  appId,
  isOpen,
  onClose,
  onSuccess,
  selectedConnectionId,
  oauthState,
  onOpenSocialFlowsConnect,
}: SocialConnectModalProps) {
  const t = useTranslations()

  const [mountKey, setMountKey] = useState(() => Date.now())

  useEffect(() => {
    if (isOpen) {
      setMountKey(Date.now())
    }
  }, [isOpen, platform])

  // Let the flow determine whether to show SelectExisting or Auth based on available connections
  const initialStep = selectedConnectionId ? FlowStep.ValidatingPermissions : undefined
  const initialUserTokenId = selectedConnectionId

  const platformName = PLATFORM_TRANSFORMS.toDisplayName(platform)
  const title = t('builder_social_connecting_platform', { platformName })

  if (!isOpen) return null

  return (
    <Modal title={title} onClose={onClose}>
      <div className="max-w-full w-[400px] md:w-[500px] lg:w-[600px]">
        <SocialConnectFlow
          key={mountKey}
          platform={platform}
          appId={appId}
          state={oauthState}
          initialStep={initialStep}
          initialUserTokenId={initialUserTokenId}
          autoOpen={false}
          isActive={true}
          onSuccess={onSuccess}
          onClose={onClose}
          onOpenSocialFlowsConnect={onOpenSocialFlowsConnect}
        />
      </div>
    </Modal>
  )
}
