'use client'

import type { CSSProperties } from 'react'
import { SecretsForm } from '@airo-ux/pattern-library/input/secrets-form'

import { secretsComposerSaveLabel } from '@/app/[market]/develop/components/chat/secrets/secretsComposerLabels'
import SecretsPaginatedPanelRenderer from '@/app/[market]/develop/components/chat/secrets/SecretsPaginatedPanelRenderer'
import { secretsPanelTitle } from '@/app/[market]/develop/components/chat/secrets/secretsPanelTitle'
import type { ActiveSecretsRequest } from '@/app/[market]/develop/components/chat/secrets/types'
import { useSecretsRequestActions } from '@/app/[market]/develop/components/chat/secrets/useSecretsRequestActions'
import type {
  SecretDefinition,
  SecretsRequestPayload,
} from '@/app/[market]/develop/components/ChatSecretsRequestMessage'
import { useTranslations } from '@/hooks/useTranslations'

export type SecretsPanelSurfaceVariant = 'composer' | 'panel'

export interface SecretsPanelContentProps {
  request: ActiveSecretsRequest
  conversationId?: string
  onComplete?: () => void
  /** `composer` replaces the chat PromptBox; `panel` nests in Continue Building. */
  surfaceVariant?: SecretsPanelSurfaceVariant
}

function helperTextFor(
  payload: SecretsRequestPayload,
  secret: SecretDefinition,
  t: ReturnType<typeof useTranslations>,
): string | undefined {
  const parts: string[] = []

  if (typeof secret.description === 'string' && secret.description.trim() !== '') {
    parts.push(secret.description.trim())
  } else if (typeof payload.description === 'string' && payload.description.trim() !== '') {
    parts.push(payload.description.trim())
  }

  if (payload.showSettingsLink !== false) {
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

export default function SecretsPanelContent({
  request,
  conversationId,
  onComplete,
  surfaceVariant = 'panel',
}: SecretsPanelContentProps) {
  const t = useTranslations()
  const { cancel, isClosePending, isPending, submitOne } = useSecretsRequestActions(request, conversationId)
  const isComposer = surfaceVariant === 'composer'

  if (request.displayMode === 'paginated') {
    return (
      <div className="w-full max-w-full min-w-0">
        <SecretsPaginatedPanelRenderer
          conversationId={conversationId}
          headerEyebrow={isComposer ? secretsPanelTitle(request.payload) : undefined}
          hideStepTitle
          onComplete={onComplete}
          request={request}
          showHeaderClose={isComposer}
        />
      </div>
    )
  }

  const secret = request.payload.secrets[0]
  const sharedFormProps = {
    key: request.secretKey,
    borderless: isComposer,
    eyebrow: isComposer ? secretsPanelTitle(request.payload) : request.payload.title,
    helperText: helperTextFor(request.payload, secret, t),
    label: `${secret.name}:`,
    closeLabel: t('builder_common_close'),
    onClose: cancel,
    onSubmit: submitOne,
    pending: isPending,
    closePending: isClosePending,
    submitLabel: secretsComposerSaveLabel(t),
  }

  return (
    <div
      className="w-full max-w-full min-w-0"
      style={
        {
          '--airo-input-secrets-form-max-width': 'min(100%, 44rem)',
        } as CSSProperties
      }
    >
      {isComposer ? (
        <SecretsForm {...sharedFormProps} className="airo-input-secrets-form--takeover" variant="composer" />
      ) : (
        <SecretsForm {...sharedFormProps} variant="conversation" />
      )}
    </div>
  )
}
