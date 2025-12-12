import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/gasket-config', () => ({ appFetch: vi.fn() }));
vi.mock('@/lib/request-context', () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() } }));

describe('useTranslationPackages', () => {
  it('should be defined', async () => {
    const { useTranslationPackages } = await import('./useTranslationPackages');
    expect(useTranslationPackages).toBeDefined();
  });
});
