import { describe, it, expect } from 'vitest';

import {
  isPlatformInfrastructurePath,
  platformInfrastructureExcludeGlobs,
} from '../platform-paths.js';

describe('platform-paths', () => {
  describe('#isPlatformInfrastructurePath', () => {
    it('matches platform directories at the project root', () => {
      expect(isPlatformInfrastructurePath('dev-tools')).toBe(true);
      expect(isPlatformInfrastructurePath('dev-tools/src/index.ts')).toBe(true);
      expect(isPlatformInfrastructurePath('source-mapper/src/index.ts')).toBe(true);
      expect(isPlatformInfrastructurePath('airo-secrets/config.ts')).toBe(true);
    });

    it('matches platform files at the project root', () => {
      expect(isPlatformInfrastructurePath('fullstory-plugin.ts')).toBe(true);
    });

    it('does not treat nested customer files with the same basename as platform files', () => {
      expect(isPlatformInfrastructurePath('src/utils/fullstory-plugin.ts')).toBe(false);
    });

    it('does not match customer app source files', () => {
      expect(isPlatformInfrastructurePath('src/pages/index.tsx')).toBe(false);
      expect(isPlatformInfrastructurePath('content-lib/foo.ts')).toBe(false);
    });

    it('normalizes windows separators and leading ./ prefixes', () => {
      expect(isPlatformInfrastructurePath('.\\dev-tools\\src\\index.ts')).toBe(true);
      expect(isPlatformInfrastructurePath('./dev-tools/src/index.ts')).toBe(true);
    });
  });

  describe('#platformInfrastructureExcludeGlobs', () => {
    it('returns negated ripgrep globs for each platform path', () => {
      const globs = platformInfrastructureExcludeGlobs();
      expect(globs).toContain('!dev-tools/**');
      expect(globs).toContain('!source-mapper/**');
      expect(globs).toContain('!/fullstory-plugin.ts');
    });
  });
});
