import { describe, it, expect, vi } from 'vitest';
import { ensureStatsIndex } from './bootstrap.js';

function mockClient() {
  return {
    ilm: { putLifecycle: vi.fn().mockResolvedValue({}) },
    indices: {
      putIndexTemplate: vi.fn().mockResolvedValue({}),
      existsAlias: vi.fn().mockResolvedValue(false),
      create: vi.fn().mockResolvedValue({}),
    },
  };
}

describe('ensureStatsIndex', () => {
  it('puts ILM, template, and creates the bootstrap index when alias is absent', async () => {
    const c = mockClient();
    await ensureStatsIndex(c as never, 'watchtower_stats');
    expect(c.ilm.putLifecycle).toHaveBeenCalledOnce();
    expect(c.indices.putIndexTemplate).toHaveBeenCalledOnce();
    expect(c.indices.create).toHaveBeenCalledOnce();
  });

  it('skips index creation when the alias already exists', async () => {
    const c = mockClient();
    c.indices.existsAlias.mockResolvedValue(true);
    await ensureStatsIndex(c as never, 'watchtower_stats');
    expect(c.indices.create).not.toHaveBeenCalled();
  });
});
