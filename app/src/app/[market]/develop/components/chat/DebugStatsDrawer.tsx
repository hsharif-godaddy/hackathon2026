'use client'

import { type ReactElement } from 'react'
import Button from '@ux/button'
import Tag from '@ux/tag'

import { SWITCHBOARD_APPBUILDER_DEBUG_DRAWER, SWITCHBOARD_APPBUILDER_SSE_TRANSPORT } from '@/config/switchboard-flags'
import { useSwitchboard } from '@/hooks/useSwitchboard'
import { useStreamingConversationStore, useStreamingState, useWebSocketState } from '@/stores/useStreamingConversationStore'
import CostSparkline from './CostSparkline'
import { useDebugStats } from './DebugStatsContext'

/**
 * Flask glyph rendered inline as SVG. Avoids the @ux/icon CSS-variable
 * indirection so the icon always renders without a separate CSS registration.
 * Path data taken from @ux/icon/experiment-filled.
 */
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

/**
 * Inline toggle button. Designed to be rendered alongside other action buttons
 * in the chat input action row (e.g. next to the attachment "+"). Renders
 * nothing when the switchboard flag is off.
 */
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

/**
 * Full-cover panel rendered as an absolute overlay inside its nearest
 * relatively-positioned ancestor. Mount this at the top level of the chat
 * tab so it covers messages + input when open. Renders nothing when closed
 * or when the switchboard flag is off.
 */
export function DebugStatsPanel(): ReactElement | null {
  const enabled = useSwitchboard(SWITCHBOARD_APPBUILDER_DEBUG_DRAWER)
  const { state, dispatch, open, setOpen } = useDebugStats()
  const sseFlag = useSwitchboard(SWITCHBOARD_APPBUILDER_SSE_TRANSPORT)
  const wsState = useWebSocketState()
  const retryState = useStreamingConversationStore((s) => s.retryState)
  const streamingState = useStreamingState()

  if (!enabled || !open) return null

  const transport = sseFlag === true ? 'SSE' : 'WS'
  const last = state.history[state.history.length - 1]
  const costValues = state.history.map((h) => h.costUsd)
  const cacheHitValues = state.history.map((h) => h.cacheHitRate)
  const truncate = (s: string): string => (s.length > 12 ? `${s.slice(0, 6)}…${s.slice(-4)}` : s)

  return (
    <div
      data-testid="debug-stats-panel"
      className="absolute inset-x-2 bottom-2 h-4/5 z-40 bg-intents-ux-box-backgroundColor shadow-md rounded-lg flex flex-col p-3 overflow-auto text-sm"
    >
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-semibold">Debug stats</span>
        <button
          type="button"
          aria-label="Close debug stats"
          className="text-xs text-muted-foreground hover:text-foreground"
          onClick={() => setOpen(false)}
        >
          Close
        </button>
      </div>

      <section className="mb-3" data-testid="debug-stats-connection-info">
        <div className="text-xs text-muted-foreground mb-1">Connection</div>
        <div className="flex flex-wrap items-center gap-2">
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
        </div>
      </section>

      <section className="mb-3">
        <div className="text-xs text-muted-foreground">Last prompt</div>
        {last ? (
          <>
            <div className="text-3xl font-semibold tabular-nums" data-testid="debug-stats-last-cost">
              ${last.costUsd.toFixed(4)}
            </div>
            <div className="text-xs text-muted-foreground tabular-nums">
              {last.inputTokens} in / {last.outputTokens} out tokens
            </div>
            <div className="text-xs text-muted-foreground">model: {last.modelName}</div>
          </>
        ) : (
          <div className="text-xs text-muted-foreground">no data yet</div>
        )}
      </section>

      {costValues.length > 0 && (
        <section className="mb-3">
          <div className="text-xs text-muted-foreground mb-1">Cost per prompt</div>
          <CostSparkline values={costValues} width={280} height={48} />
        </section>
      )}

      {cacheHitValues.length > 0 && (
        <section className="mb-3">
          <div className="text-xs text-muted-foreground mb-1">Cache hit rate per prompt</div>
          <CostSparkline
            values={cacheHitValues}
            width={280}
            height={48}
            maxOverride={1}
            ariaLabel="cache hit rate per prompt"
            formatValue={(v) => `${Math.round(v * 100)}%`}
          />
        </section>
      )}

      {last && (
        <section className="mb-3">
          <div className="text-xs text-muted-foreground">Cache</div>
          <div className="text-xs tabular-nums">
            hit rate: {Math.round(last.cacheHitRate * 100)}% · writes: {last.cacheWriteInputTokens} tokens
          </div>
        </section>
      )}

      <footer className="mt-auto flex items-center justify-between gap-2 pt-2 border-t border-border">
        <button
          type="button"
          className="text-xs text-muted-foreground hover:text-foreground"
          onClick={() => dispatch({ type: 'CLEAR' })}
        >
          Clear history
        </button>
        {last && (
          <span className="flex-1 truncate text-center text-[10px] font-mono text-muted-foreground">
            {truncate(last.conversationId)}
          </span>
        )}
        <button
          type="button"
          aria-label="Close debug stats"
          data-testid="debug-stats-close-footer"
          className="px-3 py-1 rounded-md border border-border text-xs text-foreground hover:bg-muted"
          onClick={() => setOpen(false)}
        >
          Close
        </button>
      </footer>
    </div>
  )
}
