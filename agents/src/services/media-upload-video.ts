export const VIDEO_MIME_TYPE = {
  MP4: 'video/mp4',
  WEBM: 'video/webm',
  QUICKTIME: 'video/quicktime',
} as const;

export const ALLOWED_VIDEO_TYPES: Record<string, string> = {
  [VIDEO_MIME_TYPE.MP4]: 'mp4',
  [VIDEO_MIME_TYPE.WEBM]: 'webm',
  [VIDEO_MIME_TYPE.QUICKTIME]: 'mov',
};

export function validateVideoMagicBytes(buffer: Buffer, mimeType: string): boolean {
  if (buffer.length < 12) return false;

  if (mimeType === VIDEO_MIME_TYPE.WEBM) {
    return buffer[0] === 0x1A && buffer[1] === 0x45 && buffer[2] === 0xDF && buffer[3] === 0xA3;
  }

  if (mimeType === VIDEO_MIME_TYPE.MP4 || mimeType === VIDEO_MIME_TYPE.QUICKTIME) {
    return buffer.toString('ascii', 4, 8) === 'ftyp';
  }

  return false;
}
