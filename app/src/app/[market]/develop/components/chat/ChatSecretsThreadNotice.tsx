'use client'

import type { SecretsRequestPayload } from '@/app/[market]/develop/components/ChatSecretsRequestMessage'
import { useTranslations } from '@/hooks/useTranslations'

export interface ChatSecretsThreadNoticeProps {
  payload: SecretsRequestPayload
  isInteractive: boolean
}

export default function ChatSecretsThreadNotice({ payload, isInteractive }: ChatSecretsThreadNoticeProps) {
  const t = useTranslations()
  const { title, description, showSettingsLink } = payload

  return (
    <div className="max-w-2xl mx-auto my-2">
      <div
        className={`rounded-lg border p-3 ${
          isInteractive
            ? 'border-intents-ux-info-borderColor bg-intents-ux-info-backgroundColor'
            : 'border-intents-ux-info-borderColor/50 bg-intents-ux-info-backgroundColor/50 opacity-60'
        }`}
      >
        <div className="mb-1">
          <h3 className="text-base font-semibold text-typography-highEmphasis mb-0.5">{title}</h3>
          <p className="text-sm text-typography-mediumEmphasis">{description}</p>
        </div>
        {showSettingsLink && (
          <p className="mt-2 text-xs text-typography-lowEmphasis">
            {t('builder_secrets_thread_notice', undefined, 'You can also manage this from secrets settings')}
          </p>
        )}
        {!isInteractive && (
          <p className="mt-3 text-xs text-typography-lowEmphasis">
            {t(
              'builder_secrets_thread_notice_composer_inactive_hint',
              undefined,
              'If you still need this credential, use the secret form at the bottom of the chat when it is shown, or ask here to be prompted again.',
            )}
          </p>
        )}
      </div>
    </div>
  )
}
