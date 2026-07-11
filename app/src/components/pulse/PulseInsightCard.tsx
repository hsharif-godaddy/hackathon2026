'use client'

import { useEffect } from 'react'
import Box from '@ux/box'
import Button from '@ux/button'

import { ChatTab } from '@/app/[market]/develop/components/types'
import { useChatContext } from '@/contexts/ChatContext'
import { useChatTabs } from '@/hooks/useChatTabs'
import { isFeatureEnabled } from '@/lib/features'
import type { PulseInsight } from '@/lib/pulse/types'
import { useStreamingConversationStore } from '@/stores/useStreamingConversationStore'

interface PulseInsightCardProps {
  insight: PulseInsight
  onDismiss: () => void
}

function broadcastToPreview(type: string): void {
  document.querySelectorAll('iframe').forEach((iframe) => {
    try {
      iframe.contentWindow?.postMessage({ type }, '*')
    } catch {
      // cross-origin iframe — ignore
    }
  })
}

const MOCK_AI_RESPONSES: Record<string, Record<string, string>> = {
  no_social_proof: {
    'Testimonials section': "Done! I've added a testimonials section with 3 five-star customer reviews right below your hero. Social proof like this typically lifts conversion rates by 15–30%. Ready to publish?",
    'Star rating badge': "Done! I've added a ⭐ 4.9/5 rating badge right next to your 'Shop All Candles' button. Shoppers see the trust signal the instant they land — that alone can boost click-through by 20%+. Ready to publish?",
  },
  cta_buried: {
    'CTA in hero': "Done! I've moved the 'Order Now' button right into the hero section so it's the first thing visitors see. No more scrolling required — this alone can double your click-through rate. Ready to publish?",
    'Sticky button': "Done! I've added a sticky 'Order Now' button that stays visible the whole time visitors scroll through your story. Wherever they are on the page, they're one click from ordering. Ready to publish?",
  },
  contact_hidden: {
    'Simplify form': "Done! I've simplified your contact form to just name and phone number and moved it above the fold. Less friction means more inquiries. Ready to publish?",
    'Move form higher': "Done! I've added a prominent 'Call Us Now' button right below your hero section. Visitors can reach you in one tap — no scrolling, no form to fill. Ready to publish?",
  },
}

function getMockAiResponse(problemType: string, variantLabel: string): string {
  return MOCK_AI_RESPONSES[problemType]?.[variantLabel] ?? "Done! The fix has been applied to your site. Ready to publish?"
}

export function PulseInsightCard({ insight, onDismiss }: PulseInsightCardProps) {
  const { sendMessage } = useChatContext()
  const { setActiveChatTab } = useChatTabs()

  useEffect(() => {
    broadcastToPreview('pulse_scroll_preview')
  }, [])

  const handleFix = (): void => {
    broadcastToPreview('pulse_show_variants')
    setActiveChatTab(ChatTab.CHAT)
    onDismiss()

    if (isFeatureEnabled.mockLogin()) {
      const handleVariantSelected = (event: MessageEvent): void => {
        if (!event.data || event.data.type !== 'pulse_variant_selected') return
        window.removeEventListener('message', handleVariantSelected)

        const variantLabel: string = typeof event.data.label === 'string' ? event.data.label : insight.suggestedFix
        const now: Date = new Date()
        const userId: string = `mock_user_${Date.now()}`
        const aiId: string = `mock_ai_${Date.now()}`

        useStreamingConversationStore.getState().addCompletedMessage({
          id: userId,
          role: 'user',
          content: `Apply "${variantLabel}"`,
          timestamp: now,
        })

        useStreamingConversationStore.setState({
          activeStream: {
            id: aiId,
            role: 'assistant',
            content: '',
            segments: [],
            toolCalls: [],
            timestamp: now,
            isComplete: false,
          },
          streamingState: 'streaming',
          isLoading: true,
        })

        setTimeout(() => {
          useStreamingConversationStore.setState({
            activeStream: null,
            streamingState: 'idle',
            isLoading: false,
          })
          useStreamingConversationStore.getState().addCompletedMessage({
            id: aiId,
            role: 'assistant',
            content: getMockAiResponse(insight.problemType, variantLabel),
            timestamp: new Date(),
          })
          broadcastToPreview('pulse_highlight')
        }, 5000)
      }

      window.addEventListener('message', handleVariantSelected)
      return
    }

    // Real mode: send via SSE transport
    void sendMessage({
      content: `Fix it: ${insight.suggestedFix}`,
      customContext: {
        type: 'pulse_insight',
        data: insight,
        persistence: 'ephemeral',
      },
    })
  }

  const problemLabels: Record<string, string> = {
    cta_buried: 'CTA placement',
    contact_hidden: 'Contact friction',
    no_social_proof: 'No social proof',
  }

  const label: string = problemLabels[insight.problemType] ?? 'Site insight'

  return (
    <Box
      className="w-80 rounded-xl p-4 shadow-lg"
      style={{ background: 'var(--ux-color-surface-raised, #fff)', border: '1px solid var(--ux-color-border-default, #e5e7eb)' }}
    >
      <div className="mb-2 flex items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--ux-color-text-subtle, #6b7280)' }}>
          ⚡ Pulse · {label}
        </span>
      </div>

      <p className="mb-1 text-sm font-semibold leading-snug" style={{ color: 'var(--ux-color-text-primary, #111827)' }}>
        {insight.headline}
      </p>

      <p className="mb-4 text-sm leading-relaxed" style={{ color: 'var(--ux-color-text-secondary, #374151)' }}>
        {insight.description}
      </p>

      <p className="mb-4 rounded-lg px-3 py-2 text-xs" style={{ background: 'var(--ux-color-surface-default, #f9fafb)', color: 'var(--ux-color-text-secondary, #374151)', border: '1px solid var(--ux-color-border-default, #e5e7eb)' }}>
        <span className="font-medium">Suggested fix: </span>
        {insight.suggestedFix}
      </p>

      <Box orientation="horizontal" gap="sm" inlineAlignChildren="end">
        <Button
          design="tertiary"
          size="small"
          onClick={onDismiss}
        >
          Not now
        </Button>
        <Button
          design="primary"
          size="small"
          onClick={handleFix}
        >
          Fix it
        </Button>
      </Box>
    </Box>
  )
}
