'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import Box from '@ux/box'
import Alert from '@ux/alert'
import { Loader } from '@airo-ux/loader'
import { tips, shuffleArray } from './tips-content'

/**
 * Props for the Tips component.
 */
interface TipsProps {
  /** Message to display in the loader description */
  buildingMessage?: string
  showTips?: boolean
}

/**
 * Tips carousel component that displays educational tips during app creation.
 * Features auto-rotation with manual navigation controls.
 * Tips are randomized on component mount for variety.
 *
 * @param props - Component props
 * @returns The Tips component with loader and carousel
 */
export default function Tips({ buildingMessage = 'The AI agent is building your app...', showTips = true }: TipsProps) {
  // Randomize tips once on mount
  const shuffledTips = useMemo(() => shuffleArray(tips), [])

  const [currentIndex, setCurrentIndex] = useState(0)
  const rotationIntervalRef = useRef<NodeJS.Timeout | null>(null)

  const currentTip = shuffledTips[currentIndex]

  /**
   * Sets up auto-rotation interval.
   * Cleans up interval when component unmounts.
   */
  useEffect(() => {
    rotationIntervalRef.current = setInterval(() => {
      setCurrentIndex((prev) => (prev === shuffledTips.length - 1 ? 0 : prev + 1))
    }, 12000)

    return () => {
      if (rotationIntervalRef.current) {
        clearInterval(rotationIntervalRef.current)
      }
    }
  }, [shuffledTips.length])

  return (
    <Box className="h-full mt-6" blockAlignChildren="center" inlineAlignChildren="center" gap="xl">
      {/* Loader spinner with building message */}
      <Loader title={buildingMessage} />

      {/* Tips section below loader */}
      {showTips && (
        <Box className="w-full max-w-2xl px-3" gap="md">
          {/* Tip carousel */}
          <Box className="relative" gap="md">
            {/* Tip content with animation */}
            <Box className="overflow-hidden min-h-24">
              <AnimatePresence mode="wait">
                <motion.div
                  className="p-2"
                  key={currentTip.id}
                  initial={{ opacity: 0, y: 5, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 5, scale: 0.95 }}
                  transition={{ duration: 0.4 }}
                >
                  <Alert
                    emphasis="info"
                    title={currentTip.title}
                  >
                   {currentTip.description}
                  </Alert>
                </motion.div>
              </AnimatePresence>
            </Box>
          </Box>
        </Box>
      )}
    </Box>
  )
}
