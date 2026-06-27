'use client'

import { Check, Circle, GitBranch, Loader2, Lock, SkipForward, XCircle } from 'lucide-react'

import { useToolDetailsModal } from '@/stores/useToolDetailsModalStore'
import type { DefaultToolRendererProps } from './DefaultToolRenderer'
import KeyValueTable from './KeyValueTable'
import ToolHeader from './ToolHeader'
import ToolModal from './ToolModal'

interface WorkflowStep {
  id: string
  title: string
  type: string
  status: string
  dependsOn: string[]
  ownedFiles: string[]
  verify?: Array<{ kind: string; spec: string }>
  gate?: { prompt: string; satisfaction?: unknown }
  commitHash?: string
  assignedBuilder?: string
}

interface WorkflowState {
  schemaVersion: number
  appId: string
  archetype: string
  northStar: { goals: string[]; audience: string; voice: string }
  steps: WorkflowStep[]
}

interface InitInput {
  operation: 'init'
  archetype: string
  northStar: { goals: string[]; audience: string; voice: string }
  steps: WorkflowStep[]
}

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case 'done': return <Check className="w-3 h-3 text-green-500" />
    case 'in_progress': return <Loader2 className="w-3 h-3 text-blue-500 animate-spin" />
    case 'failed': return <XCircle className="w-3 h-3 text-red-500" />
    case 'skipped': return <SkipForward className="w-3 h-3 text-gray-400" />
    case 'blocked': return <Lock className="w-3 h-3 text-yellow-500" />
    default: return <Circle className="w-3 h-3 text-gray-300" />
  }
}

