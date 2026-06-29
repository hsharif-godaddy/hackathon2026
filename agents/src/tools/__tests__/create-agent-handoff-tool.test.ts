import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Tool } from 'ai';

const mockCreateHandoffTool = vi.hoisted(() => vi.fn());
const mockTrackInitialBuildHandoffAsync = vi.hoisted(() => vi.fn());

vi.mock('@airo/ai-lib', () => ({
  createHandoffTool: (...args: unknown[]) => mockCreateHandoffTool(...args),
}));

vi.mock('../../services/agent-lifecycle-events/initial-build-funnel.js', () => ({
  trackInitialBuildHandoffAsync: (...args: unknown[]) => mockTrackInitialBuildHandoffAsync(...args),
}));

import { createAgentHandoffTool } from '../create-agent-handoff-tool.js';

const baseConfig = {
  sourceAgentId: 'initial',
  validTargets: ['develop'],
  stateManager: { get: vi.fn(), set: vi.fn() },
};

function optionsWithAppId(appId?: string) {
  return {
    experimental_context: {
      metadata: appId === undefined ? {} : { appId },
    },
  };
}

describe('createAgentHandoffTool', () => {
  beforeEach(() => {
    mockCreateHandoffTool.mockReset();
    mockTrackInitialBuildHandoffAsync.mockReset();
  });

  it('returns the base tool unchanged when execute is absent', async () => {
    const baseTool: Tool = { description: 'handoff', parameters: {} };
    mockCreateHandoffTool.mockReturnValue(baseTool);

    const tool = createAgentHandoffTool(baseConfig as never);

    expect(tool).toBe(baseTool);
    expect(mockTrackInitialBuildHandoffAsync).not.toHaveBeenCalled();
  });

  it('emits handoff event on success when appId is in experimental_context.metadata', async () => {
    const execute = vi.fn().mockResolvedValue({ success: true, targetAgent: 'develop' });
    mockCreateHandoffTool.mockReturnValue({ description: 'handoff', parameters: {}, execute });

    const tool = createAgentHandoffTool(baseConfig as never);
    const result = await tool.execute?.({}, optionsWithAppId('app-handoff-1'));

    expect(result).toEqual({ success: true, targetAgent: 'develop' });
    expect(mockTrackInitialBuildHandoffAsync).toHaveBeenCalledTimes(1);
    expect(mockTrackInitialBuildHandoffAsync).toHaveBeenCalledWith('app-handoff-1');
  });

  it('does not emit when handoff result is not success', async () => {
    const execute = vi.fn().mockResolvedValue({ success: false, error: 'invalid target' });
    mockCreateHandoffTool.mockReturnValue({ description: 'handoff', parameters: {}, execute });

    const tool = createAgentHandoffTool(baseConfig as never);
    await tool.execute?.({}, optionsWithAppId('app-handoff-2'));

    expect(mockTrackInitialBuildHandoffAsync).not.toHaveBeenCalled();
  });

  it('does not emit on success when experimental_context.metadata.appId is missing', async () => {
    const execute = vi.fn().mockResolvedValue({ success: true });
    mockCreateHandoffTool.mockReturnValue({ description: 'handoff', parameters: {}, execute });

    const tool = createAgentHandoffTool(baseConfig as never);
    await tool.execute?.({}, optionsWithAppId());

    expect(mockTrackInitialBuildHandoffAsync).not.toHaveBeenCalled();
  });
});
