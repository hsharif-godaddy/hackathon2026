import { AttachmentSubType, AttachmentType } from '@/types/inbox/local/message'

const mediaAttachmentTypes: AttachmentType[] = ['audio', 'image', 'video']

// Expanded MIME types for broader compatibility
export const mimeTypeToExtension: Record<string, string> = {
  // Archives
  'application/zip': 'zip',
  'application/x-7z-compressed': '7z',
  'application/x-zip-compressed': 'zip',
  'application/x-rar-compressed': 'rar',
  'application/gzip': 'gz',

  // Word Documents
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
    'docx',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.template':
    'dotx',

  // Excel Documents
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.template':
    'xltx',

  // PDF
  'application/pdf': 'pdf',

  // CSV
  'text/csv': 'csv',

  // Plain Text
  'text/plain': 'txt',

  // Images
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/svg+xml': 'svg',
  'image/gif': 'gif',
  'image/bmp': 'bmp',
  'image/webp': 'webp',

  // Audio
  'audio/mpeg': 'mp3',
  'audio/x-wav': 'wav',
  'audio/ogg': 'ogg',
  'audio/flac': 'flac',

  // Video
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/avi': 'avi',
  'video/mpeg': 'mpeg',
  'video/quicktime': 'mov',

  // Binary / Executables
  'application/x-msdownload': 'exe',
  'application/x-sh': 'sh',
  'application/x-bzip': 'bz',
  'application/x-bzip2': 'bz2',

  // JSON
  'application/json': 'json',

  // XML
  'application/xml': 'xml',
  'text/xml': 'xml',

  // HTML
  'text/html': 'html',

  // JavaScript
  'application/javascript': 'js',
  'text/javascript': 'js',

  // CSS
  'text/css': 'css',

  // PowerPoint
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation':
    'pptx',
  'application/vnd.oasis.opendocument.text': 'odt',
  'application/vnd.oasis.opendocument.spreadsheet': 'ods',
  'application/vnd.oasis.opendocument.presentation': 'odp',
  'application/rtf': 'rtf',
  'image/tiff': 'tiff',
  'image/tif': 'tif',

  // Markdown
  'text/markdown': 'md',

  // OpenDocument
  'application/vnd.oasis.opendocument.graphics': 'odg',
  'application/vnd.oasis.opendocument.formula': 'odf',
  'application/vnd.oasis.opendocument.database': 'odb',
  'application/vnd.oasis.opendocument.chart': 'odc',
  'application/vnd.oasis.opendocument.image': 'odi',
  'application/vnd.oasis.opendocument.text-master': 'odm',
  'application/vnd.oasis.opendocument.text-template': 'ott',
  'application/vnd.oasis.opendocument.spreadsheet-template': 'ots',
  'application/vnd.oasis.opendocument.presentation-template': 'otp',
}

export const parseMediaType = (
  mediaType: string,
): {
  type: AttachmentType
  extension?: string
  subType?: AttachmentSubType
} => {
  const generalMediaType = mediaType.split('/')[0] as AttachmentType
  const type = mediaAttachmentTypes.includes(generalMediaType)
    ? generalMediaType
    : 'document'

  switch (mediaType) {
    case 'application/zip':
    case 'application/x-7z-compressed':
    case 'application/x-zip-compressed':
    case 'application/x-rar-compressed':
    case 'application/gzip':
      return {
        type,
        subType: 'file',
        extension: mimeTypeToExtension[mediaType] || 'unknown',
      }

    case 'application/msword':
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.template':
      return {
        type,
        subType: 'word',
        extension: mimeTypeToExtension[mediaType] || 'unknown',
      }

    case 'application/vnd.ms-excel':
    case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
    case 'application/vnd.openxmlformats-officedocument.spreadsheetml.template':
      return {
        type,
        subType: 'spreadsheet',
        extension: mimeTypeToExtension[mediaType] || 'unknown',
      }

    case 'application/pdf':
      return { type, subType: 'pdf', extension: 'pdf' }

    case 'text/csv':
      return { type, subType: 'spreadsheet', extension: 'csv' }

    case 'text/plain':
      return { type, subType: 'text', extension: 'txt' }

    case 'image/png':
    case 'image/jpeg':
    case 'image/svg+xml':
    case 'image/gif':
    case 'image/bmp':
    case 'image/webp':
      return {
        type,
        subType: 'image',
        extension: mimeTypeToExtension[mediaType] || 'unknown',
      }

    case 'audio/mpeg':
    case 'audio/x-wav':
    case 'audio/ogg':
    case 'audio/flac':
      return {
        type,
        subType: 'audio',
        extension: mimeTypeToExtension[mediaType] || 'unknown',
      }

    case 'video/mp4':
    case 'video/webm':
    case 'video/avi':
    case 'video/mpeg':
    case 'video/quicktime':
      return {
        type,
        subType: 'video',
        extension: mimeTypeToExtension[mediaType] || 'unknown',
      }

    case 'application/json':
      return { type, subType: 'text', extension: 'json' }

    case 'application/xml':
    case 'text/xml':
      return { type, subType: 'text', extension: 'xml' }

    case 'text/html':
      return { type, subType: 'text', extension: 'html' }

    case 'application/javascript':
    case 'text/javascript':
      return { type, subType: 'text', extension: 'js' }

    case 'text/css':
      return { type, subType: 'text', extension: 'css' }

    case 'application/vnd.ms-powerpoint':
    case 'application/vnd.openxmlformats-officedocument.presentationml.presentation':
      return {
        type,
        subType: 'presentation',
        extension: mimeTypeToExtension[mediaType] || 'unknown',
      }

    case 'application/vnd.oasis.opendocument.text':
      return { type, subType: 'word', extension: 'odt' }

    case 'application/vnd.oasis.opendocument.spreadsheet':
      return { type, subType: 'spreadsheet', extension: 'ods' }

    case 'application/vnd.oasis.opendocument.presentation':
      return { type, subType: 'presentation', extension: 'odp' }

    case 'application/rtf':
      return { type, subType: 'text', extension: 'rtf' }

    case 'image/tiff':
    case 'image/tif':
      return {
        type,
        subType: 'image',
        extension: mimeTypeToExtension[mediaType] || 'unknown',
      }

    case 'text/markdown':
      return { type, subType: 'text', extension: 'md' }

    case 'application/vnd.oasis.opendocument.graphics':
      return { type, subType: 'image', extension: 'odg' }

    case 'application/vnd.oasis.opendocument.formula':
      return { type, subType: 'text', extension: 'odf' }

    case 'application/vnd.oasis.opendocument.database':
      return { type, subType: 'spreadsheet', extension: 'odb' }

    case 'application/vnd.oasis.opendocument.chart':
      return { type, subType: 'spreadsheet', extension: 'odc' }

    case 'application/vnd.oasis.opendocument.image':
      return { type, subType: 'image', extension: 'odi' }

    case 'application/vnd.oasis.opendocument.text-master':
      return { type, subType: 'word', extension: 'odm' }

    case 'application/vnd.oasis.opendocument.text-template':
      return { type, subType: 'word', extension: 'ott' }

    case 'application/vnd.oasis.opendocument.spreadsheet-template':
      return { type, subType: 'spreadsheet', extension: 'ots' }

    case 'application/vnd.oasis.opendocument.presentation-template':
      return { type, subType: 'presentation', extension: 'otp' }

    default:
       
      return {
        type,
        subType:
          type === 'video' ? 'video' : type === 'audio' ? 'audio' : undefined,
      }
  }
}