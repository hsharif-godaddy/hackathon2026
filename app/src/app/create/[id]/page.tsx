'use client'

import { useEffect, useState, useRef } from 'react'
import { useRouter, useParams, useSearchParams } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { useSiteCreationStore, cleanupSiteCreationStore, type SiteCreationPhase } from '@/stores/useSiteCreationStore'
import { logImpressionEvent } from '@/utils/instrumentation'
import Box from '@ux/box'
import Button from '@ux/button'

export default function CreateAppStatus() {
  const router = useRouter()
  const params = useParams()
  const searchParams = useSearchParams()
  const siteId = params?.id as string
  const isJobId = searchParams.get('type') === 'job'

  const {
    phase,
    error,
    retryCount,
    maxRetries,
    realAppId,
    initializeSite,
    retry,
  } = useSiteCreationStore()

  // Track if we've updated the URL with the real app ID
  const [urlUpdated, setUrlUpdated] = useState(false)

  // Track phases as they occur
  const [seenPhases, setSeenPhases] = useState<SiteCreationPhase[]>(['initializing'])
  const [phaseQueue, setPhaseQueue] = useState<SiteCreationPhase[]>([])
  const isProcessingQueue = useRef(false)

  const phaseMessages = {
    'initializing': 'Convincing the servers to cooperate...',
    'deploying': 'Teaching your code how to fly...',
    'polling': 'Adding a bit of magic...',
    'verifying-agent': 'Making sure the AI didn\'t break anything...',
    'updating-name': 'Asking the naming fairy for inspiration...',
    'complete': 'Your building environment is ready! Redirecting...'
  } as const

  // Add new phases to queue when they occur
  useEffect(() => {
    if (!phase || phase === 'error') return

    setPhaseQueue(prev => {
      // Only add if not already in seen phases and not in queue
      if (!seenPhases.includes(phase) && !prev.includes(phase)) {
        return [...prev, phase]
      }
      return prev
    })
  }, [phase, seenPhases])

  // Process queue with delay between phases
  useEffect(() => {
    if (phaseQueue.length === 0 || isProcessingQueue.current) return

    isProcessingQueue.current = true
    const nextPhase = phaseQueue[0]

    const timer = setTimeout(() => {
      setSeenPhases(prev => [...prev, nextPhase])
      setPhaseQueue(prev => prev.slice(1))
      isProcessingQueue.current = false
    }, 3000)

    return () => {
      clearTimeout(timer)
      isProcessingQueue.current = false
    }
  }, [phaseQueue])

  // Update URL when we get the real app ID (if we started with a job ID)
  // Flow: /create/6p19q4p?type=job → /create/nxOMNRQOtCBBHG7e3CI8R
  // This ensures the URL shows the real app ID for refresh/bookmark functionality
  useEffect(() => {
    // Only update if:
    // 1. We started with a job ID (?type=job in URL)
    // 2. We haven't already updated the URL
    // 3. We have a real app ID from polling
    // 4. The real app ID is different from the job ID
    const startedWithJobId = isJobId;
    const urlNotYetUpdated = !urlUpdated;
    const hasRealAppId = !!realAppId;
    const realAppIdIsDifferent = realAppId !== siteId;
    const shouldUpdateUrl = startedWithJobId && urlNotYetUpdated && hasRealAppId && realAppIdIsDifferent;

    if (!shouldUpdateUrl) return

    // Log URL transition for debugging (client-side only)
    if (process.env.NODE_ENV === 'development') {
      console.log('📝 [CREATE] Updating URL with real app ID:', {
        jobId: siteId,
        realAppId,
        currentUrl: window.location.href
      })
    }

    // Update URL without triggering a full page reload
    // Remove the ?type=job query param since we now have the real app ID
    router.replace(`/create/${realAppId}`, { scroll: false })
    setUrlUpdated(true)
  }, [isJobId, realAppId, siteId, urlUpdated, router])

  // Handle redirect when complete phase is visible
  useEffect(() => {
    if (!seenPhases.includes('complete')) return

    // Use the real app ID if available, otherwise fall back to the original siteId
    const targetId = realAppId || siteId

    if (!targetId) {
      console.error('[CREATE] No target ID available for redirect', { realAppId, siteId })
      return
    }

    // CRITICAL SAFETY CHECK: Never redirect with a job ID (7-8 chars)
    // V2 app IDs are always 10 characters
    if (targetId.length <= 8) {
      console.error('[CREATE] ❌ BLOCKED: Attempted redirect with job ID - waiting for real app ID:', {
        targetId,
        length: targetId.length,
        realAppId,
        siteId,
        phase
      })
      return
    }

    // Log redirect for debugging (client-side only)
    if (process.env.NODE_ENV === 'development') {
      console.log(`[CREATE] 🚀 Redirecting to develop page with ${realAppId ? 'real app ID' : 'original ID'}: ${targetId}`)
    }

    const redirectTimer = setTimeout(() => {
      // Stop polling before redirect to prevent overlapping requests
      if (process.env.NODE_ENV === 'development') {
        console.log('[CREATE] 🛑 Stopping site creation polling before redirect')
      }
      cleanupSiteCreationStore()

      router.replace(`/develop/${targetId}`)
    }, 1000) // Reduced from 3000ms to 1000ms - develop page shows loading state anyway

    return () => clearTimeout(redirectTimer)
  }, [seenPhases, siteId, realAppId, router, phase])

  // Initialize the creation flow
  useEffect(() => {
    if (!siteId) return

    initializeSite(siteId)

    // Cleanup ONLY on unmount - don't include initializeSite in deps to avoid re-running
    return () => {
      cleanupSiteCreationStore()
    }
  }, [siteId, initializeSite])

  useEffect(() => {
    logImpressionEvent('create.page.view')();
  }, [])

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="airo-sentinel-background">
        <div className="orbs-group animated">
          <div className="orb orb1"></div>
          <div className="orb orb2"></div>
          <div className="orb orb3"></div>
          <div className="orb orb4"></div>
        </div>
      </div>
      <div className="text-center w-full">
        { phase === 'error' && (
          <>
            <h1 className="text-2xl font-bold mb-2">App Creation Failed</h1>
            <p className="mb-12">
              {error || 'An error occurred while creating your app. Please try again.'}
            </p>
            <Box
              orientation="horizontal"
              gap="md"
              blockAlignChildren="center"
            >
              <Button
                design="secondary"
                onClick={() => router.push('/')}
                text="Go Back Home"
              />
              {retryCount < maxRetries && (
                <Button
                  design="primary"
                  onClick={retry}
                  text={`Retry (${retryCount}/${maxRetries})`}
                  className="my-6"
                />
              )}
            </Box>
          </>
        )}

        { phase !== 'error' && (
          <Box gap="lg">
            <div className="h-32 w-full mb-6 flex flex-col justify-end overflow-hidden">
              <motion.ul className="text-center space-y-1">
                <AnimatePresence mode="popLayout">
                  {seenPhases.map((phaseItem, index) => {
                    const isLatest = index === seenPhases.length - 1
                    const distanceFromBottom = seenPhases.length - 1 - index
                    const opacity = Math.max(0.3, 1 - (distanceFromBottom * 0.3))
                    const fontSize = isLatest ? '1.5rem' : '1.25rem'
                    const fontWeight = isLatest ? '500' : '300'

                    return (
                      <motion.li
                        key={phaseItem}
                        layout="position"
                        initial={{ opacity: 0, y: 15 }}
                        animate={{
                          opacity: isLatest ? 1 : opacity,
                          y: 0
                        }}
                        exit={{ opacity: 0, y: -5 }}
                        transition={{
                          layout: { duration: 0.5, ease: "easeOut" },
                          opacity: { duration: 0.6, delay: isLatest ? 0.2 : 0 },
                          y: { duration: 0.6, delay: isLatest ? 0.2 : 0 }
                        }}
                        className="flex items-center justify-center space-x-2"
                      >
                        <span
                          className="transition-all duration-700 ease-out"
                          style={{
                            opacity,
                            fontSize,
                            fontWeight
                          }}
                        >
                          {phaseMessages[phaseItem]}
                        </span>
                      </motion.li>
                    )
                  })}
                </AnimatePresence>
              </motion.ul>
            </div>

            <Box
              orientation="horizontal"
              gap="sm"
              className="mb-6"
              blockAlignChildren="center"
            >
              <div className="w-3 h-3 bg-ai-light rounded-full animate-bounce"></div>
              <div className="w-3 h-3 bg-ai rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
              <div className="w-3 h-3 bg-ai-dark rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
            </Box>

            {/* Estimated time */}
            <Box className="text-sm" gap="sm">
              <p>This usually takes 30-60 seconds</p>
              <p>Please don&apos;t close this page</p>
            </Box>

            {/* Cancel option */}
            <Box className="mx-auto">
              <Button
                onClick={() => {
                  cleanupSiteCreationStore()
                  router.push('/')
                }}
                design="tertiary"
                text="Cancel and go back"
              />
            </Box>
          </Box>
        )}
      </div>
    </div>
  )
}
