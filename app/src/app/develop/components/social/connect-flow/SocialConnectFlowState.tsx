'use client'

import { memo } from 'react'
import Button from '@ux/button'
import text from '@ux/text'

import { useTranslations } from '@/hooks/useTranslations'

export enum FlowStateType {
  Loading = 'loading',
  Success = 'success',
  Error = 'error'
}

interface SocialConnectFlowStateProps {
  type: FlowStateType
  message?: string
  errorMessage?: string
  onRetry?: () => void
}

export const SocialConnectFlowState = memo(function SocialConnectFlowState({
  type,
  message,
  errorMessage,
  onRetry
}: SocialConnectFlowStateProps) {
  const t = useTranslations()

  if (type === FlowStateType.Loading) {
    return (
      <div className="flex items-center gap-1.5">
        <text.p size={-2} text={message || t('builder_common_loading')} />
      </div>
    )
  }

  if (type === FlowStateType.Success) {
    return (
      <div className="flex items-center gap-1 text-intents-ux-feedbackHighContrastSuccess-feedbackColor">
        <text.p size={-2} text={message || t('builder_social_connected_successfully')} />
      </div>
    )
  }

  if (type === FlowStateType.Error) {
    return (
      <div className="space-y-1">
        <div className="flex items-center gap-1 text-intents-ux-error-textColor">
          <text.p size={-2} text={errorMessage || t('builder_social_connection_failed')} />
        </div>
        {onRetry && <Button design="secondary" size="sm" onClick={onRetry} text={t('builder_common_try_again')} />}
      </div>
    )
  }

  return null
})
