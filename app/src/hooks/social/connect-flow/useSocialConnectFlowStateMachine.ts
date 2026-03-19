import { useEffect, useReducer, useRef } from 'react'

import { SOCIAL_FLOW_CONFIG } from '@/lib/social'
import { SocialFlowAction } from '@/types/social'

export enum FlowStep {
  SelectExisting = 'select_existing',
  Auth = 'auth',
  ValidatingPermissions = 'validating_permissions',
  FetchingPages = 'fetching_pages',
  SelectingPage = 'selecting_page',
  CreatingConnection = 'creating_connection',
  Complete = 'complete',
  Error = 'error'
}

export interface FlowState {
  step: FlowStep
  userTokenId?: string
  pageTokens?: string[]
  selectedPageId?: string
  selectedPageTokenId?: string
  error?: string
  missingScopes?: string[]
  forceNewConnection: boolean
  showSelectExisting: boolean
  retryCount: number
  previousStep?: FlowStep
  isRetryable: boolean
  maxRetries: number
  pendingRetry?: {
    step: FlowStep
    timestamp: number
  }
}

const RETRY_DELAY_MS = 1000

export type FlowAction =
  | { type: SocialFlowAction.StartSelectExisting }
  | { type: SocialFlowAction.SkipSelectExisting }
  | { type: SocialFlowAction.ForceNewConnection }
  | { type: SocialFlowAction.StartOAuth }
  | { type: SocialFlowAction.OAuthSuccess; userTokenId: string; pageTokens: string[] }
  | { type: SocialFlowAction.OAuthError; error: string }
  | { type: SocialFlowAction.OAuthTimeout }
  | { type: SocialFlowAction.PermissionsValid }
  | { type: SocialFlowAction.PermissionsInvalid; missingScopes: string[] }
  | { type: SocialFlowAction.PermissionsError; error: string; isRetryable?: boolean }
  | { type: SocialFlowAction.PagesLoaded }
  | { type: SocialFlowAction.PagesPartialFailure; error: string }
  | { type: SocialFlowAction.PageSelected; pageId: string; pageTokenId?: string }
  | { type: SocialFlowAction.ConnectionCreating }
  | { type: SocialFlowAction.ConnectionCreated }
  | { type: SocialFlowAction.ExistingSelected }
  | { type: SocialFlowAction.Error; error: string; isRetryable?: boolean }
  | { type: SocialFlowAction.Retry }
  | { type: SocialFlowAction.Reset }
  | { type: SocialFlowAction.ExecutePendingRetry }

