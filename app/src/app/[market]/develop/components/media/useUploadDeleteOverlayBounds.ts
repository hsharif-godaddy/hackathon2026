'use client';

import { type RefObject, useCallback, useLayoutEffect, useState } from 'react';

import type {
  UploadDeleteOverlayBounds,
  UploadDeleteOverlayRect,
} from './UploadDeleteConfirmationModal';

const MEDIA_DELETE_BOUNDARY_SELECTOR = '[data-media-delete-boundary]';
const MEDIA_DELETE_OVERLAY_BOUNDARY_SELECTOR = '[data-media-delete-overlay-boundary]';
const DELETE_TARGET_SELECTOR = '[data-delete-target="true"]';

interface UseUploadDeleteOverlayBoundsOptions {
  isActive: boolean;
  sectionRef: RefObject<HTMLElement | null>;
}

export function useUploadDeleteOverlayBounds({
  isActive,
  sectionRef,
}: UseUploadDeleteOverlayBoundsOptions) {
  const [deleteOverlayBounds, setDeleteOverlayBounds] =
    useState<UploadDeleteOverlayBounds | null>(null);
  const [deleteDialogBounds, setDeleteDialogBounds] =
    useState<UploadDeleteOverlayBounds | null>(null);
  const [deleteTargetBounds, setDeleteTargetBounds] = useState<UploadDeleteOverlayRect | null>(
    null
  );

  const resetDeleteOverlayBounds = useCallback(() => {
    setDeleteOverlayBounds(null);
    setDeleteDialogBounds(null);
    setDeleteTargetBounds(null);
  }, []);

  const getDeleteDialogBoundary = useCallback(() => {
    const section = sectionRef.current;
    return (
      (section?.closest(MEDIA_DELETE_BOUNDARY_SELECTOR) as HTMLElement | null) ?? section ?? null
    );
  }, [sectionRef]);

  const getDeleteOverlayBoundary = useCallback(
    (dialogBoundary: HTMLElement) =>
      (sectionRef.current?.closest(MEDIA_DELETE_OVERLAY_BOUNDARY_SELECTOR) as HTMLElement | null) ??
      dialogBoundary,
    [sectionRef]
  );

  const updateDeleteOverlayBounds = useCallback(() => {
    const dialogBoundary = getDeleteDialogBoundary();
    const dialogRect = dialogBoundary?.getBoundingClientRect();

    if (!dialogBoundary || !dialogRect || dialogRect.width === 0 || dialogRect.height === 0) {
      resetDeleteOverlayBounds();
      return;
    }

    const overlayBoundary = getDeleteOverlayBoundary(dialogBoundary);
    const overlayRect = overlayBoundary.getBoundingClientRect();
    const effectiveOverlayRect =
      overlayRect.width > 0 && overlayRect.height > 0 ? overlayRect : dialogRect;
    const target = sectionRef.current?.querySelector(DELETE_TARGET_SELECTOR);
    const targetRect = target?.getBoundingClientRect();

    setDeleteOverlayBounds({
      top: effectiveOverlayRect.top,
      left: effectiveOverlayRect.left,
      width: effectiveOverlayRect.width,
      height: effectiveOverlayRect.height,
      bottomOffset: Math.max(window.innerHeight - effectiveOverlayRect.bottom, 0),
    });
    setDeleteDialogBounds({
      top: dialogRect.top,
      left: dialogRect.left,
      width: dialogRect.width,
      height: dialogRect.height,
      bottomOffset: Math.max(window.innerHeight - dialogRect.bottom, 0),
    });
    setDeleteTargetBounds(
      targetRect && targetRect.width > 0 && targetRect.height > 0
        ? {
            top: targetRect.top,
            left: targetRect.left,
            width: targetRect.width,
            height: targetRect.height,
          }
        : null
    );
  }, [
    getDeleteDialogBoundary,
    getDeleteOverlayBoundary,
    resetDeleteOverlayBounds,
    sectionRef,
  ]);

  useLayoutEffect(
    function keepDeleteOverlayAligned() {
      if (!isActive) {
        resetDeleteOverlayBounds();
        return;
      }

      updateDeleteOverlayBounds();
      window.addEventListener('resize', updateDeleteOverlayBounds);
      window.addEventListener('scroll', updateDeleteOverlayBounds, true);

      return () => {
        window.removeEventListener('resize', updateDeleteOverlayBounds);
        window.removeEventListener('scroll', updateDeleteOverlayBounds, true);
      };
    },
    [isActive, resetDeleteOverlayBounds, updateDeleteOverlayBounds]
  );

  return {
    deleteDialogBounds,
    deleteOverlayBounds,
    deleteTargetBounds,
    resetDeleteOverlayBounds,
    updateDeleteOverlayBounds,
  };
}
