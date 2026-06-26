import { useCallback } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { buildDynamicApiUrl } from '@/config/dynamic-api'
import { useLinkConnection } from '@/hooks/social/mutations/useLinkConnection'
import { useCreateSocialConnection } from '@/hooks/social/queries/useSocialV2'
import { agentFetch } from '@/lib/agent-fetch'
import { logger } from '@/lib/request-context'
import { gscClient } from '@/lib/social-gsc'
import { parseUserId } from '@/lib/social-utils'
import { SocialPlatform, SocialPlatformKey } from '@/types/social'

export interface GscVerificationMetadata {
  googleVerificationToken?: string | null
  googleVerificationSiteUrl?: string | null
  googleVerificationUserTokenId?: string | null
}

export interface GscVerificationPatch {
  googleVerificationToken: string
  googleVerificationSiteUrl: string
  googleVerificationUserTokenId: string
}

export function useGscConnectFlow(appId: string) {
  const queryClient = useQueryClient()
  const createConnection = useCreateSocialConnection()
  const linkConnection = useLinkConnection()

  const injectTag = useMutation({
    mutationFn: async (verificationToken: string): Promise<void> => {
      const apiUrl = await buildDynamicApiUrl('seo/verification-tag', appId)
      const response = await agentFetch(apiUrl, {
        siteId: appId,
        method: 'POST',
        body: JSON.stringify({ verificationToken }),
      })
      if (!response.ok) throw new Error(`Failed to inject verification tag: ${response.status}`)
    },
  })

  const patchMetadata = useMutation({
    mutationFn: async (patch: Partial<GscVerificationMetadata>): Promise<void> => {
      const apiUrl = await buildDynamicApiUrl('metadata', appId)
      const response = await agentFetch(apiUrl, {
        siteId: appId,
        method: 'PATCH',
        body: JSON.stringify(patch),
      })
      if (!response.ok) throw new Error(`Failed to update metadata: ${response.status}`)
    },
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['app-metadata', appId] }) },
  })

  const setupVerificationAfterAuth = useCallback(
    async (publishedUrl: string, tokenId: string): Promise<GscVerificationPatch> => {
      const verificationToken = await gscClient.getGscVerificationToken(publishedUrl, tokenId)
      await injectTag.mutateAsync(verificationToken)
      const patch: GscVerificationPatch = {
        googleVerificationToken: verificationToken,
        googleVerificationSiteUrl: publishedUrl,
        googleVerificationUserTokenId: tokenId,
      }
      await patchMetadata.mutateAsync(patch)
      return patch
    },
    [injectTag, patchMetadata]
  )

  const verifyAndLink = useCallback(
    async (pendingSiteUrl: string, pendingUserTokenId: string): Promise<{ siteAdded: boolean }> => {
      await gscClient.verifyGscSite(pendingSiteUrl, pendingUserTokenId)

      const siteAdded = await gscClient.addGscSite(pendingSiteUrl, pendingUserTokenId)
      if (!siteAdded) {
        logger.warn('gsc.add-site.exhausted-after-retries', { siteUrl: pendingSiteUrl })
      }

      const { socialId } = await createConnection.mutateAsync({
        platform: SocialPlatformKey.GOOGLE_SEARCH_CONSOLE,
        userTokenId: pendingUserTokenId,
        userId: parseUserId(pendingUserTokenId),
      })
      await linkConnection.mutateAsync({
        siteId: appId,
        socialId,
        platform: SocialPlatform.GOOGLE_SEARCH_CONSOLE,
      })

      if (siteAdded) {
        await gscClient.submitGscSitemap(pendingSiteUrl, pendingUserTokenId)
      }

      await patchMetadata.mutateAsync({
        googleVerificationToken: null,
        googleVerificationSiteUrl: null,
        googleVerificationUserTokenId: null,
      })

      return { siteAdded }
    },
    [appId, createConnection, linkConnection, patchMetadata]
  )

  return {
    setupVerificationAfterAuth,
    verifyAndLink,
    isLinking: createConnection.isPending || linkConnection.isPending,
  }
}
