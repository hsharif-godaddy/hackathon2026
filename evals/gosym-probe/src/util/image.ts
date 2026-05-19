import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

export async function toDataUrl(filePath: string): Promise<string> {
  const mime: string = MIME_BY_EXT[extname(filePath).toLowerCase()] ?? 'image/png';
  const buf: Buffer = await readFile(filePath);
  return `data:${mime};base64,${buf.toString('base64')}`;
}
