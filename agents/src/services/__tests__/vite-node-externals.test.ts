import { describe, it, expect, vi, beforeEach } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

vi.mock('../ViteConfigModifier.js', () => ({
  addNodePackageExclusions: vi.fn(),
  VITE_CONFIG_FILES: ['vite.config.ts', 'vite.config.js', 'vite.config.mjs', 'vite.config.cjs'],
}));

vi.mock('../../logging/index.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  Logger: { create: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

const { addNodePackageExclusions } = await import('../ViteConfigModifier.js');
const { ensureViteNodePackagesExcluded } = await import('../vite-node-externals.js');

const PACKAGES = ['drizzle-orm', 'mysql2'] as const;

describe('ensureViteNodePackagesExcluded', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should patch vite config when found and modified', () => {
    vi.mocked(existsSync).mockImplementation((p) => String(p).endsWith('vite.config.ts'));
    vi.mocked(readFileSync).mockReturnValue('export default {}');
    vi.mocked(addNodePackageExclusions).mockReturnValue({ code: 'patched', modified: true });

    ensureViteNodePackagesExcluded('/app', PACKAGES);

    expect(addNodePackageExclusions).toHaveBeenCalledWith('export default {}', true, PACKAGES);
    expect(writeFileSync).toHaveBeenCalledWith(expect.stringContaining('vite.config.ts'), 'patched', 'utf8');
  });

  it('should not write when no changes needed', () => {
    vi.mocked(existsSync).mockImplementation((p) => String(p).endsWith('vite.config.ts'));
    vi.mocked(readFileSync).mockReturnValue('export default {}');
    vi.mocked(addNodePackageExclusions).mockReturnValue({ code: 'same', modified: false });

    ensureViteNodePackagesExcluded('/app', PACKAGES);

    expect(writeFileSync).not.toHaveBeenCalled();
  });

  it('should handle no vite config gracefully', () => {
    vi.mocked(existsSync).mockReturnValue(false);

    ensureViteNodePackagesExcluded('/app', PACKAGES);

    expect(readFileSync).not.toHaveBeenCalled();
    expect(writeFileSync).not.toHaveBeenCalled();
  });

  it('should not throw on errors', () => {
    vi.mocked(existsSync).mockImplementation(() => { throw new Error('fs error'); });

    expect(() => ensureViteNodePackagesExcluded('/app', PACKAGES)).not.toThrow();
  });

  it('should handle .js config files as non-TypeScript', () => {
    vi.mocked(existsSync).mockImplementation((p) => String(p).endsWith('vite.config.js'));
    vi.mocked(readFileSync).mockReturnValue('export default {}');
    vi.mocked(addNodePackageExclusions).mockReturnValue({ code: 'patched', modified: true });

    ensureViteNodePackagesExcluded('/app', PACKAGES);

    expect(addNodePackageExclusions).toHaveBeenCalledWith('export default {}', false, PACKAGES);
  });

  it('should handle process error from modifier', () => {
    vi.mocked(existsSync).mockImplementation((p) => String(p).endsWith('vite.config.ts'));
    vi.mocked(readFileSync).mockReturnValue('export default {}');
    vi.mocked(addNodePackageExclusions).mockReturnValue({ code: '', modified: false, error: 'parse error' });

    ensureViteNodePackagesExcluded('/app', PACKAGES);

    expect(writeFileSync).not.toHaveBeenCalled();
  });
});

describe('database skill hook integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('database hook calls ensureViteNodePackagesExcluded with appPath', async () => {
    vi.mocked(existsSync).mockReturnValue(false);

    const { hooks } = await import('../../skills/database/tools/index.js');
    await hooks.onInstall!({ skillName: 'database', appPath: '/app/path' });

    expect(existsSync).toHaveBeenCalled();
  });

  it('database hook skips when appPath is absent', async () => {
    const { hooks } = await import('../../skills/database/tools/index.js');
    await hooks.onInstall!({ skillName: 'database' });

    expect(existsSync).not.toHaveBeenCalled();
  });
});
