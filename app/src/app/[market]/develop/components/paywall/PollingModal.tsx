'use client'

import MessageOverlay from '@ux/message-overlay'
import Spinner from '@ux/spinner'
import text from '@ux/text'

import { useTranslations } from '@/hooks/useTranslations'

interface PollingModalProps {
  textKey: string
}

export function PollingModal({ textKey }: PollingModalProps) {
  const t = useTranslations()

  return (
    <MessageOverlay show strategy="fixed">
      <div className="flex flex-col items-center justify-center gap-4 p-8">
        <Spinner data-partial="componentAiro" size="lg" />
        <text.strong as="title" size={1}>
          {t(textKey)}
        </text.strong>
      </div>
    </MessageOverlay>
  )
}
