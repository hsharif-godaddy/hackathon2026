import { join } from 'path';
import { Logger } from '../logging/index.js';

const logger = Logger.create({ component: 'template-context' });

export type TemplateContextConfig =
  | { mode: 'none' }
  | { mode: 'summary' }
  | { mode: 'listing' }
  | { mode: 'files'; paths: string[] };

export interface FileOps {
  readFile: (path: string) => Promise<string>;
  listDir: (path: string) => Promise<string[]>;
}

export async function resolveTemplateContext(
  config: TemplateContextConfig,
  appPath: string,
  ops: FileOps
): Promise<string> {
  switch (config.mode) {
    case 'none':
      return '';

    case 'summary': {
      // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
      const filePath = join(appPath, 'docs/reference/summary.md');
      try {
        return await ops.readFile(filePath);
      } catch (err) {
        logger.warn('template-context.summary.read_failed', { appPath, error: err instanceof Error ? err.message : String(err) });
        return '';
      }
    }

    case 'listing': {
      // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
      const dirPath = join(appPath, 'docs/reference/');
      try {
        const files = await ops.listDir(dirPath);
        return files.map((f: string) => `- ${f}`).join('\n');
      } catch (err) {
        logger.warn('template-context.listing.read_failed', { appPath, error: err instanceof Error ? err.message : String(err) });
        return '';
      }
    }

    case 'files': {
      const contents: string[] = [];
      for (const relativePath of config.paths) {
        // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
        const filePath = join(appPath, relativePath);
        try {
          const content = await ops.readFile(filePath);
          contents.push(content);
        } catch (err) {
          logger.warn('template-context.file.read_failed', { appPath, relativePath, error: err instanceof Error ? err.message : String(err) });
        }
      }
      return contents.join('\n---\n');
    }
  }
}
