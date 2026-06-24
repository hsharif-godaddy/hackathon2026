'use client'

import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { type ComponentProps, useMemo } from 'react'
import { FloatingFooter } from '@airo-ux/pattern-library/surfaces/floating-footer'

import ChatInput from '@/app/[market]/develop/components/chat/ChatInput'
import DesignKitSelectorPanel from '@/app/[market]/develop/components/chat/DesignKitSelectorPanel'
import type { ActiveSecretsRequest } from '@/app/[market]/develop/components/chat/secrets/types'
import SecretsComposerSurface from '@/app/[market]/develop/components/chat/SecretsComposerSurface'
import type { ActiveDesignKitSuggest } from '@/app/[market]/develop/components/utils/findLatestDesignKitSuggest'
import { cn } from '@/lib/utils'

const COMPOSER_SLOT_EASE = [0.4, 0, 0.2, 1] as const

export interface ChatComposerSlotProps extends ComponentProps<typeof ChatInput> {
  secretsComposer: ActiveSecretsRequest | null
  secretsComposerConversationId?: string
  /** Design-kit vibe picker (AIROBUILD-2854). When set, the picker takes over the
   *  composer — hiding the chat input the same way an askQuestion does — so the turn
   *  reads as a stop-to-ask. */
  designKitSuggest: ActiveDesignKitSuggest | null
}

export default function ChatComposerSlot({
  secretsComposer,
  secretsComposerConversationId,
  designKitSuggest,
  ...chatInputProps
}: ChatComposerSlotProps) {
  const prefersReducedMotion = useReducedMotion()
  const composerSlotMotion = useMemo(
    function computeComposerSlotMotion() {
      return prefersReducedMotion
        ? {
            animate: { opacity: 1 },
            exit: { opacity: 0 },
            initial: { opacity: 0 },
            transition: { duration: 0.01 },
          }
        : {
            animate: { opacity: 1, y: 0 },
            exit: { opacity: 0, transition: { duration: 0.16, ease: COMPOSER_SLOT_EASE }, y: -8 },
            initial: { opacity: 0, y: 10 },
            transition: { duration: 0.22, ease: COMPOSER_SLOT_EASE },
          }
    },
    [prefersReducedMotion],
  )

  return (
    <AnimatePresence mode="wait" initial={false}>
      {secretsComposer ? (
        <motion.div key="secrets-composer" className="w-full" {...composerSlotMotion}>
          <div className="px-2 sm:px-3 md:px-0 mt-1 mt-auto pb-1">
            <div id="tour-chat-input" className="relative">
              <FloatingFooter
                data-chat-composer-card
                data-testid="chat-input-card"
                orientation="vertical"
                className={cn('mb-px focus-within:ring-1 focus-within:ring-ai-light')}
              >
                <SecretsComposerSurface
                  conversationId={secretsComposerConversationId}
                  request={secretsComposer}
                />
              </FloatingFooter>
            </div>
          </div>
        </motion.div>
      ) : designKitSuggest ? (
        <motion.div key="design-kit-picker" className="w-full" {...composerSlotMotion}>
          <div className="px-2 sm:px-3 md:px-0 mt-1 mt-auto pb-1">
            <DesignKitSelectorPanel
              toolCallId={designKitSuggest.toolCallId}
              kits={designKitSuggest.kits}
            />
          </div>
        </motion.div>
      ) : (
        <motion.div key="chat-input" className="w-full" {...composerSlotMotion}>
          <ChatInput {...chatInputProps} />
        </motion.div>
      )}
    </AnimatePresence>
  )
}
