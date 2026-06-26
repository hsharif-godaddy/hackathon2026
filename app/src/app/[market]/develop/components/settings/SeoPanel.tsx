'use client'

import { useCallback, useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import Alert from '@ux/alert'
import Box from '@ux/box'
import Button from '@ux/button'
import GoogleIcon from '@ux/icon/google'
import Spinner from '@ux/spinner'
import text from '@ux/text'

import { SettingsLoadingState } from '@/app/[market]/develop/components/settings/components/SettingsLoadingState'
import SettingsSection from '@/app/[market]/develop/components/settings/SettingsSection'
import { usePublishedUrl } from '@/app/[market]/develop/hooks/usePublishedUrl'
import { buildDynamicApiUrl } from '@/config/dynamic-api'
import { AuthStatus, useAuthPopup } from '@/hooks/social/connect-flow/useAuthPopup'
import { useLinkConnection } from '@/hooks/social/mutations/useLinkConnection'
import { useSocialAuthUrl } from '@/hooks/social/queries/useSocialAuthUrl'
import { useCreateSocialConnection, useSocialConnections } from '@/hooks/social/queries/useSocialV2'
import { useSiteAssociations } from '@/hooks/useSocial'
import { useTranslations } from '@/hooks/useTranslations'
import { agentFetch } from '@/lib/agent-fetch'
import { logger } from '@/lib/request-context'
import { gscClient } from '@/lib/social-gsc'
import { parseUserId } from '@/lib/social-utils'
import type { GoogleSearchConsoleConnection } from '@/types/social'
import { SocialPlatform, SocialPlatformKey } from '@/types/social'
import { SOCIAL_SCOPES } from '@/types/social-scopes'

interface GscVerificationMetadata {
  googleVerificationToken?: string | null
  googleVerificationSiteUrl?: string | null
  googleVerificationUserTokenId?: string | null
}

interface SeoPanelProps {
  siteId: string
}

export default function SeoPanel({ siteId }: SeoPanelProps) {
  const t = useTranslations()
  const publishedUrl = usePublishedUrl()
  const queryClient = useQueryClient()
  const [isConnecting, setIsConnecting] = useState(false)
  const [isVerifying, setIsVerifying] = useState(false)
  const [oauthState, setOauthState] = useState<string>('')
  const [connectError, setConnectError] = useState<string | null>(null)
  const [verifyError, setVerifyError] = useState<string | null>(null)
  const [lastSubmittedAt, setLastSubmittedAt] = useState<string | null>(null)
  const [propertyListWarning, setPropertyListWarning] = useState<boolean>(false)

  const { data: associationsData, isLoading: isAssociationsLoading } = useSiteAssociations(siteId)
  const { data: connections, isLoading: isConnectionsLoading } = useSocialConnections()

  const { data: metadataData, isLoading: isMetadataLoading } = useQuery({
    queryKey: ['app-metadata', siteId],
    queryFn: async (): Promise<GscVerificationMetadata> => {
      const apiUrl = await buildDynamicApiUrl('metadata', siteId)
      const response = await agentFetch(apiUrl, { siteId, method: 'GET' })
      if (!response.ok) throw new Error(`Failed to fetch metadata: ${response.status}`)
      const data = await response.json() as { metadata: GscVerificationMetadata }
      return data.metadata
    },
  })

  const patchMetadata = useMutation({
    mutationFn: async (patch: Partial<GscVerificationMetadata>): Promise<void> => {
      const apiUrl = await buildDynamicApiUrl('metadata', siteId)
      const response = await agentFetch(apiUrl, {
        siteId,
        method: 'PATCH',
        body: JSON.stringify(patch),
      })
      if (!response.ok) throw new Error(`Failed to update metadata: ${response.status}`)
    },
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['app-metadata', siteId] }) },
  })

  const injectVerificationTag = useMutation({
    mutationFn: async (token: string): Promise<void> => {
      const apiUrl = await buildDynamicApiUrl('seo/verification-tag', siteId)
      const response = await agentFetch(apiUrl, {
        siteId,
        method: 'POST',
        body: JSON.stringify({ verificationToken: token }),
      })
      if (!response.ok) throw new Error(`Failed to inject verification tag: ${response.status}`)
    },
  })

  const gscAssociation = associationsData?.associations?.find(
    (a) => a.platform === SocialPlatformKey.GOOGLE_SEARCH_CONSOLE
  )
  const isConnected = !!gscAssociation

  const gscConnection = connections?.find(
    (c): c is GoogleSearchConsoleConnection => c.socialId === gscAssociation?.socialId
  )
  const connectedUserTokenId = gscConnection?.userTokenId

  const pendingToken = metadataData?.googleVerificationToken ?? null
  const pendingSiteUrl = metadataData?.googleVerificationSiteUrl ?? null
  const pendingUserTokenId = metadataData?.googleVerificationUserTokenId ?? null
  const hasPendingVerification = !!pendingToken && !!pendingUserTokenId && !isConnected

  const authUrlQuery = useSocialAuthUrl(
    isConnecting && oauthState
      ? { platform: SocialPlatform.GOOGLE, appId: siteId, state: oauthState, scopes: SOCIAL_SCOPES.google_search_console }
      : null
  )

  const createConnection = useCreateSocialConnection()
  const linkConnection = useLinkConnection()

  const handleAuthSuccess = useCallback(
    async (data: Record<string, unknown>): Promise<void> => {
      const tokenId = data.user_token as string
      if (!publishedUrl) {
        setConnectError(t('builder_seo_gsc_error_no_published_url', undefined, 'Publish your site first so Google can verify it.'))
        setIsConnecting(false)
        return
      }
      setConnectError(null)
      try {
        const verificationToken = await gscClient.getGscVerificationToken(publishedUrl, tokenId)
        await injectVerificationTag.mutateAsync(verificationToken)
        await patchMetadata.mutateAsync({
          googleVerificationToken: verificationToken,
          googleVerificationSiteUrl: publishedUrl,
          googleVerificationUserTokenId: tokenId,
        })
      } catch {
        setConnectError(t('builder_seo_gsc_error_connect_failed', undefined, 'Failed to set up verification. Please try again.'))
      } finally {
        setIsConnecting(false)
      }
    },
    [publishedUrl, injectVerificationTag, patchMetadata]
  )

  const { authStatus, errorMessage, openPopup } = useAuthPopup(
    authUrlQuery.data?.url ?? '',
    SocialPlatform.GOOGLE,
    oauthState,
    handleAuthSuccess,
    !isConnecting || !authUrlQuery.data?.url
  )

  useEffect(() => {
    if (authStatus === AuthStatus.Error && isConnecting) {
      setIsConnecting(false)
      setConnectError(errorMessage ?? t('builder_seo_gsc_error_auth_failed', undefined, 'Authentication failed. Please try again.'))
    }
  }, [authStatus, isConnecting, errorMessage])

  const handleConnect = useCallback(() => {
    setConnectError(null)
    setOauthState(crypto.randomUUID())
    setIsConnecting(true)
  }, [])

  const handleCancel = useCallback(() => {
    setIsConnecting(false)
    setOauthState('')
  }, [])

  const handleVerify = useCallback(async (): Promise<void> => {
    if (!pendingToken || !pendingUserTokenId || !pendingSiteUrl) return
    setVerifyError(null)
    setIsVerifying(true)
    try {
      await gscClient.verifyGscSite(pendingSiteUrl, pendingUserTokenId)

      const siteAdded: boolean = await gscClient.addGscSite(pendingSiteUrl, pendingUserTokenId)
      if (!siteAdded) {
        logger.warn('gsc.add-site.exhausted-after-retries', { siteUrl: pendingSiteUrl })
        setPropertyListWarning(true)
      }

      const userId = parseUserId(pendingUserTokenId)
      const { socialId } = await createConnection.mutateAsync({
        platform: SocialPlatformKey.GOOGLE_SEARCH_CONSOLE,
        userTokenId: pendingUserTokenId,
        userId,
      })
      await linkConnection.mutateAsync({
        siteId,
        socialId,
        platform: SocialPlatform.GOOGLE_SEARCH_CONSOLE,
      })

      if (siteAdded) {
        await gscClient.submitGscSitemap(pendingSiteUrl, pendingUserTokenId)
        setLastSubmittedAt(new Date().toISOString())
      }

      await patchMetadata.mutateAsync({
        googleVerificationToken: null,
        googleVerificationSiteUrl: null,
        googleVerificationUserTokenId: null,
      })
    } catch {
      setVerifyError(t('builder_seo_gsc_error_verify_failed', undefined, 'Verification failed. Make sure you published your site and try again.'))
    } finally {
      setIsVerifying(false)
    }
  }, [pendingToken, pendingUserTokenId, pendingSiteUrl, createConnection, linkConnection, siteId, patchMetadata])

  const isLoading = isAssociationsLoading || isConnectionsLoading || isMetadataLoading
  const isProcessing = isConnecting || createConnection.isPending || linkConnection.isPending

  if (isLoading) return <SettingsLoadingState />

  if (isConnected) {
    return (
      <SettingsSection title={t('builder_seo_gsc_title', undefined, 'Google Search Console')}>
        <Box gap="md">
          <Box gap="sm" orientation="horizontal" blockAlignChildren="center">
            <GoogleIcon />
            <text.p>{t('builder_seo_gsc_connected_label', undefined, 'Connected to Google Search Console')}</text.p>
          </Box>
          {propertyListWarning && (
            <Alert emphasis="warning">
              {t('builder_seo_gsc_property_list_warning', undefined, 'Your site is verified but could not be added to the Google Search Console property list. You may need to add it manually at search.google.com/search-console.')}
            </Alert>
          )}
          {publishedUrl && <text.p>{t('builder_seo_gsc_site_label', { url: publishedUrl }, 'Site: {url}')}</text.p>}
          {lastSubmittedAt && (
            <text.p>{t('builder_seo_gsc_last_submitted', { date: new Date(lastSubmittedAt).toLocaleString() }, 'Sitemap last submitted: {date}')}</text.p>
          )}
          {publishedUrl && (
            <Button
              as="external"
              href={`https://search.google.com/search-console?resource_id=${encodeURIComponent(publishedUrl)}`}
              target="_blank"
              rel="noopener noreferrer"
              design="secondary"
              size="small"
            >
              {t('builder_seo_gsc_dashboard_link', undefined, 'View in Google Search Console')}
            </Button>
          )}
          {connectedUserTokenId && publishedUrl && (
            <Button
              onClick={() => {
                void gscClient
                  .submitGscSitemap(publishedUrl, connectedUserTokenId)
                  .then(() => setLastSubmittedAt(new Date().toISOString()))
              }}
              design="secondary"
              size="small"
            >
              {t('builder_seo_gsc_resubmit_button', undefined, 'Re-submit sitemap')}
            </Button>
          )}
        </Box>
      </SettingsSection>
    )
  }

  if (hasPendingVerification) {
    return (
      <SettingsSection title={t('builder_seo_gsc_title', undefined, 'Google Search Console')}>
        <Box gap="md">
          <text.p>
            {t('builder_seo_gsc_pending_description', undefined, 'A Google verification tag has been added to your site. Publish your site so Google can confirm ownership, then click "Verify with Google" below.')}
          </text.p>
          {verifyError && <Alert emphasis="critical">{verifyError}</Alert>}
          {isVerifying ? (
            <Box gap="md" orientation="horizontal" blockAlignChildren="center">
              <Spinner size="sm" />
              <text.p>{t('builder_seo_gsc_verifying_label', undefined, 'Verifying with Google...')}</text.p>
            </Box>
          ) : (
            <Button onClick={() => void handleVerify()} design="primary">
              {t('builder_seo_gsc_verify_button', undefined, 'Verify with Google')}
            </Button>
          )}
        </Box>
      </SettingsSection>
    )
  }

  if (!publishedUrl) {
    return (
      <SettingsSection title={t('builder_seo_gsc_title', undefined, 'Google Search Console')}>
        <text.p>
          {t('builder_seo_gsc_unpublished_description', undefined, 'Publish your site first to connect Google Search Console. Once your site is live, you can submit your sitemap to help Google discover and index your pages faster.')}
        </text.p>
      </SettingsSection>
    )
  }

  return (
    <SettingsSection title={t('builder_seo_gsc_title', undefined, 'Google Search Console')}>
      <Box gap="md">
        <text.p>
          {t('builder_seo_gsc_connect_description', undefined, 'Connect Google Search Console to automatically submit your sitemap when you publish, helping Google discover and index your pages faster.')}
        </text.p>
        {(connectError ?? (authStatus === AuthStatus.Error ? errorMessage : null)) && (
          <Alert emphasis="critical">
            {connectError ?? errorMessage}
          </Alert>
        )}
        {isProcessing ? (
          <Box gap="md" orientation="horizontal" blockAlignChildren="center">
            <Spinner size="sm" />
            <text.p>{t('builder_seo_gsc_connecting_label', undefined, 'Connecting to Google Search Console...')}</text.p>
            <Button onClick={handleCancel} design="secondary" size="small">
              {t('builder_seo_gsc_cancel_button', undefined, 'Cancel')}
            </Button>
          </Box>
        ) : (
          <Button onClick={handleConnect} design="primary">
            {t('builder_seo_gsc_connect_button', undefined, 'Connect Google Search Console')}
          </Button>
        )}
      </Box>
    </SettingsSection>
  )
}
