import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { logger } from '../logging/index.js';

export const IMAGE_SLOT_URL_PREFIX = '/airo-assets/images/';

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);

export function imageSlotUrl(slotPath: string): string {
  return `${IMAGE_SLOT_URL_PREFIX}${slotPath}`;
}

/** Extract slot path from a relative or absolute /airo-assets/images/ URL. */
export function parseImageSlotPath(url: string | null | undefined): string | null {
  if (!url) {
    return null;
  }
  const match = url.match(/\/airo-assets\/images\/(.+?)(?:\?|$)/);
  return match?.[1] ?? null;
}

export { isSharedSlotReference, parseCollectionOccurrenceIndex } from '@airo/shared/media';

export async function countSlotUrlReferences(appPath: string, slotPath: string): Promise<number> {
  const urlNeedle = imageSlotUrl(slotPath);
  const pathNeedles = [`'${slotPath}'`, `"${slotPath}"`];
  let count = 0;
  const srcDir = path.join(appPath, 'src');

  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (error) {
      logger.warn('slot_reference_utils.count.read_failed', {
        dir,
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      if (!entry.isFile() || !SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
        continue;
      }

      const content = await readFile(fullPath, 'utf-8');
      for (const needle of [urlNeedle, ...pathNeedles]) {
        let start = 0;
        while (true) {
          const index = content.indexOf(needle, start);
          if (index === -1) {
            break;
          }
          count += 1;
          start = index + needle.length;
        }
      }
    }
  }

  await walk(srcDir);
  return count;
}

export function buildForkedSlotPath(baseSlotPath: string, manifest: Record<string, unknown>): string {
  let counter = 2;
  while (manifest[`${baseSlotPath}-${counter}`]) {
    counter += 1;
  }
  return `${baseSlotPath}-${counter}`;
}
