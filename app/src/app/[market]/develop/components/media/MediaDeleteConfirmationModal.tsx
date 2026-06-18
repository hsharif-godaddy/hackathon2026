'use client';

import Box from '@ux/box';
import Button from '@ux/button';
import Modal from '@ux/modal';
import text from '@ux/text';

import { useTranslations } from '@/hooks/useTranslations';

interface MediaDeleteConfirmationModalProps {
  isVideo: boolean;
  imageUrl: string | null;
  alt?: string;
  isDeleting: boolean;
  error?: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}

export function MediaDeleteConfirmationModal({
  isVideo,
  imageUrl,
  alt,
  isDeleting,
  error,
  onCancel,
  onConfirm,
}: MediaDeleteConfirmationModalProps) {
  const t = useTranslations();

  return (
    <Modal
      title={t('builder_media_delete_title', undefined, 'Delete this element?')}
      // Ignore close/backdrop/Escape mid-delete so the request can't be abandoned in flight.
      onClose={isDeleting ? undefined : onCancel}
      ariaLabels={{ close: t('builder_common_close', undefined, 'Close') }}
      actionAlignment="end"
      actions={
        <Box orientation="horizontal" gap="md">
          <Button
            design="secondary"
            text={t('builder_common_cancel')}
            onClick={onCancel}
            disabled={isDeleting}
          />
          <Button
            design="critical"
            text={isDeleting ? t('builder_common_deleting') : t('builder_common_delete')}
            onClick={onConfirm}
            disabled={isDeleting}
          />
        </Box>
      }
    >
      {imageUrl && (
        <div className="mb-3 overflow-hidden rounded-md border border-intents-ux-box-borderColor">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imageUrl}
            alt={alt ?? ''}
            className="max-h-40 w-full object-cover"
          />
        </div>
      )}
      <text.p>
        {isVideo
          ? t(
              'builder_media_delete_body_video',
              undefined,
              'This video will be removed from the page. This action can be undone from version history.'
            )
          : t(
              'builder_media_delete_body_image',
              undefined,
              'This image will be removed from the page. This action can be undone from version history.'
            )}
      </text.p>
      {error && (
        <p role="alert" className="mt-2 text-sm text-intents-ux-feedbackHighContrastCritical-feedbackColor">
          {error}
        </p>
      )}
    </Modal>
  );
}
