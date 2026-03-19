import { useCallback } from 'react'

import { useTranslations } from '@/hooks/useTranslations'
import { EMPTY_SOCIAL_ARRAYS, FacebookPage, GoogleLocation } from '@/lib/social'
import { getPlatformStrategy } from '@/lib/social-platforms'
import { isRetryableError } from '@/lib/social-utils'
import { SocialFlowAction } from '@/types/social'
import { SocialPlatform } from '@/types/social'
import { FlowAction, FlowStep } from './useSocialConnectFlowStateMachine'
import { useSocialAuthUrl } from '../queries/useSocialAuthUrl'
import { useFacebookPages, useGoogleLocations, useValidatePermissions } from '../queries/useSocialV2'

export function getPlatformPages(
  platform: SocialPlatform,
  provider: SocialPlatform | 'unknown',
  facebookPages: FacebookPage[],
  googleLocations: GoogleLocation[]
): FacebookPage[] | GoogleLocation[] {
  if (provider === SocialPlatform.GOOGLE) return googleLocations
  if (provider !== SocialPlatform.FACEBOOK) return []

  return platform === SocialPlatform.INSTAGRAM
    ? facebookPages.filter(p => Boolean(p.instagram_business_account?.id?.trim()))
    : facebookPages
}

interface UseSocialOAuthFlowParams {
  platform: SocialPlatform,
  appId: string
  state: string
  enabled: boolean
  flowStep: FlowStep
  userTokenId: string
  pageTokens: string[]
  popup: boolean
  dispatch: (action: FlowAction) => void
}

interface UseSocialOAuthFlowResult {
  authUrl: string | undefined
  isLoadingAuthUrl: boolean
  authUrlError: Error | null
  requiredScopes: string[]
  permissionValidation: any
  isValidatingPermissions: boolean
  permissionError: Error | null
  platformPages: any[]
  isPagesLoading: boolean
  pagesError: Error | null
}

export function useSocialOAuthFlow({
  platform,
  appId,
  state,
  enabled,
  flowStep,
  userTokenId,
  popup,
  dispatch
}: UseSocialOAuthFlowParams): UseSocialOAuthFlowResult {
  const t = useTranslations()
  const strategy = getPlatformStrategy(platform)

  const { data: authData, isLoading: isLoadingAuthUrl, error: authUrlError } = useSocialAuthUrl(
    { platform, appId, state, popup },
    enabled
  )

  const authUrl = authData?.url
  const requiredScopes = authData?.scopes ?? EMPTY_SOCIAL_ARRAYS.scopes

  const onPermissionSuccess = useCallback((data: { valid: boolean; missingScopes?: string[] }) => {
    if (!data.valid) {
      dispatch({ type: SocialFlowAction.PermissionsInvalid, missingScopes: data.missingScopes || [] })
    } else {
      dispatch({ type: SocialFlowAction.PermissionsValid })
    }
  }, [dispatch])

  const onPermissionError = useCallback((error: Error) => {
    dispatch({
      type: SocialFlowAction.PermissionsError,
      error: error.message,
      isRetryable: isRetryableError(error)
    })
  }, [dispatch])

  const {
    data: permissionValidation,
    isLoading: isValidatingPermissions,
    error: permissionError
  } = useValidatePermissions(
    strategy.provider,
    userTokenId,
    requiredScopes,
    flowStep === FlowStep.ValidatingPermissions && !!userTokenId && requiredScopes.length > 0,
    state,
    { onSuccess: onPermissionSuccess, onError: onPermissionError }
  )

  const onPagesSuccess = useCallback((pages: any[]) => {
    if (pages.length === 0) {
      dispatch({
        type: SocialFlowAction.Error,
        error: t('builder_social_error_no_pages_found', { platform }),
        isRetryable: false
      })
    } else {
      dispatch({ type: SocialFlowAction.PagesLoaded })
    }
  }, [dispatch, platform, t])

  const onPagesError = useCallback((error: Error) => {
    dispatch({
      type: SocialFlowAction.Error,
      error: error.message,
      isRetryable: true
    })
  }, [dispatch])

  const shouldFetchPages = flowStep === FlowStep.FetchingPages && !!userTokenId

  const {
    data: facebookPages = EMPTY_SOCIAL_ARRAYS.pages,
    isLoading: isLoadingFacebookPages,
    error: facebookPagesError
  } = useFacebookPages(
    userTokenId,
    shouldFetchPages && strategy.requiresPageSelection && strategy.provider === SocialPlatform.FACEBOOK,
    state,
    { onSuccess: onPagesSuccess, onError: onPagesError }
  )

  const {
    data: googleLocations = EMPTY_SOCIAL_ARRAYS.locations,
    isLoading: isLoadingGoogleLocations,
    error: googleLocationsError
  } = useGoogleLocations(
    userTokenId,
    shouldFetchPages && strategy.requiresPageSelection && strategy.provider === SocialPlatform.GOOGLE,
    state,
    { onSuccess: onPagesSuccess, onError: onPagesError }
  )

  const platformPages = getPlatformPages(platform, strategy.provider, facebookPages, googleLocations)

  const isPagesLoading = strategy.provider === SocialPlatform.FACEBOOK
    ? isLoadingFacebookPages
    : strategy.provider === SocialPlatform.GOOGLE
      ? isLoadingGoogleLocations
      : false

  const pagesError = strategy.provider === SocialPlatform.FACEBOOK
    ? facebookPagesError
    : strategy.provider === SocialPlatform.GOOGLE
      ? googleLocationsError
      : null

  return {
    authUrl,
    isLoadingAuthUrl,
    authUrlError,
    requiredScopes,
    permissionValidation,
    isValidatingPermissions,
    permissionError,
    platformPages,
    isPagesLoading,
    pagesError,
  }
}
