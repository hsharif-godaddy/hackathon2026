import { createDevelopAgent, directToolsAdmitted, __resetTurnscriptConversationState } from '../develop-agent.js';
import { logger } from '../../logging/index.js';
import type { PromptBuilder } from '@airo/ai-lib';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetAgentModelWithName, mockPromptBuilders, mockIsTurnscriptEnabled } = vi.hoisted(() => ({
  mockGetAgentModelWithName: vi.fn(),
  mockPromptBuilders: [] as any[],
  mockIsTurnscriptEnabled: vi.fn(() => false),
}));

vi.mock('../turnscript-context.js', () => ({
  isTurnscriptEnabled: mockIsTurnscriptEnabled,
}));

vi.mock('../../utils/model-selection.js', () => ({
  getAgentModelWithName: mockGetAgentModelWithName
}));

vi.mock('../../tools/ai-lib-tools/index.js', () => {
  const tool = { execute: vi.fn() };
  return {
    allAILibTools: new Proxy({}, {
      get: function get() {
        return tool;
      }
    })
  };
});

vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual('node:fs/promises');
  return {
    ...actual,
    readFile: vi.fn().mockResolvedValue('')
  };
});

vi.mock('@airo/ai-lib', async () => {
  const actual = await vi.importActual('@airo/ai-lib');
  const { createMockPromptBuilder } = await import('./helpers/mock-prompt-builder.js');
  const mockBuilder = function builder() {
    const files: string[] = [];
    const self = createMockPromptBuilder({
      buildResult: '# AI Developer\nYou are a senior web developer.',
      onFile: (path: string) => files.push(path),
    }) as PromptBuilder & { files: string[] };
    self.files = files;
    mockPromptBuilders.push(self);
    return self;
  };
  return {
    ...actual,
    createPromptBuilder: mockBuilder,
    createHandoffTool: vi.fn().mockReturnValue({
      execute: vi.fn()
    })
  };
});

