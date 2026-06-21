/**
 * Design Kit Wizard direct-edit routes.
 *
 * Thin endpoints that persist Step-3 parameter edits without an agent turn,
 * reusing the same write functions the agent tools use. Live preview is the
 * UI's responsibility (postMessage); these own persistence + token sync.
 */
import { Router, type Request, type Response } from 'express';
import { log } from '../../logging/index.js';
import { getKvMemoryStore } from '../../memory/adapters/index.js';
import { workspaceScopeFromAppId } from '../../memory/interfaces/scope.js';
import { validateAppOwnership } from '../middleware/app-ownership.js';
import type { AuthenticatedRequest } from '../middleware/jwt-auth.js';
import { createForWorkspace } from '../../workspace/index.js';
import { updateCssColorPalette, type ColorPalette } from '../../tools/css-color-tool.js';
import { updateCssFontVariables, validateFontPairing } from '../../tools/ai-lib-tools/font-theme.js';
import { syncBrandTokensCss } from '../../services/design-system/brand-tokens-css.js';
import { appPlanTool } from '../../tools/app-plan-tool.js';
import { getSSERegistry } from '../sse/registry-singleton.js';
import { getEventChannel } from '../agent-runtime.js';

const router: Router = Router();
const memory = getKvMemoryStore();

function ctx(req: Request): { appId: string; customerId: string | undefined } {
  return { appId: req.params.id!, customerId: (req as AuthenticatedRequest).agentContext?.customerId };
}

// PUT /apps/:id/design-kit/colors  { name?, palette: { primary, background, ... } }
router.put('/apps/:id/design-kit/colors', validateAppOwnership, async (req: Request, res: Response): Promise<void> => {
  const { appId, customerId } = ctx(req);
  const logger = log.forApp(appId);
  try {
    const { name, palette } = req.body ?? {};
    if (!palette || typeof palette.primary !== 'string' || typeof palette.background !== 'string') {
      res.status(400).json({ error: 'palette.primary and palette.background are required' }); return;
    }
    const workspace = createForWorkspace(appId, 'preview');
    if (!workspace) { res.status(404).json({ error: 'Workspace not available' }); return; }
    const scope = workspaceScopeFromAppId(appId, customerId);
    // Determinism: reuse the previously derived border so generatePalette() does
    // not re-randomize it on each edit (muted is an explicit slot, already stable;
    // card is intentionally NOT pinned — it defaults to background and must follow
    // a background change).
    const prior = await memory.get(scope, 'brand.colors.palette');
    const priorBorder =
      prior.exists && prior.value && typeof prior.value === 'object'
        ? (prior.value as Record<string, unknown>).border
        : undefined;
    const paletteInput: ColorPalette =
      typeof priorBorder === 'string'
        ? { ...(palette as ColorPalette), border: priorBorder }
        : (palette as ColorPalette);

    const result = await updateCssColorPalette(workspace.files, paletteInput);
    const stored = { name: typeof name === 'string' ? name : 'Custom', ...result.palette };
    const writeResult = await memory.set(scope, 'brand.colors.palette', stored);
    if (!writeResult.success) {
      logger.error('designKit.colors.persist_failed', { appId, error: writeResult.error });
      res.status(500).json({ error: 'Failed to persist colors' }); return;
    }
    await syncBrandTokensCss(appId, customerId, workspace.files);

    // Mirror colorScheme: persist to the app plan too, so AppContextManager
    // (app-plan-first) hands the develop agent the edited palette at website build.
    try {
      await appPlanTool.execute({ appId, operation: 'update', colorPalette: stored });
    } catch (appPlanError) {
      logger.warn('designKit.colors.appPlan_failed', {
        appId,
        error: appPlanError instanceof Error ? appPlanError.message : String(appPlanError),
      });
    }

    res.json({ success: true, palette: stored });
  } catch (error) {
    logger.error('designKit.colors.failed', { appId, error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ error: 'Failed to apply colors' });
  }
});

