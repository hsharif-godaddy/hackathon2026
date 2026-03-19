'use client'

import { ChangeEvent, useRef } from 'react';
import Button from '@ux/button';
import PlusIcon from '@ux/icon/plus';

import { useTranslations } from '@/hooks/useTranslations';
import { getFileUploadAgent } from '@/lib/file-agent';
import { logger } from '@/lib/request-context';
import { ACCEPTED_UPLOAD_FILE_TYPES } from '@/utils/file-types';
import { UPLOAD_TIMEOUT_MS, UPLOAD_TIMEOUT_SECONDS, validate } from '@/utils/file-upload-validation';

export interface UploadedFile {
  id: string;
  originalName: string;
  filename: string;
  size: number;
  mimeType: string | null;
  uploadedAt: string;
  signedUrl?: string;
}

interface FileUploadButtonProps {
  appId: string;
  onFilesUploaded: (files: UploadedFile[]) => void;
  onUploadStart?: (files: File[]) => void;
  onUploadError?: (errorMessage?: string) => void;
  disabled?: boolean;
}

export default function FileUploadButton({
  appId,
  onFilesUploaded,
  onUploadStart,
  onUploadError,
  disabled = false
}: FileUploadButtonProps) {
  const t = useTranslations();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleButtonClick = () => {
    fileInputRef.current?.click();
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

      const formData = new FormData();
      formData.append('appId', appId);
      files.forEach(file => formData.append('files', file));

      const { token, uploadUrl } = await getFileUploadAgent(appId);

      const response = await fetch(uploadUrl, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
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
      <Button
        onClick={handleButtonClick}
        disabled={disabled}
        design="stateless"
        size="sm"
        icon={<PlusIcon />}
      />
    </>
  );
}
