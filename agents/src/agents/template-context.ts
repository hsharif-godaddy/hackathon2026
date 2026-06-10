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
      const filePath = join(appPath, 'docs/reference/summary.md');
      try {
        return await ops.readFile(filePath);
      } catch (err) {
        logger.debug('template-context.summary.read_failed', { appPath, error: err instanceof Error ? err.message : String(err) });
        return '';
      }
    }

    case 'listing': {
      const dirPath = join(appPath, 'docs/reference/');
      try {
        const files = await ops.listDir(dirPath);
        return files.map((f: string) => `- ${f}`).join('\n');
      } catch (err) {
        logger.debug('template-context.listing.read_failed', { appPath, error: err instanceof Error ? err.message : String(err) });
        return '';
      }
    }

    case 'files': {
      const contents: string[] = [];
      for (const relativePath of config.paths) {
        const filePath = join(appPath, relativePath);
        try {
          const content = await ops.readFile(filePath);
          contents.push(content);
        } catch {
          // Skip missing files — expected for new apps without reference docs
        }
      }
      return contents.join('\n---\n');
    }
  }
}
