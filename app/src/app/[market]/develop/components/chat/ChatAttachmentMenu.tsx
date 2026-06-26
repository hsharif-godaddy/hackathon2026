'use client'

import { ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';
import Button from '@ux/button';
import CloudUploadIcon from '@ux/icon/cloud-upload';
import ImageIcon from '@ux/icon/image';
import ImageGalleryIcon from '@ux/icon/image-gallery';
import PageIcon from '@ux/icon/page';
import PlusIcon from '@ux/icon/plus';

import FileReferenceModal from '@/app/[market]/develop/components/chat/FileReferenceModal';
import { SWITCHBOARD_APPBUILDER_MEDIA_CANVAS } from '@/config/switchboard-flags';
import { useSwitchboard } from '@/hooks/useSwitchboard';
import { useTranslations } from '@/hooks/useTranslations';
import { logger } from '@/lib/request-context';
import { Popover, PopoverContent, PopoverTrigger } from '@/lib/shadcn/popover';
import { ACCEPTED_UPLOAD_FILE_TYPES } from '@/utils/file-types';
import { validateForStaging } from '@/utils/file-upload-validation';
import { logClickEvent } from '@/utils/instrumentation';

export type { UploadedFile } from '@/app/[market]/develop/components/chat/FileUploadButton';

interface ChatAttachmentMenuProps {
  appId: string;
  /** Stage files locally; upload runs when the user sends the message */
  onStageFiles: (files: File[]) => void;
  onScreenshotCaptured?: (dataUrl: string) => void | Promise<void>;
  onFileReferencesSelected?: (filePaths: string[]) => void;
  onMediaLibrary?: () => void;
  onUploadError?: (errorMessage?: string) => void;
  disabled?: boolean;
}

export default function ChatAttachmentMenu({
  appId,
  onStageFiles,
  onScreenshotCaptured,
  onFileReferencesSelected,
  onMediaLibrary,
  onUploadError,
  disabled = false
}: ChatAttachmentMenuProps) {
  const t = useTranslations();
  const isMediaCanvasEnabled = useSwitchboard(SWITCHBOARD_APPBUILDER_MEDIA_CANVAS) === true;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const [showFileReferenceModal, setShowFileReferenceModal] = useState(false);
  const [isScreenCaptureSupported, setIsScreenCaptureSupported] = useState(false);

  useEffect(() => {
    setIsScreenCaptureSupported(typeof navigator?.mediaDevices?.getDisplayMedia === 'function');
  }, []);

  const clickContext = useMemo(() => (appId ? { appId } : undefined), [appId]);

  const handleFileButtonClick = () => {
    logClickEvent('develop.attachment_menu.file', clickContext)();
    setOpen(false);
    fileInputRef.current?.click();
  };

  const handleFileReferenceClick = () => {
    logClickEvent('develop.attachment_menu.reference', clickContext)();
    setOpen(false);
    setShowFileReferenceModal(true);
  };

  const handleFileReferencesSelected = (filePaths: string[]) => {
    if (onFileReferencesSelected) {
      onFileReferencesSelected(filePaths);
    }
    setShowFileReferenceModal(false);
  };

  const handleFileSelect = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);

    if (files.length === 0) {
      return;
    }

    const validationError = validateForStaging(files, t);
    if (validationError) {
      onUploadError?.(validationError);
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    logger.debug('chat-attachment.stage-from-picker', {
      appId,
      fileCount: files.length,
      totalSize: files.reduce((sum, f) => sum + f.size, 0)
    });

    onStageFiles(files);

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleScreenshotClick = async () => {
    logClickEvent('develop.attachment_menu.screenshot', clickContext)();
    setOpen(false);
    setIsCapturing(true);

    let stream: MediaStream | null = null;

    try {
      logger.info('screenshot-capture.chat.start', { appId });

      // Request screen capture using native browser API
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          mediaSource: 'screen' as MediaStreamConstraints['video'] & { mediaSource?: string }
        } as MediaTrackConstraints,
        audio: false
      });

      // Get video track from stream
      const track = stream.getVideoTracks()[0];
      if (!track) {
        throw new Error('No video track found in stream');
      }

      // Create video element to capture frame
      const video = document.createElement('video');
      video.srcObject = stream;
      video.autoplay = true;
      video.playsInline = true;

      // Wait for video to be ready
      await new Promise<void>((resolve, reject) => {
        video.onloadedmetadata = () => {
          video.play()
            .then(() => resolve())
            .catch(reject);
        };
        video.onerror = () => reject(new Error('Failed to load video'));
      });

      // Give video a moment to render first frame
      await new Promise(resolve => setTimeout(resolve, 100));

      // Capture frame to canvas
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');

      if (!ctx) {
        throw new Error('Failed to get canvas context');
      }

      ctx.drawImage(video, 0, 0);

      // Resize to 1024px wide - balance between readability and token usage
      // Higher quality needed for AI to accurately read UI elements and text
      const targetWidth = 1024;
      const scale = targetWidth / canvas.width;
      const targetHeight = Math.round(canvas.height * scale);

      const resizeCanvas = document.createElement('canvas');
      resizeCanvas.width = targetWidth;
      resizeCanvas.height = targetHeight;
      const resizeCtx = resizeCanvas.getContext('2d');

      if (!resizeCtx) {
        throw new Error('Failed to get resize canvas context');
      }

      resizeCtx.drawImage(canvas, 0, 0, targetWidth, targetHeight);

      // Convert to JPEG with 0.75 quality - balance between file size and accuracy
      // Lower quality caused AI hallucinations due to loss of detail
      const dataUrl = resizeCanvas.toDataURL('image/jpeg', 0.75);

      logger.info('screenshot-capture.chat.success', {
        appId,
        dataUrlLength: dataUrl.length,
        originalSize: { width: canvas.width, height: canvas.height },
        resizedSize: { width: targetWidth, height: targetHeight }
      });

      // Pass screenshot data URL to parent. The handler may upload asynchronously
      // (ChatPane.handleScreenshotCaptured) and has post-finally code that could
      // throw — handle that here so it never becomes an unhandled rejection.
      if (onScreenshotCaptured) {
        const capture = onScreenshotCaptured(dataUrl);
        if (capture instanceof Promise) {
          capture.catch((err: unknown) =>
            logger.error('chat-attachment-menu.screenshot-captured.unexpected', {
              appId,
              error: err instanceof Error ? err.message : String(err)
            })
          );
        }
      }
    } catch (error) {
      // Check if user cancelled
      if (error instanceof Error && error.name === 'NotAllowedError') {
        logger.info('screenshot-capture.chat.cancelled', { appId });
        // Don't show error for user cancellation
      } else {
        logger.error('screenshot-capture.chat.failed', {
          appId,
          error: error instanceof Error ? error.message : String(error)
        });
        onUploadError?.(t('builder_chatfiles_error_screenshot_failed'));
      }
    } finally {
      // Stop all tracks to release the capture
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
      setIsCapturing(false);
    }
  };

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        onChange={handleFileSelect}
        style={{ display: 'none' }}
        data-testid="file-input"
        accept={ACCEPTED_UPLOAD_FILE_TYPES}
      />

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            data-testid="chat-attachment-menu-trigger"
            disabled={disabled || isCapturing}
            design="tertiary"
            size="sm"
            icon={<PlusIcon />}
            onClick={() => logClickEvent('develop.chat_input.attachment_menu', clickContext)()}
            aria-label={t('builder_chatfiles_attach', undefined, 'Attach')}
          />
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[220px] p-1">
          <div className="flex flex-col gap-0.5">
            <Button
              design="option"
              size="sm"
              icon={<PageIcon />}
              text={t('builder_chatfiles_file')}
              disabled={disabled}
              className="!justify-start"
              onClick={handleFileReferenceClick}
            />
            {isScreenCaptureSupported && (
              <Button
                design="option"
                size="sm"
                icon={<ImageIcon />}
                text={isCapturing ? t('builder_chatfiles_capturing') : t('builder_chatfiles_screenshot')}
                disabled={isCapturing || disabled}
                className="!justify-start"
                onClick={handleScreenshotClick}
              />
            )}
            {isMediaCanvasEnabled && onMediaLibrary && (
              <Button
                design="option"
                size="sm"
                icon={<ImageGalleryIcon />}
                text={t('builder_chatfiles_media_library', undefined, 'Media Library')}
                disabled={disabled}
                className="!justify-start"
                onClick={() => { logClickEvent('develop.attachment_menu.media_library', clickContext)(); setOpen(false); onMediaLibrary() }}
              />
            )}
            <Button
              design="option"
              size="sm"
              icon={<CloudUploadIcon />}
              text={t('builder_chatfiles_attach')}
              disabled={disabled}
              className="!justify-start"
              onClick={handleFileButtonClick}
            />
          </div>
        </PopoverContent>
      </Popover>

      <FileReferenceModal
        isOpen={showFileReferenceModal}
        appId={appId}
        onClose={() => setShowFileReferenceModal(false)}
        onFilesSelected={handleFileReferencesSelected}
      />
    </>
  );
}
