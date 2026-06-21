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
const MEMORY_KEY = 'brand.wizard.step'

export const StepSchema = z.object({
  step: z.number().int().min(1).max(5).describe(
    'Active design-kit wizard step: 1=Understanding, 2=Building your kit, 3=Designing visuals, 4=Brand showcase, 5=Create website.',
  ),
})

export const setWizardStepAITool: Tool = createTool(
  'Advance the Design Kit Wizard to a step (1-5) and notify the UI. Call this at each phase transition: 1 when you start asking questions, 2 when you begin building the kit (kit/colors/fonts/keywords/logo), 3 when the kit is complete and the user can edit, 4 AFTER you have written public/brand-showcase.html (advancing reveals the showcase, so write the file first), 5 when the user asks to create their website.',
  StepSchema,
  async (input, context) => {
    const appId = context?.metadata?.appId as string | undefined
    if (!appId) {
      return '**Error:** No app ID available in context'
    }

    const scope = workspaceScopeFromAppId(appId, customerIdFromContext(context))
    const value = { step: input.step }

    const writeResult = await memoryStore.set(scope, MEMORY_KEY, value)
    if (!writeResult.success) {
      logger.warn('setWizardStep.write.failed', { appId, error: writeResult.error ?? 'Unknown error' })
      return '**Error:** Failed to save wizard step. Please try again.'
    }

    // Revealing the brand showcase (step 4): make sure public/brand-tokens.css exists
    // and reflects the current palette + fonts. The showcase links it for its CSS
    // variables (--primary, --background, --font-heading, …); the agent's
    // colorScheme/fontTheme write those to memory but never emit the file, so without
    // this the showcase's /brand-tokens.css 404s and Vite serves the SPA index instead
    // (the variables silently fall back to defaults). Sync BEFORE emitting the step so
    // the file is in place the moment the iframe loads. Best-effort — never block the
    // step transition. (User edits via the design-kit panels sync it through their own
    // route; this covers the agent-assembled first load.)
    if (input.step === 4) {
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

    const eventData = { step: input.step, appId }

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

    logger.info('setWizardStep.success', { appId, step: input.step })
    return `Wizard advanced to step ${input.step}.`
  },
)