function socialConnectFlowReducer(state: FlowState, action: FlowAction): FlowState {
  switch (action.type) {
    case SocialFlowAction.StartSelectExisting:
      return {
        ...state,
        step: FlowStep.SelectExisting,
        showSelectExisting: true,
        error: undefined
      }

    case SocialFlowAction.SkipSelectExisting:
      return {
        ...state,
        showSelectExisting: false
      }

    case SocialFlowAction.ForceNewConnection:
      return {
        ...state,
        forceNewConnection: true,
        showSelectExisting: true
      }

    case SocialFlowAction.StartOAuth:
      return {
        ...state,
        step: FlowStep.Auth,
        showSelectExisting: false,
        error: undefined
      }

    case SocialFlowAction.OAuthSuccess:
      return {
        ...state,
        step: FlowStep.ValidatingPermissions,
        userTokenId: action.userTokenId,
        pageTokens: action.pageTokens,
        error: undefined
      }

    case SocialFlowAction.OAuthError:
      return {
        ...state,
        step: FlowStep.Error,
        error: action.error,
        previousStep: FlowStep.Auth,
        isRetryable: true
      }

    case SocialFlowAction.OAuthTimeout:
      return {
        ...state,
        step: FlowStep.Error,
        error: 'OAuth connection timed out. Please try again.',
        previousStep: FlowStep.Auth,
        isRetryable: true
      }

    case SocialFlowAction.PermissionsValid:
      return {
        ...state,
        step: FlowStep.FetchingPages,
        error: undefined
      }

    case SocialFlowAction.PermissionsInvalid: {
      const scopesList = action.missingScopes.length > 0
        ? `Missing permissions: ${action.missingScopes.join(', ')}`
        : 'This connection is missing required permissions.'
      return {
        ...state,
        step: FlowStep.Error,
        error: `${scopesList} Please reconnect to grant additional access.`,
        missingScopes: action.missingScopes,
        previousStep: FlowStep.ValidatingPermissions,
        isRetryable: false
      }
    }

    case SocialFlowAction.PermissionsError: {
      const shouldRetryPermissions = state.retryCount < state.maxRetries && action.isRetryable !== false

      if (shouldRetryPermissions) {
        return {
          ...state,
          step: FlowStep.Error,
          error: action.error,
          previousStep: FlowStep.ValidatingPermissions,
          isRetryable: true,
          retryCount: state.retryCount + 1,
          pendingRetry: {
            step: FlowStep.ValidatingPermissions,
            timestamp: Date.now() + RETRY_DELAY_MS
          }
        }
      }

      return {
        ...state,
        step: FlowStep.Error,
        error: action.error,
        previousStep: FlowStep.ValidatingPermissions,
        isRetryable: false,
        pendingRetry: undefined
      }
    }

    case SocialFlowAction.PagesLoaded:
      return {
        ...state,
        step: FlowStep.SelectingPage,
        error: undefined,
        retryCount: 0
      }

    case SocialFlowAction.PagesPartialFailure:
      return {
        ...state,
        step: FlowStep.SelectingPage,
        error: action.error,
        isRetryable: false
      }

    case SocialFlowAction.PageSelected:
      return {
        ...state,
        step: FlowStep.CreatingConnection,
        selectedPageId: action.pageId,
        selectedPageTokenId: action.pageTokenId,
        error: undefined
      }

    case SocialFlowAction.ConnectionCreating:
      return {
        ...state,
        step: FlowStep.CreatingConnection,
        error: undefined
      }

    case SocialFlowAction.ConnectionCreated:
      return {
        ...state,
        step: FlowStep.Complete,
        error: undefined
      }

    case SocialFlowAction.ExistingSelected:
      return {
        ...state,
        step: FlowStep.Complete,
        error: undefined
      }

    case SocialFlowAction.Error:
      return {
        ...state,
        step: FlowStep.Error,
        error: action.error,
        previousStep: state.step,
        isRetryable: action.isRetryable ?? false
      }

    case SocialFlowAction.Retry: {
      if (!state.isRetryable || state.retryCount >= state.maxRetries) {
        return state
      }

      const retryStep = state.previousStep || FlowStep.Auth
      return {
        ...state,
        step: retryStep,
        error: undefined,
        retryCount: state.retryCount + 1,
        pendingRetry: undefined
      }
    }

    case SocialFlowAction.ExecutePendingRetry:
      if (!state.pendingRetry) {
        return state
      }

      return {
        ...state,
        step: state.pendingRetry.step,
        error: undefined,
        pendingRetry: undefined
      }

    case SocialFlowAction.Reset:
      return {
        step: FlowStep.SelectExisting,
        forceNewConnection: false,
        showSelectExisting: true,
        retryCount: 0,
        isRetryable: false,
        maxRetries: SOCIAL_FLOW_CONFIG.maxRetries
      }

    default:
      return state
  }
}

export function useSocialConnectFlowStateMachine(
  initialStep: FlowStep = FlowStep.SelectExisting,
  maxRetries: number = SOCIAL_FLOW_CONFIG.maxRetries,
  initialUserTokenId?: string
) {
  const [state, dispatch] = useReducer(socialConnectFlowReducer, {
    step: initialStep,
    userTokenId: initialUserTokenId,
    forceNewConnection: false,
    showSelectExisting: initialStep === FlowStep.SelectExisting,
    retryCount: 0,
    isRetryable: false,
    maxRetries,
    pendingRetry: undefined
  })

  const retryTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined)

  useEffect(() => {
    if (state.pendingRetry && state.pendingRetry.timestamp > Date.now()) {
      const delay = state.pendingRetry.timestamp - Date.now()

      retryTimeoutRef.current = setTimeout(() => {
        dispatch({ type: SocialFlowAction.ExecutePendingRetry })
      }, delay)

      return () => {
        if (retryTimeoutRef.current) {
          clearTimeout(retryTimeoutRef.current)
        }
      }
    }
  }, [state.pendingRetry])

  return { state, dispatch }
}
