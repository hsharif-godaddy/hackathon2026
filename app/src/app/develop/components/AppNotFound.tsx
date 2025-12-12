'use client'

import { useRouter } from 'next/navigation'
import Box from '@ux/box'
import Button from '@ux/button'
import text from '@ux/text'
import AlertIcon from '@ux/icon/alert'
import { useTranslations } from '@/hooks/useTranslations'
import { generateClickEID } from '@/utils/instrumentation'

export default function AppNotFound() {
  const router = useRouter()
  const t = useTranslations()

  return (
    <Box
      className="flex-1 px-6 max-w-lg mx-auto text-center"
      gap="md"
      inlineAlignChildren="center"
      blockAlignChildren="center"
    >
      <AlertIcon className="size-12 text-intents-ux-text-destructive" aria-hidden="true" />

      <Box gap="md">
        <text.h1 as="heading" size={1}>
          {t('builder_app_not_found_title')}
        </text.h1>

        <text.p size={1} emphasis="passive">
          {t('builder_app_not_found_message')}
        </text.p>
      </Box>

      <Box orientation="horizontal" gap="md" className="mt-2">
        <Button
          design="secondary"
          onClick={() => router.push('/')}
          data-eid={generateClickEID('app_not_found.home_button')}
          text={t('builder_app_not_found_home_button')}
        />

        <Button
          design="primary"
          onClick={() => router.push('/apps')}
          data-eid={generateClickEID('app_not_found.apps_button')}
          text={t('builder_app_not_found_apps_button')}
        />
      </Box>
    </Box>
  )
}

