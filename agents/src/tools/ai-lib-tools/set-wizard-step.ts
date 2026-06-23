import { createTool, type Tool } from '@airo/ai-lib'
import { z } from 'zod'
import { getKvMemoryStore } from '../../memory/adapters/index.js'
import { customerIdFromContext, workspaceScopeFromAppId } from '../../memory/interfaces/scope.js'
import { createForWorkspace } from '../../workspace/index.js'
import { syncBrandTokensCss } from '../../services/design-system/brand-tokens-css.js'
import { Logger } from '../../logging/index.js'
import { getSSERegistry } from '../../server/sse/registry-singleton.js'
import { getEventChannel } from '../../server/agent-runtime.js'

const logger = Logger.create({ component: 'set-wizard-step-tool' })
const memoryStore = getKvMemoryStore()
const MEMORY_KEY = 'brand.wizard.phase'

export const StepSchema = z.object({
  phase: z.enum(['gathering', 'working', 'ready']).describe(
    'Active design-kit wizard phase: gathering=asking core questions and assembling the kit (kit/colors/fonts/keywords/logo); working=brand showcase and build buttons are shown; ready=the website build has completed and the full builder is revealed.',
  ),
})

export const setWizardStepAITool: Tool = createTool(
  'Advance the Design Kit Wizard to a phase and notify the UI. Call this at each transition: "gathering" when you start asking the core questions and assembling the kit; "working" once the kit is assembled (colours, fonts, imagery, logo) so the editing panels and the Build / Create-website buttons appear — the user builds the brand showcase from there. Do not emit "ready" — the UI reveals the full builder on its own when the website build completes.',
  StepSchema,
  async (input, context) => {
    const appId = context?.metadata?.appId as string | undefined
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

    // Entering the working phase: make sure public/brand-tokens.css exists
    // and reflects the current palette + fonts. The showcase links it for its CSS
    // variables (--primary, --background, --font-heading, …); the agent's
    // colorScheme/fontTheme write those to memory but never emit the file, so without
    // this the showcase's /brand-tokens.css 404s and Vite serves the SPA index instead
    // (the variables silently fall back to defaults). Sync BEFORE emitting the phase so
    // the file is in place the moment the iframe loads. Best-effort — never block the
    // phase transition. (User edits via the design-kit panels sync it through their own
    // route; this covers the agent-assembled first load.)
    if (input.phase === 'working') {
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

    try {
      // SSE delivery: publish to each active SSE conversation for this app via
      // the event channel (mirrors the video route's wiring).
      const sseRegistry = getSSERegistry()
      const eventChannel = getEventChannel()
      if (sseRegistry && eventChannel) {
        for (const convId of sseRegistry.getConversationsByApp(appId)) {
          eventChannel.publish(convId, {
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

    logger.info('setWizardStep.success', { appId, phase: input.phase })
    return `Wizard advanced to ${input.phase} phase.`
  },
)
