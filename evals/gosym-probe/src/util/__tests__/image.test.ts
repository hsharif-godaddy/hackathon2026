import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { toDataUrl } from '../image.js';

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), 'image-test-'));
});

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

describe('toDataUrl', () => {
  it('encodes a PNG file as a base64 data URL', async () => {
    const filePath = join(tmpRoot, 'tile.png');
    const content = Buffer.from('fake-png-data');
    await writeFile(filePath, content);

    const result = await toDataUrl(filePath);

    expect(result).toBe(
      `data:image/png;base64,${content.toString('base64')}`,
    );
  });

  it('infers image/jpeg MIME for .jpg extension', async () => {
    const filePath = join(tmpRoot, 'photo.jpg');
    await writeFile(filePath, Buffer.from('jpg-data'));

    const result = await toDataUrl(filePath);

    expect(result).toMatch(/^data:image\/jpeg;base64,/);
  });

  it('infers image/jpeg MIME for .jpeg extension', async () => {
    const filePath = join(tmpRoot, 'photo.jpeg');
    await writeFile(filePath, Buffer.from('jpeg-data'));

    const result = await toDataUrl(filePath);

    expect(result).toMatch(/^data:image\/jpeg;base64,/);
  });

  it('infers image/webp MIME for .webp extension', async () => {
    const filePath = join(tmpRoot, 'image.webp');
    await writeFile(filePath, Buffer.from('webp-data'));

    const result = await toDataUrl(filePath);

    expect(result).toMatch(/^data:image\/webp;base64,/);
  });

  it('falls back to image/png for unknown extensions', async () => {
    const filePath = join(tmpRoot, 'image.bmp');
    await writeFile(filePath, Buffer.from('bmp-data'));

    const result = await toDataUrl(filePath);

    expect(result).toMatch(/^data:image\/png;base64,/);
  });

  it('handles uppercase extensions', async () => {
    const filePath = join(tmpRoot, 'PHOTO.JPG');
    await writeFile(filePath, Buffer.from('jpg-data'));

    const result = await toDataUrl(filePath);

    expect(result).toMatch(/^data:image\/jpeg;base64,/);
  });
});
