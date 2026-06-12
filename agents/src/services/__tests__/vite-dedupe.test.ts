import { describe, it, expect, vi, beforeEach } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

vi.mock('../ViteConfigModifier.js', () => ({
  processAndGenerateViteConfig: vi.fn(),
  VITE_CONFIG_FILES: ['vite.config.ts', 'vite.config.js', 'vite.config.mjs', 'vite.config.cjs'],
}));

vi.mock('../../logging/index.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  Logger: {
    create: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() })),
  },
}));

const { processAndGenerateViteConfig } = await import('../ViteConfigModifier.js');
const { ensureViteResolveDedupe } = await import('../vite-dedupe.js');

describe('ensureViteResolveDedupe', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should patch vite config when found and modified', () => {
    vi.mocked(existsSync).mockImplementation(function (p) { return String(p).endsWith('vite.config.ts'); });
    vi.mocked(readFileSync).mockReturnValue('export default {}');
    vi.mocked(processAndGenerateViteConfig).mockReturnValue({ code: 'patched', modified: true });

    ensureViteResolveDedupe('/app');

    expect(writeFileSync).toHaveBeenCalledWith(expect.stringContaining('vite.config.ts'), 'patched', 'utf8');
  });

  it('should not write when no changes needed', () => {
    vi.mocked(existsSync).mockImplementation(function (p) { return String(p).endsWith('vite.config.ts'); });
    vi.mocked(readFileSync).mockReturnValue('export default {}');
    vi.mocked(processAndGenerateViteConfig).mockReturnValue({ code: 'same', modified: false });

    ensureViteResolveDedupe('/app');

    expect(writeFileSync).not.toHaveBeenCalled();
  });

  it('should handle no vite config gracefully', () => {
    vi.mocked(existsSync).mockReturnValue(false);

    ensureViteResolveDedupe('/app');

    expect(readFileSync).not.toHaveBeenCalled();
    expect(writeFileSync).not.toHaveBeenCalled();
  });

  it('should not throw on errors', () => {
    vi.mocked(existsSync).mockImplementation(function () { throw new Error('fs error'); });

    expect(() => ensureViteResolveDedupe('/app')).not.toThrow();
  });
});

describe('skill hook integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('authentication hook calls ensureViteResolveDedupe with appPath', async () => {
    vi.mocked(existsSync).mockReturnValue(false);

    const { hooks } = await import('../../skills/authentication/tools/index.js');
    await hooks.onInstall!({ skillName: 'authentication', appPath: '/app/path' });

    expect(existsSync).toHaveBeenCalled();
  });

  it('authentication hook skips when appPath is absent', async () => {
    const { hooks } = await import('../../skills/authentication/tools/index.js');
    await hooks.onInstall!({ skillName: 'authentication' });

    expect(existsSync).not.toHaveBeenCalled();
  });

  it('online-appointments hook calls ensureViteResolveDedupe with appPath', async () => {
    vi.mocked(existsSync).mockReturnValue(false);

    const { hooks } = await import('../../skills/online-appointments/tools/index.js');
    await hooks.onInstall!({ skillName: 'online-appointments', appPath: '/app/path' });

    expect(existsSync).toHaveBeenCalled();
  });

  it('online-appointments hook skips when appPath is absent', async () => {
    const { hooks } = await import('../../skills/online-appointments/tools/index.js');
    await hooks.onInstall!({ skillName: 'online-appointments' });

    expect(existsSync).not.toHaveBeenCalled();
  });
});