// PUT /apps/:id/design-kit/fonts  { heading: {name,weights,category}, body: {name,weights,category} }
router.put('/apps/:id/design-kit/fonts', validateAppOwnership, async (req: Request, res: Response): Promise<void> => {
  const { appId, customerId } = ctx(req);
  const logger = log.forApp(appId);
  try {
    const { heading, body } = req.body ?? {};
    if (!heading?.name || !body?.name) { res.status(400).json({ error: 'heading.name and body.name are required' }); return; }
    const validation = await validateFontPairing(heading, body);
    if (!validation.valid && !validation.networkError) {
      res.status(400).json({ error: `"${heading.name}" / "${body.name}" not found on Google Fonts or uses unsupported weights` });
      return;
    }
    if (validation.networkError) {
      logger.warn('designKit.fonts.validation_network_error', { appId, heading: heading.name, body: body.name });
    }
    const workspace = createForWorkspace(appId, 'preview');
    if (!workspace) { res.status(404).json({ error: 'Workspace not available' }); return; }
    const scope = workspaceScopeFromAppId(appId, customerId);
    await updateCssFontVariables(workspace.files, heading, body);
    const themeName = heading.name === body.name ? heading.name : `${heading.name} & ${body.name}`;
    const typography = {
      name: themeName,
      heading: { family: heading.name, weights: heading.weights ?? ['400', '700'] },
      body: { family: body.name, weights: body.weights ?? ['400'] },
    };
    const writeResult = await memory.set(scope, 'brand.typography', typography);
    if (!writeResult.success) {
      logger.error('designKit.fonts.persist_failed', { appId, error: writeResult.error });
      res.status(500).json({ error: 'Failed to persist fonts' }); return;
    }
    await syncBrandTokensCss(appId, customerId, workspace.files);

    // Mirror fontTheme: persist to the app plan too (AppContextManager is app-plan-first).
    try {
      await appPlanTool.execute({
        appId,
        operation: 'update',
        fontTheme: {
          name: themeName,
          headerFont: { name: heading.name, weights: heading.weights ?? ['400', '700'], category: heading.category ?? 'sans-serif' },
          bodyFont: { name: body.name, weights: body.weights ?? ['400'], category: body.category ?? 'sans-serif' },
        },
      });
    } catch (appPlanError) {
      logger.warn('designKit.fonts.appPlan_failed', {
        appId,
        error: appPlanError instanceof Error ? appPlanError.message : String(appPlanError),
      });
    }

    // Surface fail-open: when validation could not run (networkError), the client
    // can show a "couldn't verify this font" notice. Always present as a boolean.
    res.json({ success: true, typography, networkError: validation.networkError === true });
  } catch (error) {
    logger.error('designKit.fonts.failed', { appId, error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ error: 'Failed to apply fonts' });
  }
});

// PUT /apps/:id/design-kit/voice  { voice: { weAre?, weAreNot?, sampleCopy? } }  (merges into brand.identity)
router.put('/apps/:id/design-kit/voice', validateAppOwnership, async (req: Request, res: Response): Promise<void> => {
  const { appId, customerId } = ctx(req);
  const logger = log.forApp(appId);
  try {
    const { voice } = req.body ?? {};
    if (!voice || typeof voice !== 'object') { res.status(400).json({ error: 'voice object required' }); return; }
    const scope = workspaceScopeFromAppId(appId, customerId);
    const existing = await memory.get(scope, 'brand.identity');
    if (!existing.success) { res.status(500).json({ error: 'Failed to read brand identity' }); return; }
    const current = (existing.exists && existing.value && typeof existing.value === 'object' ? existing.value : {}) as Record<string, unknown>;
    // Merge at the voice level so a Step-3 word edit doesn't wipe agent-written
    // voice.weAreNot / voice.sampleCopy that the user isn't editing here.
    const currentVoice = (current.voice && typeof current.voice === 'object' ? current.voice : {}) as Record<string, unknown>;
    const writeResult = await memory.set(scope, 'brand.identity', { ...current, voice: { ...currentVoice, ...voice } });
    if (!writeResult.success) {
      logger.error('designKit.voice.persist_failed', { appId, error: writeResult.error });
      res.status(500).json({ error: 'Failed to save voice' }); return;
    }
    res.json({ success: true, voice });
  } catch (error) {
    logger.error('designKit.voice.failed', { appId, error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ error: 'Failed to save voice' });
  }
});

