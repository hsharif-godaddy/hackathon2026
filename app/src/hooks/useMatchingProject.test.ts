import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/gasket-config', () => ({ appFetch: vi.fn() }));
vi.mock('@/lib/request-context', () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() } }));

describe('useMatchingProject', () => {
  it('should be defined', async () => {
    const { useMatchingProject } = await import('./useMatchingProject');
    expect(useMatchingProject).toBeDefined();
  });
});
