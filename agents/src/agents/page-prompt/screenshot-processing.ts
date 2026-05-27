/**
 * Convert a base64 screenshot data URL into the AI-lib `ProcessedFile`
 * shape that `agent.generate(prompt, { files })` expects.
 *
 * Returns `[]` (no files) on any failure — screenshot is a hint, not a
 * hard requirement, and a corrupt/missing one shouldn't abort the rebuild.
 */
import { createFileInputFromBuffer, processFile, type ProcessedFile } from '@airo/ai-lib';

import { Logger } from '../../logging/index.js';
import { parseScreenshotDataUrl, screenshotFilenameForMime } from '../screenshot-data-url.js';

const logger = Logger.create({ component: 'page-prompt-agent' });

export async function processScreenshot(screenshotBase64: string | undefined): Promise<ProcessedFile[]> {
  if (!screenshotBase64) return [];

  const parsed = parseScreenshotDataUrl(screenshotBase64);
  if (!parsed) return [];

  try {
    const fileInput = createFileInputFromBuffer(
      parsed.buffer,
      parsed.mimeType,
      screenshotFilenameForMime(parsed.mimeType)
    );
    const processed = await processFile(fileInput);
    return [processed];
  } catch (error) {
    logger.warn('page-prompt-agent.screenshot-processing-failed', {
      error: error instanceof Error ? error.message : String(error)
    });
    return [];
  }
}
