'use client'

import { type ReactElement } from 'react'
import Button from '@ux/button'
import Tag from '@ux/tag'

import { SWITCHBOARD_APPBUILDER_DEBUG_DRAWER, SWITCHBOARD_APPBUILDER_SSE_TRANSPORT } from '@/config/switchboard-flags'
import { useSwitchboard } from '@/hooks/useSwitchboard'
import { useStreamingConversationStore, useStreamingState, useWebSocketState } from '@/stores/useStreamingConversationStore'
import { type LLMCallRecord, useDebugStats } from './DebugStatsContext'

function FlaskIcon(): ReactElement {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M9 2.25a.75.75 0 00-.25 1.457v4.159l-6.367 9.207a.757.757 0 00-.037.06c-.592 1.052-.507 2.316-.033 3.294.474.979 1.42 1.823 2.687 1.823h14c1.267 0 2.213-.844 2.688-1.823.473-.978.558-2.242-.034-3.295a.795.795 0 00-.037-.059L15.25 7.866V3.707A.75.75 0 0015 2.25zm1.25 5.85V3.75h3.5V8.1a.75.75 0 00.133.427l2.575 3.723H7.542l2.575-3.723a.75.75 0 00.133-.427z"
      />
    </svg>
  )
}

function abbreviateModel(modelName: string): string {
  if (modelName.includes('opus-4-7')) return 'Op4.7'
  if (modelName.includes('opus-4-6')) return 'Op4.6'
  if (modelName.includes('sonnet-4-6')) return 'So4.6'
  if (modelName.includes('sonnet-4-5')) return 'So4.5'
  if (modelName.includes('haiku-4-5')) return 'Ha4.5'
  if (modelName.includes('haiku-4')) return 'Ha4'
  if (modelName.includes('gpt-4o')) return 'G4o'
  if (modelName.includes('gpt-4')) return 'G4'
  return modelName.slice(0, 5)
}

function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`
  return String(n)
}

function CallRow({ call }: { call: LLMCallRecord }): ReactElement {
  const cachePercent = Math.round(call.cacheHitRate * 100)
  return (
    <tr className="border-b border-border/50 last:border-0">
      <td className="py-0.5 pr-2 truncate max-w-[72px]">{call.agentName}</td>
      <td className="py-0.5 pr-2">{abbreviateModel(call.modelName)}</td>
      <td className="py-0.5 pr-2 text-right">{call.steps ?? '—'}</td>
      <td className="py-0.5 pr-2 text-right">{formatTokens(call.inputTokens)}/{formatTokens(call.outputTokens)}</td>
      <td className="py-0.5 pr-2 text-right">{cachePercent}%</td>
      <td className="py-0.5 text-right">${call.costUsd.toFixed(4)}</td>
    </tr>
  )
}

export function DebugStatsToggleButton(): ReactElement | null {
  const enabled = useSwitchboard(SWITCHBOARD_APPBUILDER_DEBUG_DRAWER)
  const { open, setOpen } = useDebugStats()

  if (!enabled) return null

  return (
    <Button
      type="button"
      design="tertiary"
      size="sm"
      active={open}
      aria-label={open ? 'Close debug stats' : 'Open debug stats'}
      data-testid="debug-stats-toggle"
      icon={<FlaskIcon />}
      onClick={() => setOpen(!open)}
    />
  )
}

export function DebugStatsPanel(): ReactElement | null {
  const enabled = useSwitchboard(SWITCHBOARD_APPBUILDER_DEBUG_DRAWER)
  const { state, dispatch, open, setOpen } = useDebugStats()
  const sseFlag = useSwitchboard(SWITCHBOARD_APPBUILDER_SSE_TRANSPORT)
  const wsState = useWebSocketState()
  const retryState = useStreamingConversationStore((s) => s.retryState)
  const streamingState = useStreamingState()

  if (!enabled || !open) return null

  const transport = sseFlag === true ? 'SSE' : 'WS'
  const totalCost = state.calls.reduce((sum, c) => sum + c.costUsd, 0)

  return (
    <div
      data-testid="debug-stats-panel"
      className="absolute inset-x-2 bottom-2 h-4/5 z-40 bg-intents-ux-box-backgroundColor shadow-md rounded-lg flex flex-col p-3 overflow-hidden text-[10px] font-mono"
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold font-sans">Debug stats</span>
        <button
          type="button"
          aria-label="Close debug stats"
          className="text-[10px] text-muted-foreground hover:text-foreground font-sans"
          onClick={() => setOpen(false)}
        >
          Close
        </button>
      </div>

      <section className="mb-2 flex flex-wrap items-center gap-1" data-testid="debug-stats-connection-info">
        <Tag size="sm" emphasis={transport === 'SSE' ? 'info' : 'highlight'} data-testid="debug-stats-transport-badge">
          {transport}
        </Tag>
        <Tag size="sm" emphasis={wsState.connected ? 'success' : 'critical'}>
          {wsState.connected ? 'connected' : wsState.status}
        </Tag>
        {streamingState !== 'idle' && (
          <Tag size="sm" emphasis="warning">
            {streamingState}
          </Tag>
        )}
        {retryState.isRetrying && (
          <Tag size="sm" emphasis="critical">
            {`retry #${retryState.retryCount}`}
          </Tag>
        )}
      </section>

      <div className="flex-1 overflow-auto min-h-0">
        {state.calls.length === 0 ? (
          <div className="text-muted-foreground text-center py-4 font-sans text-xs">No LLM calls yet</div>
        ) : (
          <table className="w-full tabular-nums">
            <thead className="sticky top-0 bg-intents-ux-box-backgroundColor">
              <tr className="border-b border-border text-muted-foreground text-left">
                <th className="py-0.5 pr-2 font-medium">Agent</th>
                <th className="py-0.5 pr-2 font-medium">Model</th>
                <th className="py-0.5 pr-2 font-medium text-right">Turns</th>
                <th className="py-0.5 pr-2 font-medium text-right">In/Out</th>
                <th className="py-0.5 pr-2 font-medium text-right">Cache</th>
                <th className="py-0.5 font-medium text-right">Cost</th>
              </tr>
            </thead>
            <tbody>
              {state.calls.map((call, i) => (
                <CallRow key={`${call.timestamp}-${i}`} call={call} />
              ))}
            </tbody>
          </table>
        )}
      </div>

      <footer className="mt-2 flex items-center justify-between gap-2 pt-2 border-t border-border">
        <span className="font-semibold tabular-nums">
          Total: ${totalCost.toFixed(4)}
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground font-sans"
            onClick={() => dispatch({ type: 'CLEAR' })}
          >
            Clear
          </button>
          <button
            type="button"
            aria-label="Close debug stats"
            data-testid="debug-stats-close-footer"
            className="px-2 py-0.5 rounded border border-border text-foreground hover:bg-muted font-sans"
            onClick={() => setOpen(false)}
          >
            Close
          </button>
        </div>
      </footer>
    </div>
  )
}
