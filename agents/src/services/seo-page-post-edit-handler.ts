/**
 * Post-edit handler that validates SEO completeness on v8 page files (AC3).
 *
 * Fires on every write to src/pages/*.tsx. Reads the current file content,
 * validates required SEO elements, and records the result in SeoPageRegistry
 * so todo-list-tool can gate mark_done on completeness.
 *
 * SEO generation is handled by the develop/seo.md primer — this handler
 * only validates and records; it does not inject.
 */

import { readFile } from 'node:fs/promises';
import { relative } from 'node:path';

import { logger } from '../logging/index.js';
import type {
  PostEditContext,
  PostEditHandler,
} from '../tools/ai-lib-tools/post-edit-handlers.js';
import { isPageFile, validateSeoSource } from './SeoPageInjector.js';
import { recordPageSeoState } from './SeoPageRegistry.js';

export const seoPagePostEditHandler: PostEditHandler = {
  name: 'seo-page-validate',

  matches(relPath: string): boolean {
    return isPageFile(relPath);
  },

  async run(context: PostEditContext, result: string): Promise<string> {
    const { appId, appPath, fullPath, filePath } = context;
    const relPath = relative(appPath, fullPath);

    let content: string;
    try {
      content = await readFile(fullPath, 'utf-8');
    } catch (err) {
      logger.warn('seo.page.validate.read-failed', {
        appId,
        filePath,
        error: err instanceof Error ? err.message : String(err),
      });
      return result;
    }

    const { blocking, advisory } = validateSeoSource(content);
    recordPageSeoState(appId, relPath, blocking);
    logger.info('seo.page.validate', {
      appId,
      filePath,
      missingCount: blocking.length,
      advisoryCount: advisory.length,
    });

    return result;
  },
};
