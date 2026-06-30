import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { FileSearch, toRelativeSearchPath } from '../file-search.js';

describe('file-search', () => {
  let tempDir: string | undefined;

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  describe('#toRelativeSearchPath', () => {
    it('strips an anchored search-root prefix', () => {
      expect(toRelativeSearchPath('/app/root', '/app/root/src/index.ts')).toBe('src/index.ts');
    });

    it('returns the full path when it does not start with the root prefix', () => {
      expect(toRelativeSearchPath('/app/root', '/other/src/index.ts')).toBe('/other/src/index.ts');
    });
  });

  describe('#search', () => {
    it('skips subtrees when skipDirectory matches a platform directory', async () => {
      tempDir = await mkdtemp(join(tmpdir(), 'file-search-'));
      await mkdir(join(tempDir, 'dev-tools', 'src'), { recursive: true });
      await writeFile(join(tempDir, 'dev-tools', 'src', 'hidden.ts'), 'payment hidden\n', 'utf8');
      await mkdir(join(tempDir, 'src'), { recursive: true });
      await writeFile(join(tempDir, 'src', 'visible.ts'), 'payment visible\n', 'utf8');

      const result = await FileSearch.search(tempDir, 'payment', {
        skipDirectory: (path) => path === 'dev-tools' || path.startsWith('dev-tools/'),
      });

      expect(result.matches.map((match) => match.path)).not.toContain('dev-tools/src/hidden.ts');
      expect(result.matches.some((match) => match.path === 'src/visible.ts')).toBe(true);
    });

    it('still descends into directories that fileBlockChecker would block for files only', async () => {
      tempDir = await mkdtemp(join(tmpdir(), 'file-search-'));
      await mkdir(join(tempDir, 'foo.log'), { recursive: true });
      await writeFile(join(tempDir, 'foo.log', 'app.ts'), 'payment nested\n', 'utf8');

      const result = await FileSearch.search(tempDir, 'payment', {
        fileBlockChecker: (path) => !path.endsWith('.log'),
      });

      expect(result.matches.some((match) => match.path === 'foo.log/app.ts')).toBe(true);
    });
  });
});
