'use client'

import Box from '@ux/box'
import Button from '@ux/button'

import { ChatTab } from '@/app/[market]/develop/components/types'
import { useChatContext } from '@/contexts/ChatContext'
import { useChatTabs } from '@/hooks/useChatTabs'
import type { PulseInsight } from '@/lib/pulse/types'

interface PulseInsightCardProps {
  insight: PulseInsight
  onDismiss: () => void
}

function broadcastPulseFixToPreview(): void {
  document.querySelectorAll('iframe').forEach((iframe) => {
    try {
      iframe.contentWindow?.postMessage({ type: 'pulse_fix' }, '*')
    } catch {
      // cross-origin iframe — ignore
    }
  })
}

export function PulseInsightCard({ insight, onDismiss }: PulseInsightCardProps) {
  const { sendMessage } = useChatContext()
  const { setActiveChatTab } = useChatTabs()

  const handleFix = (): void => {
    // Instantly reveal testimonials in the preview iframe (demo: static HTML toggle)
    broadcastPulseFixToPreview()

    // Switch to chat so the user sees the agent working, then close the card
    setActiveChatTab(ChatTab.CHAT)
    onDismiss()

    // Send the agent message in the background — it modifies real workspace files
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
