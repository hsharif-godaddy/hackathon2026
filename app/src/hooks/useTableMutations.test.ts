import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

vi.mock('@/lib/gasket-config', () => ({ appFetch: vi.fn() }));
vi.mock('@/lib/request-context', () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() } }));

describe('useTableMutations', () => {
  it('should be defined', async () => {
    const module = await import('./useTableMutations');
    const { useAddRow, useUpdateRow, useDeleteRow } = module;
    expect(useAddRow).toBeDefined();
    expect(useUpdateRow).toBeDefined();
    expect(useDeleteRow).toBeDefined();
  });
});
