'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import Alert from '@ux/alert'
import Box from '@ux/box'
import Button from '@ux/button'
import Spinner from '@ux/spinner'
import text from '@ux/text'

import { usePublishedUrl } from '@/app/[market]/develop/hooks/usePublishedUrl'
import { buildDynamicApiUrl } from '@/config/dynamic-api'
import { AuthStatus, useAuthPopup } from '@/hooks/social/connect-flow/useAuthPopup'
import { useSocialAuthUrl } from '@/hooks/social/queries/useSocialAuthUrl'
import { useSocialConnections } from '@/hooks/social/queries/useSocialV2'
import {
  type GscVerificationMetadata,
  type GscVerificationPatch,
  useGscConnectFlow,
} from '@/hooks/social/useGscConnectFlow'
import { usePublishApp } from '@/hooks/usePublishApp'
import { useSiteAssociations } from '@/hooks/useSocial'
import { useTranslations } from '@/hooks/useTranslations'
import { agentFetch } from '@/lib/agent-fetch'
import { logger } from '@/lib/request-context'
import { gscClient } from '@/lib/social-gsc'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
import type { GoogleSearchConsoleConnection } from '@/types/social'
import { SocialPlatform, SocialPlatformKey } from '@/types/social'
import { SOCIAL_SCOPES } from '@/types/social-scopes'

type GscFlowPhase = 'connect' | 'tag-injected' | 'verify' | 'connected'

interface GscChatFlowWidgetProps {
  appId: string
  isActive: boolean
  initialPhase?: 'connect' | 'tag-injected' | 'connected'
  onTagInjected?: () => void
  onComplete: () => void
  onError: (msg: string) => void
}

