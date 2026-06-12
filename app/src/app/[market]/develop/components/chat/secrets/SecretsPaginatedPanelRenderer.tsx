'use client'

import { useEffect, useMemo, useState } from 'react'
import { SecretsPaginatedForm } from '@airo-ux/pattern-library/input/secrets-form'

import {
  secretsComposerContinueLabel,
  secretsComposerSaveLabel,
} from '@/app/[market]/develop/components/chat/secrets/secretsComposerLabels'
import type { ActiveSecretsRequest } from '@/app/[market]/develop/components/chat/secrets/types'
import { useSecretsRequestActions } from '@/app/[market]/develop/components/chat/secrets/useSecretsRequestActions'
import type {
  SecretDefinition,
  SecretsRequestPayload,
} from '@/app/[market]/develop/components/ChatSecretsRequestMessage'
import { useTranslations } from '@/hooks/useTranslations'

export interface SecretsPaginatedPanelRendererProps {
  request: ActiveSecretsRequest
  conversationId?: string
  hideStepTitle?: boolean
  headerEyebrow?: string
  onComplete?: () => void
  showHeaderClose?: boolean
}

function helperTextFor(
  payload: SecretsRequestPayload,
  secret: SecretDefinition,
  t: ReturnType<typeof useTranslations>,
  includeSettingsLink: boolean,
): string | undefined {
  const parts: string[] = []

  if (typeof secret.description === 'string' && secret.description.trim() !== '') {
    parts.push(secret.description.trim())
  } else if (typeof payload.description === 'string' && payload.description.trim() !== '') {
    parts.push(payload.description.trim())
  }

  if (includeSettingsLink && payload.showSettingsLink !== false) {
    parts.push(
      t(
        'builder_secrets_thread_notice',
        undefined,
        'You can also manage this from secrets settings',
      ),
    )
  }

  return parts.length > 0 ? parts.join(' ') : undefined
}

export default function SecretsPaginatedPanelRenderer({
  request,
  conversationId,
  hideStepTitle = true,
  headerEyebrow,
  onComplete,
  showHeaderClose = false,
}: SecretsPaginatedPanelRendererProps) {
  const t = useTranslations()
  const secrets = request.payload.secrets
  const { cancel, isClosePending, isPending, submitMulti } = useSecretsRequestActions(request, conversationId)
  const [submitted, setSubmitted] = useState(false)

  useEffect(() => {
    setSubmitted(false)
  }, [request.secretKey])

  const steps = useMemo(
    () =>
      secrets.map((secret, index) => ({
        helperText: helperTextFor(
          request.payload,
          secret,
          t,
          index === secrets.length - 1,
        ),
        id: secret.name,
        label: `${secret.name}:`,
        placeholder: 'Enter value',
        required: secret.required !== false,
        title: secret.name,
      })),
    [request.payload, secrets, t],
  )

  if (submitted) {
    return null
  }

  return (
    <SecretsPaginatedForm
      backLabel={t('builder_common_back')}
      cancelLabel={t('builder_common_cancel')}
      className="airo-input-secrets-paginated-form--flat-sections"
      closeLabel={t('builder_common_close')}
      continueLabel={secretsComposerContinueLabel(t)}
      forwardLabel={secretsComposerContinueLabel(t)}
      headerEyebrow={headerEyebrow}
      hideStepTitle={hideStepTitle}
      onClose={cancel}
      showHeaderClose={showHeaderClose}
      onComplete={async (values) => {
        await submitMulti(values)
        setSubmitted(true)
        onComplete?.()
      }}
      closePending={isClosePending}
      pending={isPending}
      saveLabel={secretsComposerSaveLabel(t)}
      stepIndicatorLabel={(current, total) => `${current}/${total}`}
      steps={steps}
    />
  )
}
