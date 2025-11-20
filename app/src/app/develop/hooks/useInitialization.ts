import { useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useSiteCreationStore, cleanupSiteCreationStore } from '@/stores/useSiteCreationStore'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
import { useLoadConversationHistory } from '@/stores/useStreamingConversationStore'
import { logger } from '@/lib/request-context'

type InitializationPhase = 
  | 'idle'
  | 'checking-creation'
  | 'creating'
  | 'initializing-page'
  | 'loading-history'
  | 'ready'
  | 'error'

interface UseInitializationParams {
  appId: string | null
  isJobId: boolean
}

interface UseInitializationReturn {
  phase: InitializationPhase
  isReady: boolean
  showCreationLoader: boolean
  creationError: string | null
  retryCount: number
  maxRetries: number
  onRetry: () => void
  onCancel: () => void
}

export function useInitialization({ appId, isJobId }: UseInitializationParams): UseInitializationReturn {
  const router = useRouter()
  const [phase, setPhase] = useState<InitializationPhase>('idle')
  const hasInitialized = useRef(false)

  // Site creation store
  const {
    phase: creationPhase,
    error: creationError,
    retryCount,
    maxRetries,
    realAppId,
    initializeSite,
    retry: retryCreation,
  } = useSiteCreationStore()

  // Page store
  const { initializePage, loadingPhase } = useDevelopPageStore()

  // Streaming store
  const loadConversationHistory = useLoadConversationHistory()

  // Step 1: Check if this is a new site creation
  useEffect(() => {
    if (!appId) {
      setPhase('idle')
      return
    }

    if (isJobId) {
      setPhase('checking-creation')
    } else {
      // Existing site, skip creation phase
      setPhase('initializing-page')
    }
  }, [appId, isJobId])

  // Step 2: Handle site creation flow
  useEffect(() => {
    if (phase === 'checking-creation' && appId) {
      logger.info('initialization.site-creation.start', { appId })
      initializeSite(appId)
      setPhase('creating')
    }
  }, [phase, appId, initializeSite])

  // Step 3: Update URL when we get real app ID
  useEffect(() => {
    if (phase === 'creating' && realAppId && realAppId !== appId) {
      logger.info('initialization.url-update', {
        jobId: appId,
        realAppId
      })
      router.replace(`/develop/${realAppId}`, { scroll: false })
    }
  }, [phase, realAppId, appId, router])

  // Step 4: Wait for creation to complete, then initialize page
  useEffect(() => {
    if (phase === 'creating' && creationPhase === 'complete') {
      logger.info('initialization.creation-complete', { appId })
      setPhase('initializing-page')
    }
  }, [phase, creationPhase, appId])

  // Step 5: Initialize page (loads site data, websocket, and history)
  // NOTE: initializePage handles WebSocket and conversation loading internally
  useEffect(() => {
    if (phase === 'initializing-page' && appId && !hasInitialized.current) {
      const effectiveAppId = realAppId || appId
      logger.info('initialization.page.start', { appId: effectiveAppId })
      
      hasInitialized.current = true
      
      initializePage(effectiveAppId)
        .then(() => {
          logger.info('initialization.page.success', { appId: effectiveAppId })
          // Wait for page to be fully ready (loadingPhase === 'ready')
          setPhase('loading-history')
        })
        .catch(error => {
          logger.error('initialization.page.error', { appId: effectiveAppId, error })
          setPhase('error')
        })
    }
  }, [phase, appId, realAppId, initializePage])

  // Step 6: Wait for page loading to complete, then load conversation history
  useEffect(() => {
    if (phase === 'loading-history' && appId && loadingPhase === 'ready') {
      const effectiveAppId = realAppId || appId
      logger.info('initialization.history.start', { appId: effectiveAppId })
      
      loadConversationHistory(effectiveAppId)
        .then(() => {
          logger.info('initialization.history.success', { appId: effectiveAppId })
          setPhase('ready')
        })
        .catch(error => {
          logger.error('initialization.history.error', { appId: effectiveAppId, error })
          // Don't fail - history is optional
          setPhase('ready')
        })
    }
  }, [phase, appId, realAppId, loadingPhase, loadConversationHistory])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (isJobId) {
        cleanupSiteCreationStore()
      }
      hasInitialized.current = false
    }
  }, [isJobId])

  const handleCancel = () => {
    cleanupSiteCreationStore()
    router.push('/')
  }

  const handleRetry = () => {
    setPhase('checking-creation')
    retryCreation()
  }

  return {
    phase,
    isReady: phase === 'ready',
    showCreationLoader: phase === 'checking-creation' || phase === 'creating',
    creationError,
    retryCount,
    maxRetries,
    onRetry: handleRetry,
    onCancel: handleCancel
  }
}
