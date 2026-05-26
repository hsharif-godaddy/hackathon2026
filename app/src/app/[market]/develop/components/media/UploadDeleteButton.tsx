'use client';

import Button from '@ux/button';
import TrashIcon from '@ux/icon/trash';

import { useTranslations } from '@/hooks/useTranslations';

const DELETE_BUTTON_CLASS = [
  'absolute right-0.5 top-0.5 z-10',
  'shadow-md',
].join(' ');

interface UploadDeleteButtonProps {
  filename: string;
  disabled?: boolean;
  onDelete: (filename: string) => void | Promise<void>;
}

export function UploadDeleteButton({
  filename,
  disabled,
  onDelete,
}: UploadDeleteButtonProps) {
  const t = useTranslations();
  const label = t('builder_common_delete', undefined, 'Delete');

  return (
    <Button
      design="critical"
      size="sm"
      type="button"
      onClick={() => {
        void onDelete(filename);
      }}
      disabled={disabled}
      aria-label={label}
      title={label}
      data-testid={`uploaded-image-delete-${filename}`}
      className={DELETE_BUTTON_CLASS}
      icon={<TrashIcon />}
    />
  );
}
