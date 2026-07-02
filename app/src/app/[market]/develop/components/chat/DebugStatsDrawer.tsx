'use client'

import { type ReactElement,useState } from 'react'
import { FloatingPanel } from '@airo-ux/pattern-library/surfaces/floating-panel'
import Button from '@ux/button'
import Tag from '@ux/tag'

import { SWITCHBOARD_APPBUILDER_DEBUG_DRAWER } from '@/config/switchboard-flags'
import { useSwitchboard } from '@/hooks/useSwitchboard'
import { useConnectionState, useStreamingState } from '@/stores/useStreamingConversationStore'
import { useWorkflowArchetype, useWorkflowSteps, type WorkflowProgressStep } from '@/stores/useWorkflowProgressStore'
import { type LLMCallRecord, useDebugStats } from './DebugStatsContext'

type DebugTab = 'stats' | 'workflow' | 'settings'

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
  if (modelName.includes('sora')) return 'Sora2'
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
  const cachePercent: number = Math.round(call.cacheHitRate * 100)
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

const STATUS_LABELS: Record<string, { label: string; emphasis: 'success' | 'critical' | 'warning' | 'neutral' }> = {
  done: { label: 'done', emphasis: 'success' },
  skipped: { label: 'skipped', emphasis: 'neutral' },
  in_progress: { label: 'active', emphasis: 'warning' },
  failed: { label: 'failed', emphasis: 'critical' },
  blocked: { label: 'blocked', emphasis: 'warning' },
  pending: { label: 'pending', emphasis: 'neutral' },
}

function WorkflowStepRow({ step }: { step: WorkflowProgressStep }): ReactElement {
  const statusInfo = STATUS_LABELS[step.status] ?? { label: step.status, emphasis: 'neutral' as const }
  return (
    <tr className="border-b border-border/50 last:border-0">
      <td className="py-0.5 pr-2">
        <Tag size="sm" emphasis={statusInfo.emphasis}>{statusInfo.label}</Tag>
      </td>
      <td className="py-0.5 pr-2 truncate max-w-[140px]">{step.title}</td>
      <td className="py-0.5 pr-2 text-muted-foreground">{step.type}</td>
      <td className="py-0.5 text-muted-foreground truncate max-w-[80px]">{step.assignedBuilder ?? '—'}</td>
    </tr>
  )
}