// PUT /apps/:id/design-kit/summary  { text }
router.put('/apps/:id/design-kit/summary', validateAppOwnership, async (req: Request, res: Response): Promise<void> => {
  const { appId, customerId } = ctx(req);
  try {
    const text = typeof req.body?.text === 'string' ? req.body.text : undefined;
    if (text === undefined) { res.status(400).json({ error: 'text required' }); return; }
    const writeResult = await memory.set(workspaceScopeFromAppId(appId, customerId), 'brand.summary', { text });
    if (!writeResult.success) {
      log.forApp(appId).error('designKit.summary.persist_failed', { appId, error: writeResult.error });
      res.status(500).json({ error: 'Failed to save summary' }); return;
    }
    res.json({ success: true, summary: { text } });
  } catch (error) {
    log.forApp(appId).error('designKit.summary.failed', { appId, error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ error: 'Failed to save summary' });
  }
});

// PUT /apps/:id/design-kit/imagery  { keyword }
router.put('/apps/:id/design-kit/imagery', validateAppOwnership, async (req: Request, res: Response): Promise<void> => {
  const { appId, customerId } = ctx(req);
  try {
    const keyword = typeof req.body?.keyword === 'string' ? req.body.keyword : undefined;
    if (keyword === undefined) { res.status(400).json({ error: 'keyword required' }); return; }
    const writeResult = await memory.set(workspaceScopeFromAppId(appId, customerId), 'brand.imagery', { keyword });
    if (!writeResult.success) {
      log.forApp(appId).error('designKit.imagery.persist_failed', { appId, error: writeResult.error });
      res.status(500).json({ error: 'Failed to save imagery keyword' }); return;
    }
    res.json({ success: true, imagery: { keyword } });
  } catch (error) {
    log.forApp(appId).error('designKit.imagery.failed', { appId, error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ error: 'Failed to save imagery keyword' });
  }
});

// PUT /apps/:id/design-kit/wizard-step  { step }  (user jumping back to step 3, etc.)
router.put('/apps/:id/design-kit/wizard-step', validateAppOwnership, async (req: Request, res: Response): Promise<void> => {
  const { appId, customerId } = ctx(req);
  try {
    const step = Number(req.body?.step);
    if (!Number.isInteger(step) || step < 1 || step > 5) { res.status(400).json({ error: 'step must be 1-5' }); return; }
    const writeResult = await memory.set(workspaceScopeFromAppId(appId, customerId), 'brand.wizard.step', { step });
    if (!writeResult.success) {
      log.forApp(appId).error('designKit.wizardStep.persist_failed', { appId, error: writeResult.error });
      res.status(500).json({ error: 'Failed to set wizard step' }); return;
    }
    try {
      // SSE delivery: publish to each active SSE conversation for this app via
      // the event channel (mirrors set-wizard-step.ts).
      const sseRegistry = getSSERegistry();
      const eventChannel = getEventChannel();
      if (sseRegistry && eventChannel) {
        for (const convId of sseRegistry.getConversationsByApp(appId)) {
          // Await so a rejected publish is caught by the surrounding try/catch;
          // a bare fire-and-forget call would escape as an unhandled rejection.
          await eventChannel.publish(convId, {
            conversationId: convId,
            type: 'build_phase',
            content: '',
            data: { step, appId },
            agentName: 'system',
          });
        }
      }
    } catch { /* non-fatal */ }
    res.json({ success: true, wizard: { step } });
  } catch (error) {
    log.forApp(appId).error('designKit.wizardStep.failed', { appId, error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ error: 'Failed to set wizard step' });
  }
});

export default router;
