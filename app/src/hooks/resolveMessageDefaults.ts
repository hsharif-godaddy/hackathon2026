import type { VisualContext } from '@/app/[market]/develop/components/visualContextCapture'
import { captureVisualContext } from '@/app/[market]/develop/components/visualContextCapture'
import { logger } from '@/lib/request-context'

interface ResolvedDefaults {
  modelOverride?: string
  agentProfile?: string
  visualContext: VisualContext | null
}

export async function resolveMessageDefaults(options: {
  modelOverride?: string
  agentProfile?: string
  visualContext?: VisualContext | null
}): Promise<ResolvedDefaults> {
  let visualContext: VisualContext | null = options.visualContext ?? null
  if (options.visualContext === undefined) {
    try {
      visualContext = await captureVisualContext()
    } catch (error) {
      logger.warn('message.visual_context.capture_failed', {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  let resolvedModelOverride = options.modelOverride
  let resolvedProfile = options.agentProfile
  if (resolvedModelOverride === undefined || resolvedProfile === undefined) {
    const { useDevelopPageStore } = await import('@/stores/useDevelopPageStore')
    const state = useDevelopPageStore.getState()
    if (resolvedModelOverride === undefined) resolvedModelOverride = state.selectedModel ?? undefined
    if (resolvedProfile === undefined) resolvedProfile = state.selectedProfile ?? undefined
  }

  return { modelOverride: resolvedModelOverride, agentProfile: resolvedProfile, visualContext }
}