function StatsTab({ state, connectionState, streamingState }: {
  state: { calls: LLMCallRecord[] }
  connectionState: { connected: boolean; status: string }
  streamingState: string
}): ReactElement {
  return (
    <div className="text-[10px] font-mono">
      <section className="mb-2 flex flex-wrap items-center gap-1" data-testid="debug-stats-connection-info">
        <Tag size="sm" emphasis={connectionState.connected ? 'success' : 'critical'}>
          {connectionState.connected ? 'connected' : connectionState.status}
        </Tag>
        {streamingState !== 'idle' && (
          <Tag size="sm" emphasis="warning">
            {streamingState}
          </Tag>
        )}
      </section>

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
            {state.calls.map((call: LLMCallRecord, i: number) => (
              <CallRow key={`${call.timestamp}-${i}`} call={call} />
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

function WorkflowTab(): ReactElement {
  const steps: WorkflowProgressStep[] = useWorkflowSteps()
  const archetype: string | null = useWorkflowArchetype()

  if (steps.length === 0) {
    return (
      <div className="text-muted-foreground text-center py-4 font-sans text-xs">No workflow active</div>
    )
  }

  const doneCount: number = steps.filter((s: WorkflowProgressStep) => s.status === 'done' || s.status === 'skipped').length
  const inProgressCount: number = steps.filter((s: WorkflowProgressStep) => s.status === 'in_progress').length
  const failedCount: number = steps.filter((s: WorkflowProgressStep) => s.status === 'failed').length

  return (
    <div className="text-[10px] font-mono">
      <section className="mb-2 flex flex-wrap items-center gap-1">
        {archetype && <Tag size="sm" emphasis="neutral">{archetype}</Tag>}
        <Tag size="sm" emphasis="success">{`${doneCount} done`}</Tag>
        {inProgressCount > 0 && <Tag size="sm" emphasis="warning">{`${inProgressCount} active`}</Tag>}
        {failedCount > 0 && <Tag size="sm" emphasis="critical">{`${failedCount} failed`}</Tag>}
        <span className="text-muted-foreground ml-auto">{doneCount}/{steps.length}</span>
      </section>

      <table className="w-full tabular-nums">
        <thead className="sticky top-0 bg-intents-ux-box-backgroundColor">
          <tr className="border-b border-border text-muted-foreground text-left">
            <th className="py-0.5 pr-2 font-medium">Status</th>
            <th className="py-0.5 pr-2 font-medium">Step</th>
            <th className="py-0.5 pr-2 font-medium">Type</th>
            <th className="py-0.5 font-medium">Builder</th>
          </tr>
        </thead>
        <tbody>
          {steps.map((step: WorkflowProgressStep) => (
            <WorkflowStepRow key={step.id} step={step} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function DebugStatsToggleButton(): ReactElement | null {
  const enabled: boolean | undefined = useSwitchboard(SWITCHBOARD_APPBUILDER_DEBUG_DRAWER)
  const { open, setOpen, hidden } = useDebugStats()

  if (!enabled || hidden) return null

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
  const enabled: boolean | undefined = useSwitchboard(SWITCHBOARD_APPBUILDER_DEBUG_DRAWER)
  const { state, dispatch, open, setOpen, hidden, setHidden, showToolCalls, setShowToolCalls } = useDebugStats()
  const connectionState = useConnectionState()
  const streamingState = useStreamingState()
  const [activeTab, setActiveTab] = useState<DebugTab>('stats')

  if (!enabled) return null

  const totalCost: number = state.calls.reduce((sum: number, c: LLMCallRecord) => sum + c.costUsd, 0)

  return (
    <FloatingPanel
      show={open}
      onClose={() => setOpen(false)}
      title="Debug"
      data-testid="debug-stats-panel"
      defaultSize={{ width: 380, height: 480 }}
      defaultPosition={{ x: 24, y: 96 }}
      footer={
        <div className="flex items-center justify-between gap-2 text-[10px] font-mono">
          <span className="font-semibold tabular-nums">Total: ${totalCost.toFixed(4)}</span>
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground font-sans"
            onClick={() => dispatch({ type: 'CLEAR' })}
          >
            Clear
          </button>
        </div>
      }
    >
      <div className="flex flex-col h-full">
        {/* Tab bar */}
        <div className="flex border-b border-border mb-2 shrink-0">
          <button
            type="button"
            className={`px-3 py-1 text-xs font-medium transition-colors ${
              activeTab === 'stats'
                ? 'border-b-2 border-current text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
            onClick={() => setActiveTab('stats')}
          >
            Stats
          </button>
          <button
            type="button"
            className={`px-3 py-1 text-xs font-medium transition-colors ${
              activeTab === 'workflow'
                ? 'border-b-2 border-current text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
            onClick={() => setActiveTab('workflow')}
          >
            Workflow
          </button>
          <button
            type="button"
            className={`px-3 py-1 text-xs font-medium transition-colors ${
              activeTab === 'settings'
                ? 'border-b-2 border-current text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
            onClick={() => setActiveTab('settings')}
          >
            Settings
          </button>
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto">
          {activeTab === 'stats' && (
            <StatsTab state={state} connectionState={connectionState} streamingState={streamingState} />
          )}
          {activeTab === 'workflow' && <WorkflowTab />}
          {activeTab === 'settings' && (
            <div className="flex flex-col gap-3 px-1 py-2">
              <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                <input
                  type="checkbox"
                  checked={showToolCalls}
                  onChange={(e) => setShowToolCalls(e.target.checked)}
                  className="accent-current"
                />
                Show tool calls in chat
              </label>
              <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                <input
                  type="checkbox"
                  checked={hidden}
                  onChange={(e) => setHidden(e.target.checked)}
                  className="accent-current"
                />
                Hide debug button (for screenshots)
              </label>
            </div>
          )}
        </div>
      </div>
    </FloatingPanel>
  )
}
