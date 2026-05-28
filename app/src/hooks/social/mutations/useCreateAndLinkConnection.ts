import { useMutation, useQueryClient } from '@tanstack/react-query'

import { socialV2Client } from '@/lib/social'
import { getPlatformStrategy, PLATFORM_TRANSFORMS } from '@/lib/social-platforms'
import { findPageToken, parseUserId } from '@/lib/social-utils'
import { SocialPlatform } from '@/types/social'
import { useLinkConnection } from './useLinkConnection'

interface CreateAndLinkConnectionParams {
  platform: string
  appId: string
  userTokenId: string
  pageTokens: string[]
  pageId: string
  accountId?: string
}

interface CreateAndLinkConnectionResult {
  socialId: string
}

export function useCreateAndLinkConnection() {
  const queryClient = useQueryClient()
  const linkMutation = useLinkConnection()

  return useMutation<CreateAndLinkConnectionResult, Error, CreateAndLinkConnectionParams>({
    mutationFn: async (params: CreateAndLinkConnectionParams) => {
      const { platform, appId, userTokenId, pageTokens, pageId, accountId } = params

      const userId = parseUserId(userTokenId)
      const matchingPageTokenId = findPageToken(pageTokens, pageId)
      const strategy = getPlatformStrategy(platform)

      const platformUpper = PLATFORM_TRANSFORMS.toApiEnum(platform)

      const { socialId } = await socialV2Client.createConnection({
        platform: platformUpper,
        userTokenId,
        pageId: strategy.requiresPageSelection && strategy.provider === SocialPlatform.FACEBOOK ? pageId : undefined,
        pageTokenId: strategy.requiresPageSelection && strategy.provider === SocialPlatform.FACEBOOK ? matchingPageTokenId : undefined,
        locationId: strategy.requiresPageSelection && strategy.provider === SocialPlatform.GOOGLE ? pageId : undefined,
        accountId: strategy.requiresPageSelection && strategy.provider === SocialPlatform.GOOGLE ? accountId : undefined,
        userId
      })

      queryClient.invalidateQueries({ queryKey: ['social-connections'] })

      await linkMutation.mutateAsync({
        siteId: appId,
        socialId,
        platform: platform.toLowerCase()
      })

      queryClient.invalidateQueries({ queryKey: ['facebook-pages'] })
      queryClient.invalidateQueries({ queryKey: ['google-locations'] })

      return { socialId }
    }
  })
}
