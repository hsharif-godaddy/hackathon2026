import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express, { type Express, type Request, type Response, type NextFunction } from 'express';

// All mock fns are created via vi.hoisted so the (hoisted) vi.mock factories below
// can close over them without a temporal-dead-zone "Cannot access X before
// initialization" error.
const { setMock, getMock, filesWrite, updateCssColorPalette, updateCssFontVariables, syncBrandTokensCss, validateFontPairing, appPlanExecute, getConversationsByApp, ssePublish, getSSERegistry, getEventChannel } =
  vi.hoisted(() => {
    const getConversationsByApp = vi.fn(() => [] as string[]);
    const ssePublish = vi.fn();
    return {
      setMock: vi.fn(async () => ({ success: true })),
      getMock: vi.fn(async () => ({ success: true, exists: false })),
      filesWrite: vi.fn(async () => ({ bytesWritten: 1 })),
      updateCssColorPalette: vi.fn(async () => ({
        success: true,
        palette: { primary: '#3b5bdb', background: '#ffffff' },
        message: 'ok',
      })),
      updateCssFontVariables: vi.fn(async () => ({ success: true, message: 'ok' })),
      syncBrandTokensCss: vi.fn(async () => undefined),
      validateFontPairing: vi.fn(async () => ({ valid: true, networkError: false })),
      appPlanExecute: vi.fn(async () => ({ success: true })),
      getConversationsByApp,
      ssePublish,
      getSSERegistry: vi.fn(() => ({ getConversationsByApp })),
      getEventChannel: vi.fn(() => ({ publish: ssePublish })),
    };
  });

// Memory store mock (set + get). The route calls memory.set for every write and
// memory.get only on the voice route (to merge into brand.identity).
vi.mock('../../../memory/adapters/index.js', () => ({
  getKvMemoryStore: () => ({ set: setMock, get: getMock }),
}));

// Workspace mock. createForWorkspace returns an object with files.write / files.view.
vi.mock('../../../workspace/index.js', () => ({
  createForWorkspace: () => ({ files: { write: filesWrite, view: vi.fn() } }),
}));

// CSS writers reused by the colors + fonts routes.
vi.mock('../../../tools/css-color-tool.js', () => ({ updateCssColorPalette }));
vi.mock('../../../tools/ai-lib-tools/font-theme.js', () => ({
  updateCssFontVariables,
  buildGoogleFontsUrl: () => 'https://fonts.googleapis.com/css2?family=Inter&display=swap',
  validateFontPairing,
}));

// brand-tokens.css sync (colors + fonts routes call this).
vi.mock('../../../services/design-system/brand-tokens-css.js', () => ({ syncBrandTokensCss }));

// App plan tool — colours/fonts routes mirror colorScheme/fontTheme by also persisting here.
vi.mock('../../../tools/app-plan-tool.js', () => ({ appPlanTool: { execute: appPlanExecute } }));

// SSE emit on the wizard-step route mirrors set-wizard-step.ts: publish to each
// active SSE conversation for the app via the event channel.
vi.mock('../../sse/registry-singleton.js', () => ({ getSSERegistry }));
vi.mock('../../agent-runtime.js', () => ({ getEventChannel }));

// Bypass ownership middleware; populate agentContext as the real middleware would.
vi.mock('../../middleware/app-ownership.js', () => ({
  validateAppOwnership: (req: Request, _res: Response, next: NextFunction) => {
    (req as Request & { agentContext?: unknown }).agentContext = {
      customerId: 'cust1',
      siteId: 'app1234567',
    };
    next();
  },
}));

