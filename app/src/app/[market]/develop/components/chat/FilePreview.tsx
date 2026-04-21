'use client'

import clsx from 'clsx';
import Button from '@ux/button';
import PageIcon from '@ux/icon/page';
import XIcon from '@ux/icon/x';

import { useTranslations } from '@/hooks/useTranslations';
export interface FileAttachment {
  uploadId: string;
  fileId: string;
  filename: string;
  mimeType: string;
  size: number;
  url: string;
}

interface FilePreviewProps {
  file: FileAttachment;
  onRemove?: () => void;
}

export default function FilePreview({ file, onRemove }: FilePreviewProps) {
  const t = useTranslations();
  const isImage = file.mimeType.startsWith('image/');
  const extension = file.mimeType.split('/')[1]?.toUpperCase() || 'FILE';

  if (isImage) {
    return (
      <div className="relative inline-block">
        <img /* eslint-disable-line @next/next/no-img-element */
          src={file.url}
          alt={file.filename}
          className="max-w-[200px] max-h-[200px] rounded-md object-cover"
        />
        {onRemove && (
          <button
            onClick={onRemove}
            className="absolute top-1 right-1 p-1 bg-neutral-950 rounded-full hover:bg-neutral-800 transition-colors"
            aria-label={t('builder_common_remove_file')}
          >
            <XIcon className="w-4 h-4 text-neutral-50" />
          </button>
        )}
      </div>
    );
  }

  // Non-image file
  return (
    <div className={clsx(
      "flex items-center gap-2 px-3 py-2 rounded-md",
      "bg-intents-ux-box-backgroundColor border border-intents-ux-box-borderColor"
    )}>
      <PageIcon className="w-4 h-4" />
      <span className="text-sm font-medium truncate max-w-[150px]">
        {file.filename}
      </span>
      <span className="text-xs px-1.5 py-0.5 rounded bg-neutral-200 text-neutral-700">
        {extension}
      </span>
      {onRemove && (
        <Button
          onClick={onRemove}
          design="tertiary"
          size="sm"
          aria-label={t('builder_common_remove_file')}
        >
          <XIcon className="w-3 h-3" />
        </Button>
      )}
    </div>
  );
}
