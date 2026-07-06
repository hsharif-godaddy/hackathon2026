import { createTool, type Tool } from '@airo/ai-lib'
import { type BuilderLayoutDescriptor, designKitLayoutForPhase } from '@airo/shared'
import { z } from 'zod'
import { getKvMemoryStore } from '../../memory/adapters/index.js'
import { customerIdFromContext, workspaceScopeFromAppId } from '../../memory/interfaces/scope.js'
import { createForWorkspace } from '../../workspace/index.js'
import { syncBrandTokensCss } from '../../services/design-system/brand-tokens-css.js'
import { Logger } from '../../logging/index.js'
import { getSSERegistry } from '../../server/sse/registry-singleton.js'
import { getEventChannel } from '../../server/agent-runtime.js'
import { persistBuilderLayout, publishLayoutEvent } from '../../services/builder-layout/update-builder-layout.js'

const logger = Logger.create({ component: 'set-wizard-step-tool' })
const memoryStore = getKvMemoryStore()
const MEMORY_KEY = 'brand.wizard.phase'

export const StepSchema = z.object({
  phase: z.enum(['gathering', 'brand', 'website', 'ready']).describe(
    'Active design-kit wizard phase: gathering=asking core questions and assembling the kit (kit/colors/fonts/keywords/logo); brand=the kit is assembled/finalized and the "Building Your Brand" progress panel is shown; website=the website build is in progress; ready=the website build has completed and the full builder is revealed.',
  ),
})

export const setWizardStepAITool: Tool = createTool(
  'Advance the Design Kit Wizard to a phase and notify the UI. Call this at each transition: "gathering" when you start asking the core questions and assembling the kit; "brand" once the kit is assembled (colours, fonts, imagery, logo) so the "Building Your Brand" progress panel appears while you finalize the brand; "website" when you start creating the website (you fan the homepage and brand-showcase builds out to background sub-agents in parallel — no plan is authored) so the UI shows the "Building your website" state; "ready" once the website build has actually completed (after awaitAgents confirms the builder sub-agents finished) — this reveals the finished site. Emit "ready" only when the build is genuinely done, never during assembly.',
  StepSchema,
  async (input, context) => {
    const appId = typeof context?.metadata?.appId === 'string' ? context.metadata.appId : undefined
    if (!appId) {
      return '**Error:** No app ID available in context'
    }

    const scope = workspaceScopeFromAppId(appId, customerIdFromContext(context))
    const value = { phase: input.phase }

    const writeResult = await memoryStore.set(scope, MEMORY_KEY, value)
    if (!writeResult.success) {
      logger.warn('setWizardStep.write.failed', { appId, error: writeResult.error ?? 'Unknown error' })
      return '**Error:** Failed to save wizard phase. Please try again.'
    }

    // Entering the brand phase: make sure public/brand-tokens.css exists
    // and reflects the current palette + fonts. The showcase links it for its CSS
    // variables (--primary, --background, --font-heading, …); the agent's
    // colorScheme/fontTheme write those to memory but never emit the file, so without
    // this the showcase's /brand-tokens.css 404s and Vite serves the SPA index instead
    // (the variables silently fall back to defaults). Sync BEFORE emitting the phase so
    // the file is in place the moment the iframe loads. Best-effort — never block the
    // phase transition. (User edits via the design-kit panels sync it through their own
    // route; this covers the agent-assembled first load.)
    if (input.phase === 'brand') {
      try {
        const workspace = createForWorkspace(appId, 'preview')
        if (workspace) {
          await syncBrandTokensCss(appId, customerIdFromContext(context), workspace.files)
        }
      } catch (error) {
        logger.warn('setWizardStep.brand_tokens_css.sync_failed', {
          appId,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    const eventData = { phase: input.phase, appId }

    // Persist the durable layout descriptor BEFORE any SSE emit, so a reload/GET between the
    // phase write and the events never reads a stale app_metadata.builderLayout. If the persist
    // FAILS, do NOT publish build_phase — advancing the phase while the layout metadata is stale
    // is the exact inconsistency this ordering exists to prevent.
    const builderLayout: BuilderLayoutDescriptor = designKitLayoutForPhase(true, input.phase)
    try {
      persistBuilderLayout(appId, builderLayout)
    } catch (error) {
      logger.warn('setWizardStep.builder_layout.persist_failed', { appId, error: error instanceof Error ? error.message : String(error) })
      return '**Error:** Failed to save layout state. Please try again.'
    }

    try {
      const sseRegistry = getSSERegistry()
      const eventChannel = getEventChannel()
      if (sseRegistry && eventChannel) {
        for (const convId of sseRegistry.getConversationsByApp(appId)) {
          // Await so build_phase is delivered before the builder_layout event below — the
          // client applies the phase (wizard stepper) before the shell descriptor swaps.
          await eventChannel.publish(convId, {
            conversationId: convId,
            type: 'build_phase',
            content: '',
            data: eventData,
            agentName: 'system',
          })
        }
      }
    } catch (error) {
      logger.warn('setWizardStep.sse_emit.failed', { appId, error: error instanceof Error ? error.message : String(error) })
    }

    try {
      await publishLayoutEvent(appId, builderLayout)
    } catch (error) {
      logger.warn('setWizardStep.builder_layout.emit_failed', { appId, error: error instanceof Error ? error.message : String(error) })
    }

    logger.info('setWizardStep.success', { appId, phase: input.phase })
    return `Wizard advanced to ${input.phase} phase.`
  },
)
