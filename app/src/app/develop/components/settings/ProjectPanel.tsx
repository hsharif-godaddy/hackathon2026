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
  const { download, isDownloading } = useDownloadApp()

  // Use shared paywall modal hook
  const { checkAndShowPaywall, PaywallModal, isPolling, isPaywallLoading } = usePaywallModal({
    appId,
    source: 'download',
    onPurchaseSuccess: async () => {
      // Trigger download after successful purchase
      if (appId) {
        try {
          await download(appId)
        } catch (err) {
          // Error already logged in hook
        }
      }
    },
  })

  const handleDownload = async () => {
    if (!appId) return

    // Log download button click event
    logAiroHQEvent({
      category: 'click',
      recommendation_task: 'builder_project_downloaded',
      recommendation_type: 'download',
      recommendation_id: appId,
    })()

    await checkAndShowPaywall(async () => {
      try {
        await download(appId)
      } catch (err) {
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
        description={t('builder_settings_project_download_desc', void 0, 'Download all your application files as a ZIP archive')}
      >
        <Button
          onClick={handleDownload}
          disabled={isDownloading || isPolling || isPaywallLoading || !appId}
          design='primary'
          size='md'
          data-eid={generateClickEID('settings.project.app_download')}
        >
          <Box orientation='horizontal' gap='sm'>
            {(isDownloading || isPolling) ? <Spinner size='sm' /> : <DownloadIcon />}
            {isDownloading || isPolling
              ? t('builder_settings_project_download_downloading', void 0, 'Downloading...')
              : t('builder_settings_project_download_button', void 0, 'Download Files')
            }
          </Box>
        </Button>
      </BigCard>
    </Box>
    </>
  )
}
