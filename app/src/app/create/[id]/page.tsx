'use client'

import { useEffect, useState, useRef } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { useSiteCreationStore, cleanupSiteCreationStore, type SiteCreationPhase } from '@/stores/useSiteCreationStore'
import { logImpressionEvent } from '@/utils/instrumentation'
import Box from '@ux/box'
import Button from '@ux/button'

export default function CreateAppStatus() {
  const router = useRouter()
  const params = useParams()
  const siteId = params.id as string

  const {
    phase,
    error,
    retryCount,
    maxRetries,
    initializeSite,
    retry,
  } = useSiteCreationStore()

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
    'complete': 'Your app is ready! Redirecting, hold on tight...'
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

  // Handle redirect when complete phase is visible
  useEffect(() => {
    if (!seenPhases.includes('complete') || !siteId) return

    const redirectTimer = setTimeout(() => {
      router.replace(`/develop/${siteId}`)
    }, 3000)

    return () => clearTimeout(redirectTimer)
  }, [seenPhases, siteId, router])

  // Initialize the creation flow
  useEffect(() => {
    if (!siteId) return

    console.log('🚀 Starting site creation flow for:', siteId)
    initializeSite(siteId)

    // Cleanup on unmount
    return () => {
      cleanupSiteCreationStore()
    }
  }, [siteId, initializeSite])

  useEffect(() => {
    logImpressionEvent({ eid: 'create.page' })();
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
