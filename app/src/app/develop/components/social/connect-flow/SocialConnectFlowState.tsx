'use client'

import { memo } from 'react'
import Box from '@ux/box'
import Button from '@ux/button'
import Spinner from '@ux/spinner'
import text from '@ux/text'
import TextLockup from '@ux/text-lockup'

import { useTranslations } from '@/hooks/useTranslations'
import { generateClickEID } from '@/utils/instrumentation'

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
  onClose?: () => void
}

export const SocialConnectFlowState = memo(function SocialConnectFlowState({
  type,
  message,
  errorMessage,
  onRetry,
  onClose
}: SocialConnectFlowStateProps) {
  const t = useTranslations()

  if (type === FlowStateType.Loading) {
    return (
      <Box
        elevation="card"
        blockAlignChildren="center"
        inlineAlignChildren="center"
        blockPadding="lg"
        inlinePadding="lg"
        gap="sm"
      >
        <Spinner size="md" />
        <text.p as="label" text={message || t('builder_common_loading')} />
      </Box>
    )
  }

  if (type === FlowStateType.Success) {
    return (
      <>
        <Box elevation="card" blockPadding="md" inlinePadding="md">
          <TextLockup emphasis="success" title={message || t('builder_social_connected_successfully')} size="sm" />
        </Box>
        <Box orientation="horizontal" blockAlignChildren="end" className="mt-5">
          <Button
            design="primary"
            onClick={onClose}
            text={t('builder_common_close')}
            data-eid={generateClickEID('social.connect.done')}
          />
        </Box>
      </>
    )
  }

  if (type === FlowStateType.Error) {
    return (
      <>
        <Box elevation="card" blockPadding="sm" inlinePadding="md">
          <TextLockup emphasis="critical" title={errorMessage || t('builder_social_connection_failed')} size="sm" />
        </Box>
        <Box gap="sm" orientation="horizontal" blockAlignChildren="end" className="mt-5">
          <Button
            design="secondary"
            onClick={onClose}
            text={t('builder_common_cancel')}
            data-eid={generateClickEID('social.connect.cancel')}
          />
          {onRetry &&
            <Button
              design="primary"
              onClick={onRetry}
              text={t('builder_common_try_again')}
              data-eid={generateClickEID('social.connect.retry')}
            />
          }
        </Box>
      </>
    )
  }

  return null
})