export function GscChatFlowWidget({
  appId,
  isActive,
  initialPhase = 'connect',
  onTagInjected,
  onComplete,
  onError,
}: GscChatFlowWidgetProps) {
  const t = useTranslations()
  const publishedUrl = usePublishedUrl()
  const { setupVerificationAfterAuth, verifyAndLink } = useGscConnectFlow(appId)
  const [phase, setPhase] = useState<GscFlowPhase>(
    initialPhase === 'connected'
      ? 'connected'
      : initialPhase === 'tag-injected'
        ? 'tag-injected'
        : 'connect'
  )
  const [isConnecting, setIsConnecting] = useState(false)
  const [oauthState, setOauthState] = useState('')
  const [connectError, setConnectError] = useState<string | null>(null)
  const [verifyError, setVerifyError] = useState<string | null>(null)
  const [publishError, setPublishError] = useState<string | null>(null)
  const [publishAwaiting, setPublishAwaiting] = useState(false)
  const [isVerifying, setIsVerifying] = useState(false)
  const [propertyListWarning, setPropertyListWarning] = useState(false)
  const [lastSubmittedAt, setLastSubmittedAt] = useState<string | null>(null)
  const [sitemapSubmitError, setSitemapSubmitError] = useState<string | null>(null)
  const [pendingVerification, setPendingVerification] = useState<GscVerificationPatch | null>(null)
  const prevPublishStoreErrorRef = useRef(false)

  const { data: associationsData } = useSiteAssociations(appId)
  const { data: connections } = useSocialConnections()
  const gscAssociation = associationsData?.associations?.find(
    (a) => a.platform === SocialPlatformKey.GOOGLE_SEARCH_CONSOLE
  )
  const gscConnection = connections?.find(
    (c): c is GoogleSearchConsoleConnection => c.socialId === gscAssociation?.socialId
  )
  const connectedUserTokenId = gscConnection?.userTokenId

  const { data: metadataData } = useQuery({
    queryKey: ['app-metadata', appId],
    queryFn: async (): Promise<GscVerificationMetadata> => {
      const apiUrl = await buildDynamicApiUrl('metadata', appId)
      const response = await agentFetch(apiUrl, { siteId: appId, method: 'GET' })
      if (!response.ok) throw new Error(`Failed to fetch metadata: ${response.status}`)
      const data = await response.json() as { metadata: GscVerificationMetadata }
      return data.metadata
    },
    enabled: phase === 'tag-injected' || phase === 'verify',
  })

  const pendingSiteUrl = pendingVerification?.googleVerificationSiteUrl
    ?? metadataData?.googleVerificationSiteUrl
    ?? publishedUrl
  const pendingUserTokenId = pendingVerification?.googleVerificationUserTokenId
    ?? metadataData?.googleVerificationUserTokenId
    ?? null
  const pendingToken = pendingVerification?.googleVerificationToken
    ?? metadataData?.googleVerificationToken
    ?? null

  const authUrlQuery = useSocialAuthUrl(
    isConnecting && oauthState
      ? { platform: SocialPlatform.GOOGLE, appId, state: oauthState, scopes: SOCIAL_SCOPES.google_search_console }
      : null
  )

  const publishMutation = usePublishApp()
  const isPublishing = useDevelopPageStore((state) => state.publishStates[appId]?.isPublishing ?? false)
  const publishStoreError = useDevelopPageStore((state) => state.publishStates[appId]?.publishError ?? false)

  const surfacePublishFailure = useCallback((error: unknown): void => {
    logger.error('gsc.publish.failed', {
      appId,
      error: error instanceof Error ? error.message : error,
    })
    setPublishError(
      t('builder_seo_gsc_error_publish_failed', undefined, 'Publish failed. Please try again.')
    )
    setPublishAwaiting(false)
  }, [appId, t])

  const beginOAuth = useCallback((): void => {
    setConnectError(null)
    setOauthState(crypto.randomUUID())
    setIsConnecting(true)
  }, [])

  const handleAuthSuccess = useCallback(
    async (data: Record<string, unknown>): Promise<void> => {
      const tokenId = data.user_token as string
      if (!publishedUrl) {
        const errMsg = t('builder_seo_gsc_error_no_published_url', undefined, 'Publish your site first so Google can verify it.')
        setConnectError(errMsg)
        setIsConnecting(false)
        onError(errMsg)
        return
      }
      setConnectError(null)
      try {
        const patch = await setupVerificationAfterAuth(publishedUrl, tokenId)
        setPendingVerification(patch)
        setPhase('tag-injected')
        onTagInjected?.()
      } catch (error) {
        logger.error('gsc.connect.setup-failed', {
          appId,
          error: error instanceof Error ? error.message : error,
        })
        const errMsg = t('builder_seo_gsc_error_connect_failed', undefined, 'Failed to set up verification. Please try again.')
        setConnectError(errMsg)
        onError(errMsg)
      } finally {
        setIsConnecting(false)
      }
    },
    [publishedUrl, setupVerificationAfterAuth, onTagInjected, onError, appId, t]
  )

  const { authStatus, errorMessage } = useAuthPopup(
    authUrlQuery.data?.url ?? '',
    SocialPlatform.GOOGLE,
    oauthState,
    handleAuthSuccess,
    !isConnecting || !authUrlQuery.data?.url
  )

  useEffect(() => {
    if (authStatus === AuthStatus.Error && isConnecting) {
      setIsConnecting(false)
      const errMsg = errorMessage ?? t('builder_seo_gsc_error_auth_failed', undefined, 'Authentication failed. Please try again.')
      setConnectError(errMsg)
      onError(errMsg)
    }
  }, [authStatus, isConnecting, errorMessage, onError, t])

  useEffect(() => {
    const publishStoreErrorBecameTrue = publishAwaiting
      && publishStoreError
      && !prevPublishStoreErrorRef.current
    prevPublishStoreErrorRef.current = publishStoreError
    if (phase !== 'tag-injected' || !publishStoreErrorBecameTrue) return
    surfacePublishFailure('deployment-failed')
  }, [phase, publishAwaiting, publishStoreError, surfacePublishFailure])

  useEffect(() => {
    if (phase !== 'tag-injected' && phase !== 'verify') return

    const handlePublishSnapshot = (event: Event): void => {
      const detail = (event as CustomEvent).detail as { appId?: string } | undefined
      if (!detail || detail.appId !== appId) return
      setPublishError(null)
      setPublishAwaiting(false)
      setPhase('verify')
    }

    const handlePublishFailed = (event: Event): void => {
      const detail = (event as CustomEvent).detail as { appId?: string } | undefined
      if (!detail || detail.appId !== appId || phase !== 'tag-injected' || !publishAwaiting) return
      surfacePublishFailure('deployment-incomplete')
    }

    window.addEventListener('publish-snapshot-request', handlePublishSnapshot)
    window.addEventListener('publish-snapshot-failed', handlePublishFailed)
    return () => {
      window.removeEventListener('publish-snapshot-request', handlePublishSnapshot)
      window.removeEventListener('publish-snapshot-failed', handlePublishFailed)
    }
  }, [phase, appId, publishAwaiting, surfacePublishFailure])

  const handlePublish = useCallback((): void => {
    setPublishError(null)
    prevPublishStoreErrorRef.current = publishStoreError
    useDevelopPageStore.getState().setPublishError(appId, false)
    setPublishAwaiting(true)
    publishMutation.mutate(
      { appId },
      {
        onError: (error) => {
          surfacePublishFailure(error)
        },
      }
    )
  }, [appId, publishMutation, publishStoreError, surfacePublishFailure])

  const handleVerify = useCallback(async (): Promise<void> => {
    if (!pendingToken || !pendingUserTokenId || !pendingSiteUrl) return
    setVerifyError(null)
    setIsVerifying(true)
    try {
      const { siteAdded } = await verifyAndLink(pendingSiteUrl, pendingUserTokenId)
      if (siteAdded) {
        setLastSubmittedAt(new Date().toISOString())
      } else {
        setPropertyListWarning(true)
      }
      setPhase('connected')
      onComplete()
    } catch (error) {
      logger.error('gsc.verify.failed', {
        appId,
        siteUrl: pendingSiteUrl,
        error: error instanceof Error ? error.message : error,
      })
      setVerifyError(t('builder_seo_gsc_error_verify_failed', undefined, 'Verification failed. Make sure you published your site and try again.'))
    } finally {
      setIsVerifying(false)
    }
  }, [
    pendingToken,
    pendingUserTokenId,
    pendingSiteUrl,
    verifyAndLink,
    appId,
    onComplete,
    t,
  ])

  if (!publishedUrl) {
    return (
      <Box gap="sm" data-testid="gsc-chat-flow-widget">
        <text.p>
          {t('builder_seo_gsc_unpublished_description', undefined, 'Publish your site first to connect Google Search Console. Once your site is live, you can submit your sitemap to help Google discover and index your pages faster.')}
        </text.p>
      </Box>
    )
  }

  if (phase === 'connected') {
    const sitemapUrl = publishedUrl
      ? `${publishedUrl.endsWith('/') ? publishedUrl : `${publishedUrl}/`}sitemap.xml`
      : null

    return (
      <Box gap="sm" data-testid="gsc-chat-flow-widget">
        <text.p>
          {t('builder_seo_gsc_connected_label', undefined, 'Connected to Google Search Console')}
        </text.p>
        {publishedUrl && (
          <text.p>{t('builder_seo_gsc_site_label', { url: publishedUrl }, 'Site: {url}')}</text.p>
        )}
        {lastSubmittedAt && (
          <text.p>
            {t('builder_seo_gsc_last_submitted', { date: new Date(lastSubmittedAt).toLocaleString() }, 'Sitemap last submitted: {date}')}
          </text.p>
        )}
        {propertyListWarning && (
          <>
            <Alert emphasis="warning">
              {t('builder_seo_gsc_property_list_warning', undefined, 'Your site is verified but could not be added to the Google Search Console property list. You may need to add it manually at search.google.com/search-console.')}
            </Alert>
            <text.p>
              {sitemapUrl
                ? t(
                  'builder_seo_gsc_chat_manual_sitemap',
                  { sitemapUrl },
                  'We could not submit your sitemap automatically. Open Google Search Console and add {sitemapUrl} manually.',
                )
                : t(
                  'builder_seo_gsc_chat_manual_sitemap_no_url',
                  undefined,
                  'We could not submit your sitemap automatically. Open Google Search Console and add your sitemap manually.',
                )}
            </text.p>
          </>
        )}
        {sitemapSubmitError && <Alert emphasis="critical">{sitemapSubmitError}</Alert>}
        {publishedUrl && (
          <Button
            as="external"
            href={`https://search.google.com/search-console?resource_id=${encodeURIComponent(publishedUrl)}`}
            target="_blank"
            rel="noopener noreferrer"
            design="primary"
            size="small"
          >
            {t('builder_seo_gsc_dashboard_link', undefined, 'View in Google Search Console')}
          </Button>
        )}
        {connectedUserTokenId && publishedUrl && (
          <Button
            onClick={() => {
              setSitemapSubmitError(null)
              void gscClient
                .submitGscSitemap(publishedUrl, connectedUserTokenId)
                .then(() => {
                  setLastSubmittedAt(new Date().toISOString())
                })
                .catch((error: unknown) => {
                  logger.error('gsc.sitemap-submit.failed', {
                    appId,
                    error: error instanceof Error ? error.message : error,
                  })
                  setSitemapSubmitError(
                    t('builder_seo_gsc_sitemap_submit_failed', undefined, 'Sitemap submit failed. Try again or add it manually in Google Search Console.')
                  )
                })
            }}
            design="secondary"
            size="small"
          >
            {t('builder_seo_gsc_resubmit_button', undefined, 'Re-submit sitemap')}
          </Button>
        )}
      </Box>
    )
  }

  if (phase === 'tag-injected' || phase === 'verify') {
    return (
      <Box gap="sm" data-testid="gsc-chat-flow-widget">
        <text.p>
          {t('builder_seo_gsc_chat_publish_description', undefined, 'Verification tag added. Publish your site so Google can find it, then verify ownership.')}
        </text.p>
        {propertyListWarning && (
          <Alert emphasis="warning">
            {t('builder_seo_gsc_property_list_warning', undefined, 'Your site is verified but could not be added to the Google Search Console property list. You may need to add it manually at search.google.com/search-console.')}
          </Alert>
        )}
        {publishError && <Alert emphasis="critical">{publishError}</Alert>}
        {verifyError && <Alert emphasis="critical">{verifyError}</Alert>}
        {phase === 'tag-injected' && (
          <Button
            onClick={handlePublish}
            design="primary"
            disabled={!isActive || publishMutation.isPending || isPublishing}
          >
            {publishMutation.isPending || isPublishing
              ? t('builder_seo_gsc_publishing_label', undefined, 'Publishing...')
              : t('builder_seo_gsc_publish_button', undefined, 'Publish site')}
          </Button>
        )}
        {phase === 'verify' && (
          isVerifying ? (
            <Box gap="md" orientation="horizontal" blockAlignChildren="center">
              <Spinner size="sm" />
              <text.p>{t('builder_seo_gsc_verifying_label', undefined, 'Verifying with Google...')}</text.p>
            </Box>
          ) : (
            <Button onClick={() => { void handleVerify() }} design="primary" disabled={!isActive}>
              {t('builder_seo_gsc_verify_button', undefined, 'Verify with Google')}
            </Button>
          )
        )}
      </Box>
    )
  }

  return (
    <Box gap="sm" data-testid="gsc-chat-flow-widget" data-active={isActive}>
      {connectError && <Alert emphasis="critical">{connectError}</Alert>}
      {isConnecting ? (
        <Box gap="md" orientation="horizontal" blockAlignChildren="center">
          <Spinner size="sm" />
          <text.p>{t('builder_seo_gsc_connecting_label', undefined, 'Connecting to Google Search Console...')}</text.p>
          <Button onClick={() => { setIsConnecting(false) }} design="secondary" size="small">
            {t('builder_seo_gsc_cancel_button', undefined, 'Cancel')}
          </Button>
        </Box>
      ) : (
        <Button onClick={beginOAuth} design="primary" disabled={!isActive}>
          {t('builder_seo_gsc_connect_button', undefined, 'Connect Google Search Console')}
        </Button>
      )}
    </Box>
  )
}