function StepList({ steps, showDetails }: { steps: WorkflowStep[]; showDetails?: boolean }) {
  return (
    <div className="space-y-1">
      {steps.map((step: WorkflowStep) => (
        <div key={step.id} className="text-xs py-0.5">
          <div className="flex items-start gap-2">
            <StatusIcon status={step.status} />
            <div className="flex-1 min-w-0">
              <span className="font-medium">{step.title}</span>
              <span className="text-foreground/40 ml-1">({step.id})</span>
              {step.type === 'gate' && <span className="text-yellow-600 ml-1">[gate]</span>}
              {step.assignedBuilder && (
                <span className="text-blue-500 ml-1">→ {step.assignedBuilder}</span>
              )}
              {step.commitHash && (
                <span className="text-green-600 ml-1 font-mono">{step.commitHash.substring(0, 7)}</span>
              )}
            </div>
          </div>
          {showDetails && (
            <div className="ml-5 mt-0.5 space-y-0.5 text-foreground/40">
              {step.dependsOn.length > 0 && (
                <div>deps: {step.dependsOn.join(', ')}</div>
              )}
              {step.ownedFiles.length > 0 && (
                <div>files: {step.ownedFiles.join(', ')}</div>
              )}
              {step.verify && step.verify.length > 0 && (
                <div>verify: {step.verify.map((v: { kind: string; spec: string }) => `${v.kind}(${v.spec})`).join(', ')}</div>
              )}
              {step.gate && (
                <div>gate: &quot;{step.gate.prompt}&quot;</div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

function NorthStarSection({ northStar }: { northStar: WorkflowState['northStar'] }) {
  return (
    <div className="text-xs space-y-1 p-2 bg-muted/50 rounded">
      <div className="font-medium text-foreground/70">North Star</div>
      <div><span className="text-foreground/50">Audience:</span> {northStar.audience}</div>
      <div><span className="text-foreground/50">Voice:</span> {northStar.voice}</div>
      <div><span className="text-foreground/50">Goals:</span> {northStar.goals.join(', ')}</div>
    </div>
  )
}

function tryParseState(result: unknown): WorkflowState | null {
  if (!result) return null
  const str: string = typeof result === 'string' ? result : ''
  if (!str) return null
  try {
    const parsed: unknown = JSON.parse(str)
    if (parsed && typeof parsed === 'object' && 'schemaVersion' in (parsed as Record<string, unknown>) && 'steps' in (parsed as Record<string, unknown>)) {
      return parsed as WorkflowState
    }
  } catch { /* not JSON state */ }
  return null
}

function tryParseSteps(result: unknown): WorkflowStep[] | null {
  if (!result) return null
  const str: string = typeof result === 'string' ? result : ''
  if (!str) return null
  try {
    const parsed: unknown = JSON.parse(str)
    if (Array.isArray(parsed) && parsed.length > 0 && 'id' in (parsed[0] as Record<string, unknown>)) {
      return parsed as WorkflowStep[]
    }
  } catch { /* not JSON steps */ }
  return null
}

function isInitInput(input: unknown): input is InitInput {
  if (!input || typeof input !== 'object') return false
  const obj: Record<string, unknown> = input as Record<string, unknown>
  return obj.operation === 'init' && Array.isArray(obj.steps) && obj.northStar != null
}

export default function WorkflowToolRenderer({
  toolName: _toolName,
  toolStatus,
  toolId,
  input,
  result,
}: DefaultToolRendererProps) {
  const [isModalOpen, setIsModalOpen] = useToolDetailsModal(toolId)
  const operation: string = (input && typeof input === 'object' && (input as Record<string, unknown>).operation as string) || 'workflow'
  const stepId: string | undefined = (input && typeof input === 'object' && (input as Record<string, unknown>).stepId as string) || undefined

  const displayName: string = stepId
    ? `workflow: ${operation} → ${stepId}`
    : `workflow: ${operation}`

  const hasDetails: boolean = Boolean(input || result)

  const workflowState: WorkflowState | null = tryParseState(result)
  const stepsList: WorkflowStep[] | null = tryParseSteps(result)
  const initInput: InitInput | null = isInitInput(input) ? input : null

  return (
    <div>
      <ToolHeader
        icon={<GitBranch className="w-2 h-2" />}
        displayName={displayName}
        toolStatus={toolStatus}
        hasDetails={hasDetails}
        onOpenModal={() => setIsModalOpen(true)}
      />
      <ToolModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={`Workflow: ${operation}`}
      >
        <div className="flex-1 overflow-y-auto space-y-3 p-1">
          {/* Init operation: show the full plan being created */}
          {initInput && (
            <>
              <div className="text-xs text-foreground/50">
                Archetype: <span className="font-medium text-foreground/70">{initInput.archetype}</span>
                {' · '}
                {initInput.steps.length} steps
              </div>
              <NorthStarSection northStar={initInput.northStar} />
              <div className="font-medium text-xs text-foreground/70">Step Plan</div>
              <StepList steps={initInput.steps} showDetails={true} />
              {result && typeof result === 'string' && (
                <div className="text-xs font-mono whitespace-pre-wrap p-2 bg-muted rounded mt-2">
                  {result}
                </div>
              )}
            </>
          )}

          {/* get_state result: full workflow state */}
          {workflowState && !initInput && (
            <>
              <div className="text-xs text-foreground/50">
                Archetype: <span className="font-medium text-foreground/70">{workflowState.archetype}</span>
                {' · '}
                {workflowState.steps.filter((s: WorkflowStep) => s.status === 'done').length}/{workflowState.steps.length} done
              </div>
              <NorthStarSection northStar={workflowState.northStar} />
              <div className="font-medium text-xs text-foreground/70">Steps</div>
              <StepList steps={workflowState.steps} />
            </>
          )}

          {/* next_actions or other step arrays */}
          {stepsList && !workflowState && !initInput && (
            <>
              <div className="font-medium text-xs text-foreground/70">
                {operation === 'next_actions' ? 'Eligible Steps' : 'Steps'}
              </div>
              <StepList steps={stepsList} showDetails={true} />
            </>
          )}

          {/* Fallback for other operations */}
          {!workflowState && !stepsList && !initInput && (
            <>
              {input && typeof input === 'object' && (
                <KeyValueTable data={input as Record<string, unknown>} title="Input" />
              )}
              {result && typeof result === 'string' && (
                <div className="text-xs font-mono whitespace-pre-wrap p-2 bg-muted rounded">
                  {result}
                </div>
              )}
              {result && typeof result === 'object' && (
                <KeyValueTable data={result as Record<string, unknown>} title="Result" />
              )}
            </>
          )}
        </div>
      </ToolModal>
    </div>
  )
}