describe('develop-agent', function developAgentTests() {
  beforeEach(function setup() {
    mockPromptBuilders.length = 0;
    mockGetAgentModelWithName.mockReset();
    mockGetAgentModelWithName.mockResolvedValue({
      model: { generate: vi.fn(), streamGenerate: vi.fn() },
      modelName: 'claude-sonnet-4-6'
    });
    mockIsTurnscriptEnabled.mockReturnValue(false);
    __resetTurnscriptConversationState();
  });

  describe('#createDevelopAgent', function createTests() {
    it('should create agent configuration with correct properties',
      async function create() {
        const config = await createDevelopAgent();

        expect(config.id).toBe('develop');
        expect(config.name).toBe('AI Developer');
        expect(config).toHaveProperty('system');
        expect(config).toHaveProperty('model');
        expect(config).toHaveProperty('modelName');
        expect(config).toHaveProperty('tools');
        expect(config.maxSteps).toBe(100);
        expect(config.temperature).toBe(0.3);
        expect(config.maxOutputTokens).toBe(32000);
      });

    it('should have step timeout configured',
      async function timeout() {
        const config = await createDevelopAgent();

        expect(config.timeout).toEqual({ stepMs: 600_000 });
      });

    it('should rely on model defaults for provider options',
      async function defaults() {
        const config = await createDevelopAgent();

        expect(config.providerOptions).toBeUndefined();
      });

    it('should configure handoff to marketing agent',
      async function handoffs() {
        const config = await createDevelopAgent();

        expect(config.handoffs).toBeInstanceOf(Array);
        expect(config.handoffs).toHaveLength(1);
        expect(config.handoffs[0].agentName).toBe('marketing');
      });

    it('should include core development tools',
      async function coreTools() {
        const config = await createDevelopAgent();

        expect(config.tools).toHaveProperty('directoryListing');
        expect(config.tools).toHaveProperty('terminalCommand');
        expect(config.tools).toHaveProperty(
          'str_replace_based_edit_tool'
        );
        expect(config.tools).toHaveProperty('readFile');
        expect(config.tools).toHaveProperty('grepSearch');
        expect(config.tools).toHaveProperty('todoList');
      });

    it('should enable prompt caching',
      async function promptCaching() {
        const config = await createDevelopAgent();

        expect(config.enablePromptCaching).toBe(true);
      });

    // The system prompt is now built lazily by a resolver in createDevelopAgent.
    // To inspect which prompt files are loaded, we have to invoke the resolver
    // — that's what the AgentWrapper does once per turn inside prepareCall.
    async function fireSystemResolver(config: Awaited<ReturnType<typeof createDevelopAgent>>) {
      if (typeof config.system === 'function') {
        await config.system({});
      }
    }

    it('should include Claude behavior guidance for Claude-family models',
      async function claudeBehavior() {
        const config = await createDevelopAgent();
        await fireSystemResolver(config);

        expect(mockPromptBuilders[0].files.some((path: string) => path.endsWith('claude-behavior.md'))).toBe(true);
      });

    it('should omit Claude behavior guidance for non-Anthropic models',
      async function nonAnthropic() {
        mockGetAgentModelWithName.mockResolvedValueOnce({
          model: { generate: vi.fn(), streamGenerate: vi.fn() },
          modelName: 'azure/Kimi-K2.6'
        });

        const config = await createDevelopAgent();
        await fireSystemResolver(config);

        expect(mockPromptBuilders[0].files.some((path: string) => path.endsWith('claude-behavior.md'))).toBe(false);
      });

    it('should include Kimi behavior guidance for Kimi models',
      async function kimiBehavior() {
        mockGetAgentModelWithName.mockResolvedValueOnce({
          model: { generate: vi.fn(), streamGenerate: vi.fn() },
          modelName: 'azure/Kimi-K2.6'
        });

        const config = await createDevelopAgent();
        await fireSystemResolver(config);

        expect(mockPromptBuilders[0].files.some((path: string) => path.endsWith('kimi-behavior.md'))).toBe(true);
      });

    it('should omit Kimi behavior guidance for Claude models',
      async function claudeModel() {
        const config = await createDevelopAgent();
        await fireSystemResolver(config);

        expect(mockPromptBuilders[0].files.some((path: string) => path.endsWith('kimi-behavior.md'))).toBe(false);
      });

    it('should include Kimi behavior guidance for runtime model overrides',
      async function modelOverride() {
        const config = await createDevelopAgent();
        // Fire the lazy resolver to materialize the first builder, then trigger
        // the model-override path which uses systemForModel.
        await fireSystemResolver(config);

        await (config.metadata?.systemForModel as (modelName: string) => Promise<string>)('azure/Kimi-K2.6');

        expect(mockPromptBuilders[1].files.some((path: string) => path.endsWith('kimi-behavior.md'))).toBe(true);
      });

    it('should include Kimi behavior guidance for Kimi thinking variant',
      async function kimiThinkingBehavior() {
        mockGetAgentModelWithName.mockResolvedValueOnce({
          model: { generate: vi.fn(), streamGenerate: vi.fn() },
          modelName: 'azure/Kimi-K2.6-thinking'
        });

        const config = await createDevelopAgent();
        await fireSystemResolver(config);

        expect(mockPromptBuilders[0].files.some((path: string) => path.endsWith('kimi-behavior.md'))).toBe(true);
      });

    it('should include consent-requirements shared fragment',
      async function consentRequirements() {
        const config = await createDevelopAgent();
        await fireSystemResolver(config);

        expect(mockPromptBuilders[0].files.some((path: string) => path.endsWith('consent-requirements.md'))).toBe(true);
      });
  });

  // Turnscript visibility is gated by the activeTools resolver, which reads
  // isTurnscriptEnabled() (the ALS context, mocked here). The enable/TLA decision
  // itself is covered in turnscript-context.test.ts; these tests only verify how the
  // resolver shapes the tool set given that decision + the sticky admit state.
  describe('#activeTools turnscript gating', function turnscriptGating() {
    const DIRECT_TOOLS = ['directoryListing', 'grepSearch', 'readFile', 'str_replace_based_edit_tool'];

    async function activeToolSet(ctx: { conversationId?: string } = {}): Promise<Set<string>> {
      const config = await createDevelopAgent();
      const tools = await (config.activeTools as (c: typeof ctx) => Promise<string[]>)(ctx);
      return new Set(tools);
    }

    it('disabled: hides turnscript and keeps the direct discovery/edit tools (== plain main)',
      async function disabled() {
        mockIsTurnscriptEnabled.mockReturnValue(false);
        const tools = await activeToolSet();

        expect(tools.has('turnscript')).toBe(false);
        for (const t of DIRECT_TOOLS) expect(tools.has(t)).toBe(true);
      });

    it('enabled (pre-failure): exposes turnscript and removes the 4 direct tools',
      async function enabled() {
        mockIsTurnscriptEnabled.mockReturnValue(true);
        const tools = await activeToolSet({ conversationId: 'conv-1' });

        expect(tools.has('turnscript')).toBe(true);
        for (const t of DIRECT_TOOLS) expect(tools.has(t)).toBe(false);
      });

    it('enabled + admitted: a turnscript failure admits the 4 direct tools for the rest of the conversation',
      async function admitted() {
        mockIsTurnscriptEnabled.mockReturnValue(true);
        const config = await createDevelopAgent();
        const conversationId = 'conv-admit';

        // A failed turnscript step flips the sticky admit flag via afterToolExecution.
        const failureOutput = '[turnscript failed: timeout] script exceeded 30s';
        await (config.afterToolExecution as (
          name: string, args: unknown, result: unknown, err: unknown, ctx: unknown,
        ) => Promise<unknown>)('turnscript', { code: '...' }, failureOutput, undefined, { metadata: { conversationId } });

        expect(directToolsAdmitted(conversationId)).toBe(true);

        const tools = new Set(
          await (config.activeTools as (c: { conversationId?: string }) => Promise<string[]>)({ conversationId }),
        );
        expect(tools.has('turnscript')).toBe(true);
        for (const t of DIRECT_TOOLS) expect(tools.has(t)).toBe(true);
      });

    it('flag OFF is inert: the only tool-set delta vs ON is {turnscript} ⇄ the 4 direct tools',
      async function inertWhenOff() {
        // Risk guard: with turnscript off the develop agent must be plain main — every
        // tool other than turnscript + the 4 direct discovery/edit tools is identical
        // between off and on (pre-failure).
        const MOVABLE = new Set(['turnscript', ...DIRECT_TOOLS]);

        mockIsTurnscriptEnabled.mockReturnValue(false);
        const offSet = await activeToolSet();
        mockIsTurnscriptEnabled.mockReturnValue(true);
        const onSet = await activeToolSet({ conversationId: 'conv-2' });

        const offFixed = [...offSet].filter(t => !MOVABLE.has(t)).sort();
        const onFixed = [...onSet].filter(t => !MOVABLE.has(t)).sort();
        expect(offFixed).toEqual(onFixed);
        expect(offSet.has('turnscript')).toBe(false);
      });

    it('enabled: adds the turnscript nudge to the system prompt',
      async function nudge() {
        mockIsTurnscriptEnabled.mockReturnValue(true);
        const config = await createDevelopAgent();
        await (config.system as (ctx: object) => Promise<string>)({});

        const textCalls = mockPromptBuilders[0].text.mock.calls.map((c: unknown[]) => String(c[0]));
        expect(textCalls.some((t: string) => t.includes('## Turnscript'))).toBe(true);
      });

    it('disabled: omits the turnscript nudge from the system prompt',
      async function noNudge() {
        mockIsTurnscriptEnabled.mockReturnValue(false);
        const config = await createDevelopAgent();
        await (config.system as (ctx: object) => Promise<string>)({});

        const textCalls = mockPromptBuilders[0].text.mock.calls.map((c: unknown[]) => String(c[0]));
        expect(textCalls.some((t: string) => t.includes('## Turnscript'))).toBe(false);
      });

    // afterToolExecution drives the sticky admit + fallback telemetry. The admit
    // must fire for EVERY turnscript failure kind (not just timeout), and never on
    // success; the fallback event fires when a direct tool runs after a failure.
    async function runAfterTool(
      config: Awaited<ReturnType<typeof createDevelopAgent>>,
      toolName: string,
      result: unknown,
      conversationId: string,
    ): Promise<void> {
      await (config.afterToolExecution as (
        n: string, a: unknown, r: unknown, e: unknown, c: unknown,
      ) => Promise<unknown>)(toolName, {}, result, undefined, { metadata: { conversationId } });
    }

    it('admits direct tools on a runtime_throw turnscript failure',
      async function admitRuntimeThrow() {
        const config = await createDevelopAgent();
        await runAfterTool(config, 'turnscript', '[turnscript runtime error] old_str not found', 'conv-rt');
        expect(directToolsAdmitted('conv-rt')).toBe(true);
      });

    it('admits direct tools on a generic turnscript error',
      async function admitGeneric() {
        const config = await createDevelopAgent();
        await runAfterTool(config, 'turnscript', '[turnscript error] harness failure', 'conv-generic');
        expect(directToolsAdmitted('conv-generic')).toBe(true);
      });

    it('does NOT admit direct tools on a successful turnscript',
      async function noAdmitOnSuccess() {
        const config = await createDevelopAgent();
        await runAfterTool(config, 'turnscript', 'edited 2 files\n[turnscript] 2 dispatch(es) {"readFile":1}', 'conv-ok');
        expect(directToolsAdmitted('conv-ok')).toBe(false);
      });

    it('emits fallback telemetry when a direct tool runs after a failed turnscript',
      async function fallbackTelemetry() {
        const infoSpy = vi.spyOn(logger, 'info');
        try {
          const config = await createDevelopAgent();
          await runAfterTool(config, 'turnscript', '[turnscript failed: timeout] exceeded 30s', 'conv-fb');
          infoSpy.mockClear();
          await runAfterTool(config, 'readFile', 'file contents', 'conv-fb');
          expect(infoSpy).toHaveBeenCalledWith('develop_agent.turnscript.fallback', { toolName: 'readFile' });
        } finally {
          infoSpy.mockRestore();
        }
      });
  });
});
