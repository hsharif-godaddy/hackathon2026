'use client'

import { useEffect, useRef, useState } from 'react'
import Alert from '@ux/alert'
import Box from '@ux/box'
import Button from '@ux/button'
import DownloadIcon from '@ux/icon/download'
import RefreshIcon from '@ux/icon/refresh'
import Users3Icon from '@ux/icon/users3';
import Spinner from '@ux/spinner'

import ModelSelector from '@/app/[market]/develop/components/settings/ModelSelector'
import SettingsSection from '@/app/[market]/develop/components/settings/SettingsSection'
import { useAppIdFromParams } from '@/app/[market]/develop/components/utils'
import { useDownloadApp } from '@/hooks/useDownloadApp'
import { usePaywallModal } from '@/hooks/usePaywallModal'
import { PurgeErrorCode, PurgeStatus, usePurgeCache } from '@/hooks/usePurgeCache'
import { useSwitchboard } from '@/hooks/useSwitchboard';
import { useTranslations } from '@/hooks/useTranslations'
import { getRootDomain } from '@/utils/getRootDomain';
import { generateClickEID, logAiroHQEvent } from '@/utils/instrumentation'

const PURGE_ERROR_I18N_KEYS: Record<PurgeErrorCode, string> = {
  [PurgeErrorCode.TIMEOUT]: 'builder_settings_project_purge_cache_error_timeout',
  [PurgeErrorCode.POLL_FAILED]: 'builder_settings_project_purge_cache_error_poll_failed',
  [PurgeErrorCode.JOB_FAILED]: 'builder_settings_project_purge_cache_error',
  [PurgeErrorCode.NETWORK]: 'builder_settings_project_purge_cache_error_network',
  [PurgeErrorCode.TRIGGER_FAILED]: 'builder_settings_project_purge_cache_error_trigger_failed',
}

export default function ProjectPanel() {
  const t = useTranslations()
  const appId = useAppIdFromParams()
  const { download, isDownloading } = useDownloadApp(appId)
  const rootDomain = getRootDomain() || 'godaddy.com';
  const delegationUrl = `https://sso.${rootDomain}/access`;

  const { data: isTeamEnabled } = useSwitchboard('appbuilder-settings-team');
  const { trigger: triggerPurge, status: purgeStatus, errorCode: purgeErrorCode } = usePurgeCache(appId)

  const [purgeToast, setPurgeToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const lastToastStatusRef = useRef<string | null>(null)
  const isPurging = purgeStatus === PurgeStatus.STARTING || purgeStatus === PurgeStatus.POLLING

  useEffect(function showPurgeToast() {
    if (purgeStatus === PurgeStatus.STARTING) {
      lastToastStatusRef.current = null
    }

    if (lastToastStatusRef.current === purgeStatus) return

    if (purgeStatus === PurgeStatus.SUCCESS) {
      lastToastStatusRef.current = purgeStatus
      setPurgeToast({
        type: 'success',
        message: t('builder_settings_project_purge_cache_success', undefined, 'Cache purged successfully'),
      })
    } else if (purgeStatus === PurgeStatus.FAILURE || purgeStatus === PurgeStatus.ERROR) {
      lastToastStatusRef.current = purgeStatus
      const errorKey = purgeErrorCode
        ? PURGE_ERROR_I18N_KEYS[purgeErrorCode]
        : 'builder_settings_project_purge_cache_error'
      setPurgeToast({
        type: 'error',
        message: t(errorKey, undefined, 'Cache purge failed'),
      })
    }
  }, [purgeStatus, purgeErrorCode, t])

  // Use shared paywall modal hook
  const { checkAndShowPaywall, PaywallModal, isPaywallLoading } = usePaywallModal({
    appId,
    source: 'download',
    onPurchaseSuccess: async () => {
      try {
        await download()
      } catch (error) {
        // Error already logged in hook
      }
    },
  })

  const handleDownload = async () => {
    if (!appId) return

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

  const handlePurgeCache = async () => {
    if (!appId) return

    setPurgeToast(null)

    logAiroHQEvent({
      category: 'click',
      recommendation_task: 'builder_project_purge_cache',
      recommendation_type: 'purge_cache',
      recommendation_id: appId,
    })()

    await triggerPurge()
  }

  return (
    <>
      <PaywallModal />
      <Box gap='lg' className='@container'>
        <SettingsSection
          title={t('builder_settings_project_purge_cache_title', undefined, 'Purge Cache')}
          hideStatus
          button={
            <Button
              onClick={handlePurgeCache}
              disabled={isPurging || !appId}
              design='primary'
              size='sm'
              data-eid={generateClickEID('settings.project.purge_cache')}
              icon={isPurging ? <Spinner size='sm' /> : <RefreshIcon />}
              text={isPurging
                ? t('builder_settings_project_purge_cache_purging', undefined, 'Purging...')
                : t('builder_settings_project_purge_cache_title', undefined, 'Purge Cache')
              }
            />
          }
          description={t('builder_settings_project_purge_cache_desc', undefined, 'Clear cached content from the CDN for your published app')}
        >
          {purgeToast && (
            <Alert
              emphasis={purgeToast.type === 'success' ? 'success' : 'critical'}
              onClose={() => setPurgeToast(null)}
            >
              {purgeToast.message}
            </Alert>
          )}
        </SettingsSection>
        <SettingsSection
          title={t('builder_settings_project_download_title', undefined, 'Download Application')}
          hideStatus
          button={
            <Button
              onClick={handleDownload}
              disabled={isDownloading || isPaywallLoading || !appId}
              design='primary'
              size='sm'
              data-eid={generateClickEID('settings.project.app_download')}
              icon={isDownloading ? <Spinner size='sm' /> : <DownloadIcon />}
              text={isDownloading
                ? t('builder_settings_project_download_downloading')
                : t('builder_settings_project_download_button')
              }
            />
          }
          description={t('builder_settings_project_download_desc')}
        >
        </SettingsSection>
        {isTeamEnabled && (
          <SettingsSection
            title={t("builder_settings_team_title")}
            description={t("builder_settings_team_description")}
            button={
              <Button
                design="primary"
                size="sm"
                text={t("builder_settings_team_manage_access")}
                href={delegationUrl}
                rel="noopener noreferrer"
                icon={<Users3Icon />}
                external
              />
            }
          />
        )}
        <ModelSelector />
      </Box>
    </>
  )
}
