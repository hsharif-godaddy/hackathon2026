'use client'

import { useEffect,useMemo, useState } from 'react'
import Modal from '@ux/modal'

import { FlowStep } from '@/hooks/social/connect-flow/useSocialConnectFlowStateMachine'
import { useSocialConnections } from '@/hooks/useSocial'
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
}

export function SocialConnectModal({
  platform,
  appId,
  isOpen,
  onClose,
  onSuccess,
  selectedConnectionId,
  oauthState
}: SocialConnectModalProps) {
  const t = useTranslations()
  const connectionsQuery = useSocialConnections()
  const connections = useMemo(() => connectionsQuery.data ?? [], [connectionsQuery.data])

  const [mountKey, setMountKey] = useState(() => Date.now())

  useEffect(() => {
    if (isOpen) {
      setMountKey(Date.now())
    }
  }, [isOpen, platform])

  const platformEnumKey = useMemo(() => {
    return PLATFORM_TRANSFORMS.toApiEnum(platform)
  }, [platform])

  const selectedConnection = useMemo(() => {
    if (!selectedConnectionId) return undefined
    return connections.find(c => c.socialId === selectedConnectionId)
  }, [selectedConnectionId, connections])

  const platformConnections = useMemo(() => {
    return connections.filter(c => c.platform === platformEnumKey)
  }, [connections, platformEnumKey])

  const initialUserTokenId = selectedConnection?.userTokenId
  const initialStep = selectedConnectionId
    ? FlowStep.ValidatingPermissions
    : (platformConnections.length > 0 ? FlowStep.SelectExisting : FlowStep.Auth)

  const platformName = PLATFORM_TRANSFORMS.toDisplayName(platform)
  const title = t('builder_social_connecting_platform', { platformName })

  if (!isOpen) return null

  return (
    <Modal title={title} onClose={onClose}>
      <div className="w-full w-[400px] md:w-[500px] lg:w-[600px]">
        <SocialConnectFlow
          key={mountKey}
          platform={platform}
          appId={appId}
          state={oauthState}
          initialStep={initialStep}
          initialUserTokenId={initialUserTokenId}
          disableAutoOpen
          onSuccess={onSuccess}
        />
      </div>
    </Modal>
  )
}
