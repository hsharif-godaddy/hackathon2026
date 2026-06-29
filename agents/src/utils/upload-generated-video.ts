import { AIRO_ASSET_UPLOADS_URL_PREFIX } from '@airo/shared/media';
import { nanoid } from 'nanoid';

import { logger } from '../logging/index.js';
import { createForWorkspace } from '../workspace/index.js';

export async function uploadGeneratedVideo(appId: string, buffer: Buffer): Promise<string> {
  const workspace = createForWorkspace(appId, 'preview');
  if (!workspace?.files) {
    throw new Error('Workspace unavailable for video upload');
  }

  const filename = `ai-video-${nanoid(6)}.mp4`;
  await workspace.files.upload({
    path: `public/assets/images/${filename}`,
    data: buffer,
  });

  const publicPath = `${AIRO_ASSET_UPLOADS_URL_PREFIX}${filename}`;

  logger.info('upload-generated-video.success', { appId, filename, size: buffer.length });

  return publicPath;
}
