import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Hoisted mock wrapper. Tests can reassign `mockGasket.config` to simulate
// (a) airoAppDomain missing on the config object, and
// (b) config itself missing entirely (covers the optional-chain path in
//     buildPreviewUrl that protects against an unlogged TypeError).
const mockGasket = vi.hoisted(() => ({
  config: { airoAppDomain: 'test-airoapp.ai' } as { airoAppDomain?: string } | undefined,
}));
vi.mock('../../../../gasket.ts', () => ({
  default: mockGasket,
}));

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));
vi.mock('@/lib/request-context', () => ({
  logger: mockLogger,
}));

import { buildPreviewUrl } from '../preview-url';

describe('buildPreviewUrl', () => {
  beforeEach(() => {
    mockGasket.config = { airoAppDomain: 'test-airoapp.ai' };
    mockLogger.warn.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('builds a preview URL using the test domain', () => {
    expect(buildPreviewUrl('k8bnu24pcq', 'c4')).toBe(
      'https://k8bnu24pcq.preview.c4.test-airoapp.ai',
    );
  });

  it('builds a preview URL using the production domain', () => {
    mockGasket.config = { airoAppDomain: 'airoapp.ai' };
    expect(buildPreviewUrl('k8bnu24pcq', 'c4')).toBe(
      'https://k8bnu24pcq.preview.c4.airoapp.ai',
    );
  });

  it('supports any cellPrefix (c9, c24, c36)', () => {
    expect(buildPreviewUrl('k8bnu24pcq', 'c9')).toBe(
      'https://k8bnu24pcq.preview.c9.test-airoapp.ai',
    );
    expect(buildPreviewUrl('k8bnu24pcq', 'c24')).toBe(
      'https://k8bnu24pcq.preview.c24.test-airoapp.ai',
    );
    expect(buildPreviewUrl('k8bnu24pcq', 'c36')).toBe(
      'https://k8bnu24pcq.preview.c36.test-airoapp.ai',
    );
  });

  it('falls back to test-airoapp.ai and warns when airoAppDomain is undefined', () => {
    mockGasket.config = { airoAppDomain: undefined };
    expect(buildPreviewUrl('k8bnu24pcq', 'c4')).toBe(
      'https://k8bnu24pcq.preview.c4.test-airoapp.ai',
    );
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'share.buildPreviewUrl.airoAppDomainFallback',
      expect.objectContaining({ fallback: 'test-airoapp.ai' }),
    );
  });

  it('falls back without throwing when gasket.config itself is undefined', () => {
    // Without the optional chain, `(gasket.config as any).airoAppDomain` would
    // raise TypeError and propagate as an unlogged 500 from the Server
    // Component. Optional chaining converts this into the warn-and-fallback
    // path the existing test above asserts.
    mockGasket.config = undefined;
    expect(() => buildPreviewUrl('k8bnu24pcq', 'c4')).not.toThrow();
    expect(buildPreviewUrl('k8bnu24pcq', 'c4')).toBe(
      'https://k8bnu24pcq.preview.c4.test-airoapp.ai',
    );
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'share.buildPreviewUrl.airoAppDomainFallback',
      expect.objectContaining({ fallback: 'test-airoapp.ai' }),
    );
  });

  it('does not warn when airoAppDomain is configured', () => {
    expect(buildPreviewUrl('k8bnu24pcq', 'c4')).toBe(
      'https://k8bnu24pcq.preview.c4.test-airoapp.ai',
    );
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });
});
