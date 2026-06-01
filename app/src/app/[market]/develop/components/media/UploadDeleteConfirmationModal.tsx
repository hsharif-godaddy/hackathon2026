'use client';

import Button from '@ux/button';
import XIcon from '@ux/icon/x';

import { useTranslations } from '@/hooks/useTranslations';

export interface UploadDeleteOverlayRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface UploadDeleteOverlayBounds extends UploadDeleteOverlayRect {
  bottomOffset: number;
}

interface UploadDeleteConfirmationModalProps {
  otherUsageLocations: string[];
  canRemoveFromCurrentSlot: boolean;
  isDeleting: boolean;
  isVideo?: boolean;
  error?: string | null;
  /** Outer region that receives the dimmed overlay. */
  overlayBounds?: UploadDeleteOverlayBounds | null;
  /** Inner media-detail region used to position the confirmation card. */
  bounds?: UploadDeleteOverlayBounds | null;
  targetBounds?: UploadDeleteOverlayRect | null;
  onCancel: () => void;
  onRemoveFromCurrentSlot: () => void;
  onDeleteEverywhere: () => void;
}

const SPOTLIGHT_PADDING = 4;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function UploadDeleteConfirmationModal({
  otherUsageLocations,
  canRemoveFromCurrentSlot,
  isDeleting,
  isVideo,
  error,
  overlayBounds,
  bounds,
  targetBounds,
  onCancel,
  onRemoveFromCurrentSlot,
  onDeleteEverywhere,
}: UploadDeleteConfirmationModalProps) {
  const t = useTranslations();
  const showSeparateActions = canRemoveFromCurrentSlot && otherUsageLocations.length > 0;
  const titleId = 'upload-delete-confirmation-title';
  const descriptionId = 'upload-delete-confirmation-description';
  const effectiveOverlayBounds = overlayBounds ?? bounds;
  const overlayStyle = effectiveOverlayBounds
    ? {
        top: effectiveOverlayBounds.top,
        left: effectiveOverlayBounds.left,
        width: effectiveOverlayBounds.width,
        height: effectiveOverlayBounds.height,
      }
    : undefined;
  const dialogStyle = bounds
    ? {
        left: bounds.left + 16,
        bottom: bounds.bottomOffset + 16,
        width: Math.max(bounds.width - 32, 0),
      }
    : undefined;
  const targetTop =
    effectiveOverlayBounds && targetBounds
      ? clamp(
          targetBounds.top - effectiveOverlayBounds.top - SPOTLIGHT_PADDING,
          0,
          effectiveOverlayBounds.height
        )
      : 0;
  const targetLeft =
    effectiveOverlayBounds && targetBounds
      ? clamp(
          targetBounds.left - effectiveOverlayBounds.left - SPOTLIGHT_PADDING,
          0,
          effectiveOverlayBounds.width
        )
      : 0;
  const targetRight =
    effectiveOverlayBounds && targetBounds
      ? clamp(
          targetBounds.left -
            effectiveOverlayBounds.left +
            targetBounds.width +
            SPOTLIGHT_PADDING,
          0,
          effectiveOverlayBounds.width
        )
      : 0;
  const targetBottom =
    effectiveOverlayBounds && targetBounds
      ? clamp(
          targetBounds.top -
            effectiveOverlayBounds.top +
            targetBounds.height +
            SPOTLIGHT_PADDING,
          0,
          effectiveOverlayBounds.height
        )
      : 0;
  const targetHeight = Math.max(targetBottom - targetTop, 0);
  const overlaySegments =
    effectiveOverlayBounds && targetBounds
      ? [
          {
            key: 'top',
            top: 0,
            left: 0,
            width: effectiveOverlayBounds.width,
            height: targetTop,
          },
          {
            key: 'left',
            top: targetTop,
            left: 0,
            width: targetLeft,
            height: targetHeight,
          },
          {
            key: 'right',
            top: targetTop,
            left: targetRight,
            width: Math.max(effectiveOverlayBounds.width - targetRight, 0),
            height: targetHeight,
          },
          {
            key: 'bottom',
            top: targetBottom,
            left: 0,
            width: effectiveOverlayBounds.width,
            height: Math.max(effectiveOverlayBounds.height - targetBottom, 0),
          },
        ].filter((segment) => segment.width > 0 && segment.height > 0)
      : [];

  return (
    <>
      <div
        data-testid="upload-delete-panel-overlay"
        className={`pointer-events-none z-30 overflow-hidden rounded-tr-lg ${
          bounds ? 'fixed' : 'absolute inset-0'
        }`}
        style={overlayStyle}
        aria-hidden="true"
      >
        {overlaySegments.length > 0 ? (
          overlaySegments.map((segment) => (
            <div
              key={segment.key}
              className="absolute bg-intents-ux-boxHighContrastOverlay-backgroundColor opacity-70"
              style={{
                top: segment.top,
                left: segment.left,
                width: segment.width,
                height: segment.height,
              }}
            />
          ))
        ) : (
          <div className="absolute inset-0 bg-intents-ux-boxHighContrastOverlay-backgroundColor opacity-70" />
        )}
      </div>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('builder_common_confirm')}
        aria-describedby={descriptionId}
        data-testid="upload-delete-confirmation-card"
        className={`z-50 rounded-lg border border-intents-ux-box-borderColor bg-intents-ux-box-backgroundColor p-3 shadow-2xl ${
          bounds ? 'fixed' : 'absolute inset-x-0 bottom-0 mx-2'
        }`}
        style={dialogStyle}
      >
        <div className="flex items-start justify-between gap-2">
          <h2 id={titleId} className="text-lg font-semibold leading-tight">
            {t('builder_mediaslot_delete_confirm_title', undefined, 'Before delete...')}
          </h2>
          <button
            type="button"
            onClick={onCancel}
            disabled={isDeleting}
            aria-label={t('builder_common_cancel')}
            className="flex size-5 shrink-0 items-center justify-center rounded-md bg-intents-ux-boxLowContrast-backgroundColor text-intents-ux-textSubtle-textColor transition-colors hover:cursor-pointer hover:text-intents-ux-text-textColor disabled:cursor-not-allowed disabled:opacity-50"
          >
            <XIcon className="size-2.5" />
          </button>
        </div>
        <div className="mt-2 flex flex-col gap-2 text-sm">
          <p id={descriptionId}>
            {t(
              'builder_mediaslot_delete_confirm_description',
              undefined,
              isVideo
                ? 'Are you sure you want to delete this video?'
                : 'Are you sure you want to delete this image?'
            )}
          </p>
          {otherUsageLocations.length > 0 && (
            <div className="flex flex-col gap-1">
              <p>
                {t(
                  'builder_mediaslot_delete_confirm_also_used_in',
                  undefined,
                  isVideo
                    ? 'This video is also used in:'
                    : 'This image is also used in:'
                )}
              </p>
              <ul className="m-0 list-none p-0">
                {otherUsageLocations.map((location) => (
                  <li key={location} className="underline underline-offset-2">
                    {location}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {showSeparateActions && (
            <p className="mt-2 text-intents-ux-textSubtle-textColor">
              {t(
                'builder_mediaslot_delete_confirm_choose_proceed',
                undefined,
                'Choose how you want to proceed:'
              )}
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm text-intents-ux-error-textColor">
              {error}
            </p>
          )}
        </div>
        <div className="mt-4 flex flex-col items-center gap-2">
          <Button
            design={showSeparateActions ? 'primary' : 'critical'}
            text={
              isDeleting
                ? t('builder_common_deleting')
                : showSeparateActions
                  ? t(
                      'builder_mediaslot_delete_confirm_only_this_slot',
                      undefined,
                      'Only remove in this slot'
                    )
                  : t('builder_common_delete')
            }
            onClick={showSeparateActions ? onRemoveFromCurrentSlot : onDeleteEverywhere}
            disabled={isDeleting}
            className="w-full max-w-[14rem] justify-center"
          />
          {showSeparateActions && (
            <Button
              design="critical"
              text={
                isDeleting
                  ? t('builder_common_deleting')
                  : t(
                      'builder_mediaslot_delete_confirm_everywhere',
                      undefined,
                      'Delete everywhere'
                    )
              }
              onClick={onDeleteEverywhere}
              disabled={isDeleting}
              className="w-full max-w-[14rem] justify-center"
            />
          )}
        </div>
      </div>
    </>
  );
}
