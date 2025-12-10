import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

vi.mock('@/lib/request-context', () => ({ logger: { info: vi.fn(), error: vi.fn() } }));

describe('usePageTiming', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  
  it('should be defined', async () => {
    const { usePageTiming } = await import('./usePageTiming');
    expect(usePageTiming).toBeDefined();
  });
});
