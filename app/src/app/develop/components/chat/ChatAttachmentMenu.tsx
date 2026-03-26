'use client'

import { ChangeEvent, useEffect, useRef, useState } from 'react';
import Button from '@ux/button';
import CloudUploadIcon from '@ux/icon/cloud-upload';
import ImageIcon from '@ux/icon/image';
import PageIcon from '@ux/icon/page';
import PlusIcon from '@ux/icon/plus';

import FileReferenceModal from '@/app/develop/components/chat/FileReferenceModal';
import type { UploadedFile } from '@/app/develop/components/chat/FileUploadButton';
import { useTranslations } from '@/hooks/useTranslations';
import { getFileUploadAgent } from '@/lib/file-agent';
import { logger } from '@/lib/request-context';
import { Popover, PopoverContent, PopoverTrigger } from '@/lib/shadcn/popover';
import { ACCEPTED_UPLOAD_FILE_TYPES } from '@/utils/file-types';
import { UPLOAD_TIMEOUT_MS, UPLOAD_TIMEOUT_SECONDS, validate } from '@/utils/file-upload-validation';
import { compressImageFiles } from '@/utils/image-compression';
import { generateClickEID } from '@/utils/instrumentation';

export type { UploadedFile } from '@/app/develop/components/chat/FileUploadButton';

interface ChatAttachmentMenuProps {
  appId: string;
  onFilesUploaded: (files: UploadedFile[]) => void;
  onScreenshotCaptured?: (dataUrl: string) => void;
  onFileReferencesSelected?: (filePaths: string[]) => void;
  onUploadStart?: (files: File[]) => void;
  onUploadError?: (errorMessage?: string) => void;
  disabled?: boolean;
}

export default function ChatAttachmentMenu({
  appId,
  onFilesUploaded,
  onScreenshotCaptured,
  onFileReferencesSelected,
  onUploadStart,
  onUploadError,
  disabled = false
}: ChatAttachmentMenuProps) {
  const t = useTranslations();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const [showFileReferenceModal, setShowFileReferenceModal] = useState(false);
  const [isScreenCaptureSupported, setIsScreenCaptureSupported] = useState(false);

  useEffect(() => {
    setIsScreenCaptureSupported(typeof navigator?.mediaDevices?.getDisplayMedia === 'function');
  }, []);

  const handleFileButtonClick = () => {
    setOpen(false);
    fileInputRef.current?.click();
  };

  const handleFileReferenceClick = () => {
    setOpen(false);
    setShowFileReferenceModal(true);
  };

  const handleFileReferencesSelected = (filePaths: string[]) => {
    if (onFileReferencesSelected) {
      onFileReferencesSelected(filePaths);
    }
    setShowFileReferenceModal(false);
  };

  const handleFileSelect = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);

    if (files.length === 0) {
      return;
    }

    const validationError = validate(files, t);
    if (validationError) {
      onUploadError?.(validationError);
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);

    try {
      onUploadStart?.(files);

      logger.debug('file-upload.chat.start', {
        appId,
        fileCount: files.length,
        totalSize: files.reduce((sum, f) => sum + f.size, 0)
      });

      const [compressed, { token, uploadUrl }] = await Promise.all([
        compressImageFiles(files),
        getFileUploadAgent(appId)
      ]);

      logger.debug('file-upload.chat.compressed', {
        appId,
        originalSize: files.reduce((sum, f) => sum + f.size, 0),
        compressedSize: compressed.reduce((sum, f) => sum + f.size, 0)
      });

      const formData = new FormData();
      formData.append('appId', appId);
      compressed.forEach(file => formData.append('files', file));

      const response = await fetch(uploadUrl, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
        signal: controller.signal
      });

      if (!response.ok) {
        let errorMessage = `Upload failed (${response.status})`;
        try {
          const body = await response.json();
          if (body.error) {
            errorMessage = typeof body.error === 'string' ? body.error : body.error.message || errorMessage;
          }
        } catch { /* response body not JSON */ }
        throw new Error(errorMessage);
      }

      const result = await response.json();

      logger.info('file-upload.chat.success', {
        appId,
        uploadId: result.uploadId,
        fileCount: result.files.length,
        failedCount: result.failedFiles?.length ?? 0
      });

      onFilesUploaded(result.files);

      if (result.failedFiles?.length > 0) {
        const names = result.failedFiles.map((f: { originalName: string }) => f.originalName).join(', ');
        onUploadError?.(t('builder_chatfiles_error_partial_failure', {
          success: result.files.length,
          total: result.files.length + result.failedFiles.length,
          names
        }));
      }

      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    } catch (error) {
      const message = error instanceof DOMException && error.name === 'AbortError'
        ? t('builder_chatfiles_error_timeout_duration', { seconds: UPLOAD_TIMEOUT_SECONDS })
        : error instanceof Error ? error.message : t('builder_chatfiles_error_upload_failed');

      logger.error('file-upload.chat.failed', {
        appId,
        error: message
      });

      onUploadError?.(message);
    } finally {
      clearTimeout(timeout);
    }
  };

  const handleScreenshotClick = async () => {
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

      // Pass screenshot data URL to parent
      if (onScreenshotCaptured) {
        onScreenshotCaptured(dataUrl);
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
            disabled={disabled || isCapturing}
            design="stateless"
            size="sm"
            icon={<PlusIcon />}
            className={`!bg-intents-ux-box-backgroundColor !border !border-border !rounded-lg transition-all duration-200 hover:!shadow-md ${open ? '!shadow-md' : ''}`}
            data-eid={generateClickEID('develop.chat_input.attachment_menu')}
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
              data-eid={generateClickEID('develop.attachment_menu.reference')}
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
                data-eid={generateClickEID('develop.attachment_menu.screenshot')}
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
              data-eid={generateClickEID('develop.attachment_menu.file')}
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
