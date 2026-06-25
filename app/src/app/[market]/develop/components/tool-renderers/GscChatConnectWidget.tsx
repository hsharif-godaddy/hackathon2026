'use client'

import { useCallback, useEffect, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import Alert from '@ux/alert'
import Box from '@ux/box'
import Button from '@ux/button'
import Spinner from '@ux/spinner'
import text from '@ux/text'

import { usePublishedUrl } from '@/app/[market]/develop/hooks/usePublishedUrl'
import { buildDynamicApiUrl } from '@/config/dynamic-api'
import { AuthStatus, useAuthPopup } from '@/hooks/social/connect-flow/useAuthPopup'
import { useSocialAuthUrl } from '@/hooks/social/queries/useSocialAuthUrl'
import { useTranslations } from '@/hooks/useTranslations'
import { agentFetch } from '@/lib/agent-fetch'
import { gscClient } from '@/lib/social-gsc'
import { SocialPlatform } from '@/types/social'
import { SOCIAL_SCOPES } from '@/types/social-scopes'

interface GscChatConnectWidgetProps {
  appId: string
  isActive: boolean
  onTagInjected: () => void
  onError: (msg: string) => void
}

interface GscVerificationPatch {
  googleVerificationToken: string
  googleVerificationSiteUrl: string
  googleVerificationUserTokenId: string
}

export function GscChatConnectWidget({ appId, isActive, onTagInjected, onError }: GscChatConnectWidgetProps) {
  const t = useTranslations()
  const publishedUrl = usePublishedUrl()
  const [isConnecting, setIsConnecting] = useState<boolean>(false)
  const [oauthState, setOauthState] = useState<string>('')
  const [connectError, setConnectError] = useState<string | null>(null)

  const authUrlQuery = useSocialAuthUrl(
    isConnecting && oauthState
      ? { platform: SocialPlatform.GOOGLE, appId, state: oauthState, scopes: SOCIAL_SCOPES.google_search_console }
      : null
  )

  const injectTag = useMutation({
    mutationFn: async (verificationToken: string): Promise<void> => {
      const apiUrl: string = await buildDynamicApiUrl('seo/verification-tag', appId)
      const response = await agentFetch(apiUrl, {
        siteId: appId,
        method: 'POST',
        body: JSON.stringify({ verificationToken }),
      })
      if (!response.ok) throw new Error(`Failed to inject verification tag: ${response.status}`)
    },
  })

  const patchMetadata = useMutation({
    mutationFn: async (patch: GscVerificationPatch): Promise<void> => {
      const apiUrl: string = await buildDynamicApiUrl('metadata', appId)
      const response = await agentFetch(apiUrl, {
        siteId: appId,
        method: 'PATCH',
        body: JSON.stringify(patch),
      })
      if (!response.ok) throw new Error(`Failed to save verification metadata: ${response.status}`)
    },
  })

  const handleAuthSuccess = useCallback(
    async (data: Record<string, unknown>): Promise<void> => {
      const tokenId = data.user_token as string
      if (!publishedUrl) {
        const errMsg: string = t('builder_seo_gsc_error_no_published_url', undefined, 'Publish your site first so Google can verify it.')
        setConnectError(errMsg)
        setIsConnecting(false)
        return
      }
      setConnectError(null)
      try {
        const verificationToken: string = await gscClient.getGscVerificationToken(publishedUrl, tokenId)
        await injectTag.mutateAsync(verificationToken)
        await patchMetadata.mutateAsync({
          googleVerificationToken: verificationToken,
          googleVerificationSiteUrl: publishedUrl,
          googleVerificationUserTokenId: tokenId,
        })
        onTagInjected()
      } catch {
        const errMsg: string = t('builder_seo_gsc_error_connect_failed', undefined, 'Failed to set up verification. Please try again.')
        setConnectError(errMsg)
        onError(errMsg)
      } finally {
        setIsConnecting(false)
      }
    },
    [publishedUrl, appId, injectTag, patchMetadata, onTagInjected, onError, t]
  )

  const { authStatus, errorMessage } = useAuthPopup(
    authUrlQuery.data?.url ?? '',
    SocialPlatform.GOOGLE,
    oauthState,
    handleAuthSuccess,
    !isConnecting || !authUrlQuery.data?.url
  )

  useEffect((): void => {
    if (authStatus === AuthStatus.Error && isConnecting) {
      setIsConnecting(false)
      const errMsg: string = errorMessage ?? t('builder_seo_gsc_error_auth_failed', undefined, 'Authentication failed. Please try again.')
      setConnectError(errMsg)
      onError(errMsg)
    }
  }, [authStatus, isConnecting, errorMessage, onError, t])

  const handleConnect = useCallback((): void => {
    setConnectError(null)
    setOauthState(crypto.randomUUID())
    setIsConnecting(true)
  }, [])

  if (!publishedUrl) {
    return (
      <Box gap="sm">
        <text.p>
          {t('builder_seo_gsc_unpublished_description', undefined, 'Publish your site first to connect Google Search Console. Once your site is live, you can submit your sitemap to help Google discover and index your pages faster.')}
        </text.p>
      </Box>
    )
  }

  return (
    <Box gap="sm">
      {connectError && <Alert emphasis="critical">{connectError}</Alert>}
      {isConnecting ? (
        <Box gap="md" orientation="horizontal" blockAlignChildren="center">
          <Spinner size="sm" />
          <text.p>{t('builder_seo_gsc_connecting_label', undefined, 'Connecting to Google Search Console...')}</text.p>
        </Box>
      ) : (
        <Button onClick={handleConnect} design="primary" disabled={!isActive}>
          {t('builder_seo_gsc_connect_button', undefined, 'Connect Google Search Console')}
        </Button>
      )}
    </Box>
  )
}