// Logging: route uses log.forApp(appId).error(...).
vi.mock('../../../logging/index.js', () => ({
  log: {
    forApp: vi.fn().mockReturnValue({ error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
  },
}));

import designKitRouter from '../design-kit.js';

function makeApp(): Express {
  const app = express();
  app.use(express.json());
  app.use(designKitRouter);
  return app;
}

describe('design-kit direct-edit routes', () => {
  beforeEach(() => {
    setMock.mockClear();
    getMock.mockClear();
    getMock.mockResolvedValue({ success: true, exists: false } as never);
    filesWrite.mockClear();
    updateCssColorPalette.mockClear();
    updateCssFontVariables.mockClear();
    syncBrandTokensCss.mockClear();
    validateFontPairing.mockClear();
    validateFontPairing.mockResolvedValue({ valid: true, networkError: false } as never);
    appPlanExecute.mockClear();
    getConversationsByApp.mockClear();
    getConversationsByApp.mockReturnValue([]);
    ssePublish.mockClear();
    getSSERegistry.mockClear();
    getEventChannel.mockClear();
  });

  it('PUT colors applies the palette, persists memory, syncs tokens', async () => {
    const res = await request(makeApp())
      .put('/apps/app1234567/design-kit/colors')
      .send({ name: 'Indigo', palette: { primary: '#3b5bdb', background: '#ffffff' } });

    expect(res.status).toBe(200);
    expect(updateCssColorPalette).toHaveBeenCalled();
    expect(setMock).toHaveBeenCalledWith(
      expect.anything(),
      'brand.colors.palette',
      expect.objectContaining({ name: 'Indigo' }),
    );
    expect(syncBrandTokensCss).toHaveBeenCalled();
  });

  it('PUT colors returns 400 when palette.primary/background missing', async () => {
    const res = await request(makeApp())
      .put('/apps/app1234567/design-kit/colors')
      .send({ name: 'Indigo', palette: { primary: '#3b5bdb' } });

    expect(res.status).toBe(400);
    expect(updateCssColorPalette).not.toHaveBeenCalled();
    expect(setMock).not.toHaveBeenCalled();
  });

  it('PUT fonts applies fonts, persists typography, syncs tokens', async () => {
    const res = await request(makeApp())
      .put('/apps/app1234567/design-kit/fonts')
      .send({
        heading: { name: 'Oswald', weights: ['600'], category: 'sans-serif' },
        body: { name: 'Inter', weights: ['400'], category: 'sans-serif' },
      });

    expect(res.status).toBe(200);
    expect(updateCssFontVariables).toHaveBeenCalled();
    expect(setMock).toHaveBeenCalledWith(
      expect.anything(),
      'brand.typography',
      expect.objectContaining({ heading: { family: 'Oswald', weights: ['600'] } }),
    );
    expect(syncBrandTokensCss).toHaveBeenCalled();
    // Validation ran cleanly, so the fail-open flag is false.
    expect(res.body.networkError).toBe(false);
  });

  it('PUT fonts returns 400 when heading.name/body.name missing', async () => {
    const res = await request(makeApp())
      .put('/apps/app1234567/design-kit/fonts')
      .send({ heading: { weights: ['600'] }, body: { name: 'Inter', weights: ['400'] } });

    expect(res.status).toBe(400);
    expect(updateCssFontVariables).not.toHaveBeenCalled();
  });

  it('PUT fonts returns 400 and does not apply when the pairing is invalid', async () => {
    validateFontPairing.mockResolvedValueOnce({ valid: false, networkError: false } as never);
    const res = await request(makeApp())
      .put('/apps/app1234567/design-kit/fonts')
      .send({
        heading: { name: 'Notafont', weights: ['600'], category: 'sans-serif' },
        body: { name: 'Inter', weights: ['400'], category: 'sans-serif' },
      });

    expect(res.status).toBe(400);
    expect(updateCssFontVariables).not.toHaveBeenCalled();
    expect(setMock).not.toHaveBeenCalled();
  });

  it('PUT fonts applies anyway when validation hits a network error (best-effort) and surfaces networkError:true', async () => {
    validateFontPairing.mockResolvedValueOnce({ valid: false, networkError: true } as never);
    const res = await request(makeApp())
      .put('/apps/app1234567/design-kit/fonts')
      .send({
        heading: { name: 'Oswald', weights: ['600'], category: 'sans-serif' },
        body: { name: 'Inter', weights: ['400'], category: 'sans-serif' },
      });

    expect(res.status).toBe(200);
    expect(updateCssFontVariables).toHaveBeenCalled();
    // Fail-open signal surfaced so the client can show a "couldn't verify" notice.
    expect(res.body.networkError).toBe(true);
  });

  it('PUT summary persists brand.summary', async () => {
    const res = await request(makeApp())
      .put('/apps/app1234567/design-kit/summary')
      .send({ text: 'Hello' });

    expect(res.status).toBe(200);
    expect(setMock).toHaveBeenCalledWith(expect.anything(), 'brand.summary', { text: 'Hello' });
  });

  it('PUT summary returns 400 when text missing', async () => {
    const res = await request(makeApp()).put('/apps/app1234567/design-kit/summary').send({});

    expect(res.status).toBe(400);
    expect(setMock).not.toHaveBeenCalled();
  });

  it('PUT imagery persists brand.imagery', async () => {
    const res = await request(makeApp())
      .put('/apps/app1234567/design-kit/imagery')
      .send({ keyword: 'minimal neutral' });

    expect(res.status).toBe(200);
    expect(setMock).toHaveBeenCalledWith(expect.anything(), 'brand.imagery', {
      keyword: 'minimal neutral',
    });
  });

  it('PUT imagery returns 400 when keyword missing', async () => {
    const res = await request(makeApp()).put('/apps/app1234567/design-kit/imagery').send({});

    expect(res.status).toBe(400);
    expect(setMock).not.toHaveBeenCalled();
  });

  it('PUT wizard-step persists and publishes build_phase', async () => {
    getConversationsByApp.mockReturnValueOnce(['conv-a']);

    const res = await request(makeApp())
      .put('/apps/app1234567/design-kit/wizard-step')
      .send({ step: 3 });

    expect(res.status).toBe(200);
    expect(setMock).toHaveBeenCalledWith(expect.anything(), 'brand.wizard.step', { step: 3 });
    expect(ssePublish).toHaveBeenCalledWith(
      'conv-a',
      expect.objectContaining({ type: 'build_phase', data: expect.objectContaining({ step: 3, appId: 'app1234567' }) }),
    );
  });

  it('PUT wizard-step publishes build_phase to active SSE conversations', async () => {
    getConversationsByApp.mockReturnValueOnce(['conv-a', 'conv-b']);

    const res = await request(makeApp())
      .put('/apps/app1234567/design-kit/wizard-step')
      .send({ step: 3 });

    expect(res.status).toBe(200);
    // SSE path: one publish per active conversation for this app.
    expect(getConversationsByApp).toHaveBeenCalledWith('app1234567');
    expect(ssePublish).toHaveBeenCalledTimes(2);
    expect(ssePublish).toHaveBeenCalledWith(
      'conv-a',
      expect.objectContaining({
        conversationId: 'conv-a',
        type: 'build_phase',
        data: expect.objectContaining({ step: 3, appId: 'app1234567' }),
      }),
    );
    expect(ssePublish).toHaveBeenCalledWith(
      'conv-b',
      expect.objectContaining({ conversationId: 'conv-b', type: 'build_phase' }),
    );
  });

  it('PUT wizard-step returns 400 for an out-of-range step', async () => {
    const res = await request(makeApp())
      .put('/apps/app1234567/design-kit/wizard-step')
      .send({ step: 9 });

    expect(res.status).toBe(400);
    expect(setMock).not.toHaveBeenCalled();
    expect(ssePublish).not.toHaveBeenCalled();
  });

  it('PUT voice merges into brand.identity', async () => {
    getMock.mockResolvedValueOnce({ success: true, exists: true, value: { brandName: 'X' } } as never);

    const res = await request(makeApp())
      .put('/apps/app1234567/design-kit/voice')
      .send({ voice: { weAre: ['warm'] } });

    expect(res.status).toBe(200);
    expect(setMock).toHaveBeenCalledWith(
      expect.anything(),
      'brand.identity',
      expect.objectContaining({ brandName: 'X', voice: { weAre: ['warm'] } }),
    );
  });

  it('PUT voice merges at the voice level, preserving agent-written weAreNot/sampleCopy', async () => {
    getMock.mockResolvedValueOnce({
      success: true,
      exists: true,
      value: { brandName: 'X', voice: { weAre: ['old'], weAreNot: ['x'], sampleCopy: ['s'] } },
    } as never);

    const res = await request(makeApp())
      .put('/apps/app1234567/design-kit/voice')
      .send({ voice: { weAre: ['warm'] } });

    expect(res.status).toBe(200);
    // weAre is overwritten; weAreNot + sampleCopy survive the edit.
    expect(setMock).toHaveBeenCalledWith(
      expect.anything(),
      'brand.identity',
      expect.objectContaining({
        brandName: 'X',
        voice: { weAre: ['warm'], weAreNot: ['x'], sampleCopy: ['s'] },
      }),
    );
  });

  it('PUT voice returns 400 when voice object missing', async () => {
    const res = await request(makeApp()).put('/apps/app1234567/design-kit/voice').send({});

    expect(res.status).toBe(400);
    expect(setMock).not.toHaveBeenCalled();
  });

  it('PUT colors persists the palette to the app plan', async () => {
    const res = await request(makeApp())
      .put('/apps/app1234567/design-kit/colors')
      .send({ name: 'Indigo', palette: { primary: '#3b5bdb', background: '#ffffff' } });

    expect(res.status).toBe(200);
    expect(appPlanExecute).toHaveBeenCalledWith(
      expect.objectContaining({
        appId: 'app1234567',
        operation: 'update',
        colorPalette: expect.objectContaining({ name: 'Indigo', primary: '#3b5bdb' }),
      }),
    );
  });

  it('PUT fonts persists a synthesized pairing name in brand.typography', async () => {
    const res = await request(makeApp())
      .put('/apps/app1234567/design-kit/fonts')
      .send({
        heading: { name: 'Oswald', weights: ['600'], category: 'sans-serif' },
        body: { name: 'Inter', weights: ['400'], category: 'sans-serif' },
      });

    expect(res.status).toBe(200);
    expect(setMock).toHaveBeenCalledWith(
      expect.anything(),
      'brand.typography',
      expect.objectContaining({ name: 'Oswald & Inter' }),
    );
  });

  it('PUT fonts persists the font theme to the app plan', async () => {
    const res = await request(makeApp())
      .put('/apps/app1234567/design-kit/fonts')
      .send({
        heading: { name: 'Oswald', weights: ['600'], category: 'sans-serif' },
        body: { name: 'Inter', weights: ['400'], category: 'sans-serif' },
      });

    expect(res.status).toBe(200);
    expect(appPlanExecute).toHaveBeenCalledWith(
      expect.objectContaining({
        appId: 'app1234567',
        operation: 'update',
        fontTheme: expect.objectContaining({
          name: 'Oswald & Inter',
          headerFont: expect.objectContaining({ name: 'Oswald', weights: ['600'], category: 'sans-serif' }),
          bodyFont: expect.objectContaining({ name: 'Inter', weights: ['400'], category: 'sans-serif' }),
        }),
      }),
    );
  });

  it('PUT colors reuses the prior border so generatePalette does not re-roll it', async () => {
    getMock.mockResolvedValueOnce({
      success: true,
      exists: true,
      value: { primary: '#111111', background: '#ffffff', border: '#abcdef' },
    } as never);

    const res = await request(makeApp())
      .put('/apps/app1234567/design-kit/colors')
      .send({ name: 'Indigo', palette: { primary: '#3b5bdb', background: '#ffffff' } });

    expect(res.status).toBe(200);
    // The prior border is passed through to updateCssColorPalette as an explicit input.
    expect(updateCssColorPalette).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ primary: '#3b5bdb', border: '#abcdef' }),
    );
  });

  it('PUT fonts collapses to a single name when heading and body fonts match', async () => {
    const res = await request(makeApp())
      .put('/apps/app1234567/design-kit/fonts')
      .send({
        heading: { name: 'Inter', weights: ['600'], category: 'sans-serif' },
        body: { name: 'Inter', weights: ['400'], category: 'sans-serif' },
      });

    expect(res.status).toBe(200);
    expect(setMock).toHaveBeenCalledWith(
      expect.anything(),
      'brand.typography',
      expect.objectContaining({ name: 'Inter' }),
    );
  });

  it('PUT fonts still succeeds (200) when the app-plan write fails (non-fatal)', async () => {
    appPlanExecute.mockRejectedValueOnce(new Error('boom') as never);
    const res = await request(makeApp())
      .put('/apps/app1234567/design-kit/fonts')
      .send({
        heading: { name: 'Oswald', weights: ['600'], category: 'sans-serif' },
        body: { name: 'Inter', weights: ['400'], category: 'sans-serif' },
      });

    expect(res.status).toBe(200);
    // The typography was still persisted to memory despite the app-plan failure.
    expect(setMock).toHaveBeenCalledWith(expect.anything(), 'brand.typography', expect.objectContaining({ name: 'Oswald & Inter' }));
  });
});
