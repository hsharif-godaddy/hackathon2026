'use client'

import { useState, useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { createPortal } from 'react-dom'
import Button from '@ux/button'
import XThickIcon from '@ux/icon/x-thick'
import KeyValueTable from './KeyValueTable'
import type { DefaultToolRendererProps } from './DefaultToolRenderer'

/**
 * Get agent display name from agent ID
 */
function getAgentDisplayName(agentId: string): string {
  const nameMap: Record<string, string> = {
    'develop': 'Developer',
    'database': 'Database Designer',
    'color-scheme': 'Color Scheme Designer',
    'colorScheme': 'Color Scheme Designer'
  }
  return nameMap[agentId] || agentId
}

/**
 * Custom renderer for handoff tool
 * 
 * Shows "Now talking with {Agent Name}" with a robot icon.
 * Clickable to show modal with handoff details (arguments and results).
 */
export default function HandoffToolRenderer({
  toolName,
  toolStatus,
  input,
  result
}: DefaultToolRendererProps) {
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (isModalOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = 'unset'
    }

    return () => {
      document.body.style.overflow = 'unset'
    }
  }, [isModalOpen])

  const getStatusIndicator = () => {
    if (toolStatus === 'running') {
      return (
        <svg className="w-2.5 h-2.5 animate-spin" viewBox="0 0 24 24">
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
            fill="none"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
          />
        </svg>
      )
    }
    return null
  }

  const statusIndicator = getStatusIndicator()

  // Extract target agent from input or result
  let targetAgent = 'Unknown Agent'
  if (input && typeof input === 'object') {
    const inputObj = input as any
    targetAgent = getAgentDisplayName(inputObj.targetAgent || inputObj.target_agent || '')
  }
  if (result && typeof result === 'object') {
    const resultObj = result as any
    if (resultObj.targetAgent) {
      targetAgent = getAgentDisplayName(resultObj.targetAgent)
    }
  }

  const hasDetails = Boolean(input || result)

  const modalContent = mounted && (
    <AnimatePresence>
      {isModalOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            className="fixed inset-0 z-50 bg-intents-ux-boxHighContrastOverlay-backgroundColor"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={() => setIsModalOpen(false)}
          />

          {/* Modal Container */}
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            onClick={() => setIsModalOpen(false)}
          >
            <motion.div
              className="max-w-2xl w-full bg-intents-ux-box-backgroundColor p-6 rounded-lg shadow-xl relative max-h-[80vh] flex flex-col"
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              transition={{ type: 'tween', duration: 0.2, ease: 'easeOut' }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Close button */}
              <div className="absolute top-3 right-3">
                <Button
                  onClick={() => setIsModalOpen(false)}
                  icon={<XThickIcon className="h-6 w-6" />}
                  design="control"
                  aria-label="Close"
                  size="sm"
                />
              </div>

              {/* Title */}
              <h2 className="text-xl font-bold mb-4">Handoff to {targetAgent}</h2>

              {/* Content area with scroll */}
              <div className="flex-1 overflow-y-auto space-y-4">
                {/* Arguments */}
                {input && typeof input === 'object' && (
                  <KeyValueTable data={input as Record<string, any>} title="Arguments" />
                )}

                {/* Results */}
                {result && typeof result === 'object' && (
                  <KeyValueTable data={result as Record<string, any>} title="Result" />
                )}
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  )

  return (
    <div className="-my-2">
      <span className="text-gray-300 text-xs">
        {/* Robot icon (grayscale) */}
        <span className="text-gray-400">🤖</span>
        {' '}
        {toolStatus === 'completed' && hasDetails ? (
          <button
            onClick={() => setIsModalOpen(true)}
            className="text-gray-300 hover:text-gray-400 hover:underline cursor-pointer"
          >
            Now talking with {targetAgent}
          </button>
        ) : (
          <span>
            Now talking with {targetAgent}
          </span>
        )}
        {statusIndicator && (
          <span className="inline-flex ml-1.5 text-gray-300">
            {statusIndicator}
          </span>
        )}
      </span>
      {mounted && createPortal(modalContent, document.body)}
    </div>
  )
}

