'use client';

import clsx from 'clsx';
import Button from '@ux/button';
import TrashIcon from '@ux/icon/trash';

import { useTranslations } from '@/hooks/useTranslations';

// Hidden until the tile is hovered (desktop) or the button is keyboard-focused
// (a11y). On touch, where there's no hover, the parent reveals it via long-press
// and passes `revealed`. transition-opacity keeps the fade smooth.
const DELETE_BUTTON_CLASS: string = clsx(
  'absolute right-0.5 top-0.5 z-10 shadow-md transition-opacity',
  'opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
);

interface UploadDeleteButtonProps {
  filename: string;
  disabled?: boolean;
  onDelete: (filename: string) => void | Promise<void>;
  /** Force the button visible even without hover (e.g. after a mobile long-press). */
  revealed?: boolean;
}

export function UploadDeleteButton({
  filename,
  disabled,
  onDelete,
  revealed,
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
      className={clsx(DELETE_BUTTON_CLASS, revealed && 'opacity-100')}
      icon={<TrashIcon />}
    />
  );
}
