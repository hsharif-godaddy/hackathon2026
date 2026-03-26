'use client'

import MessageOverlay from '@ux/message-overlay'
import Spinner from '@ux/spinner'
import text from '@ux/text'

import { useTranslations } from '@/hooks/useTranslations'

/**
 * Message overlay displayed while polling for the subscription status
 * to change from 'suspended' to 'active' after renewal.
 */
export function RenewalPollingModal() {
  const t = useTranslations()

  return (
    <div className="fixed inset-0 z-[50]">
      <MessageOverlay show strategy="fixed">
        <div className="flex flex-col items-center justify-center gap-4 p-8">
          <Spinner data-partial="componentAiro" size="lg" />
          <text.strong as="title" size={1}>
            {t('builder_manageplan_renewal_processing')}
          </text.strong>
        </div>
      </MessageOverlay>
    </div>
  )
}
