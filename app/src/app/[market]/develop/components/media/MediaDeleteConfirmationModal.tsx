'use client';

import { useEffect, useRef } from 'react';
import Button from '@ux/button';
import XIcon from '@ux/icon/x';

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
  const titleId = 'media-delete-confirmation-title';
  const descriptionId = 'media-delete-confirmation-description';
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        data-testid="media-delete-overlay"
        className="absolute inset-0 bg-intents-ux-boxHighContrastOverlay-backgroundColor opacity-70"
        aria-hidden="true"
        onClick={isDeleting ? undefined : onCancel}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        data-testid="media-delete-confirmation-card"
        className="relative z-10 w-full max-w-sm rounded-lg border border-intents-ux-box-borderColor bg-intents-ux-box-backgroundColor p-4 shadow-2xl"
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !isDeleting) {
            onCancel();
          }
        }}
      >
        <div className="flex items-start justify-between gap-2">
          <h2 id={titleId} className="text-lg font-semibold leading-tight">
            {t('builder_media_delete_title', undefined, 'Delete this element?')}
          </h2>
          <button
            type="button"
            onClick={onCancel}
            disabled={isDeleting}
            aria-label={t('builder_common_close', undefined, 'Close')}
            className="flex size-5 shrink-0 items-center justify-center rounded-md bg-intents-ux-boxLowContrast-backgroundColor text-intents-ux-feedbackHighContrastPassive-feedbackColor transition-colors hover:cursor-pointer hover:text-intents-ux-box-foregroundColor disabled:cursor-not-allowed disabled:opacity-50"
          >
            <XIcon className="size-2.5" />
          </button>
        </div>
        {imageUrl && (
          <div className="mt-3 overflow-hidden rounded-md border border-intents-ux-box-borderColor">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={imageUrl}
              alt={alt ?? ''}
              className="max-h-40 w-full object-cover"
            />
          </div>
        )}
        <div className="mt-3 flex flex-col gap-2 text-sm">
          <p id={descriptionId}>
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
          </p>
          {error && (
            <p role="alert" className="text-sm text-intents-ux-feedbackHighContrastCritical-feedbackColor">
              {error}
            </p>
          )}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button
            ref={cancelRef}
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
        </div>
      </div>
    </div>
  );
}
