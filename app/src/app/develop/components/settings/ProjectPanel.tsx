'use client'

import Box from '@ux/box'
import Button from '@ux/button'
import DownloadIcon from '@ux/icon/download'
import Spinner from '@ux/spinner'

import { useAppIdFromParams } from '@/app/develop/components/utils'
import BigCard from '@/components/layout/BigCard'
import { useDownloadApp } from '@/hooks/useDownloadApp'
import { usePaywallModal } from '@/hooks/usePaywallModal'
import { useTranslations } from '@/hooks/useTranslations'
import { generateClickEID, logAiroHQEvent } from '@/utils/instrumentation'

export default function ProjectPanel() {
  const t = useTranslations()
  const appId = useAppIdFromParams()
  const { download, isDownloading } = useDownloadApp(appId)

  // Use shared paywall modal hook
  const { checkAndShowPaywall, PaywallModal, isPolling, isPaywallLoading } = usePaywallModal({
    appId,
    source: 'download',
    onPurchaseSuccess: async () => {
      // Trigger download after successful purchase
      try {
        await download()
      } catch (error) {
        // Error already logged in hook
      }
    },
  })

  const handleDownload = async () => {
    if (!appId) {return}

    // Log download button click event
    logAiroHQEvent({
      category: 'click',
      recommendation_task: 'builder_project_downloaded',
      recommendation_type: 'download',
      recommendation_id: appId,
    })()

    await checkAndShowPaywall(async () => {
      try {
        await download()
      } catch (error) {
        // Error already logged in hook
      }
    })
  }

  return (
    <>
      <PaywallModal />
      <Box gap='lg' className='@container'>
        <BigCard
          title={t('builder_settings_project_download_title', void 0, 'Download Application')}
          hideStatus
          button={
            <Button
              onClick={handleDownload}
              disabled={isDownloading || isPolling || isPaywallLoading || !appId}
              design='primary'
              size='md'
              data-eid={generateClickEID('settings.project.app_download')}
              icon={isDownloading || isPolling ? <Spinner size='sm' /> : <DownloadIcon />}
              text={isDownloading || isPolling
                ? t('builder_settings_project_download_downloading')
                : t('builder_settings_project_download_button')
              }
            />
          }
          description={t('builder_settings_project_download_desc', void 0, 'Download all your application files as a ZIP archive')}
        >
        </BigCard>
      </Box>
    </>
  )
}
