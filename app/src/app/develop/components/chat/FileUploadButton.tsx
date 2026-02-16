'use client'

import { ChangeEvent, useRef } from 'react';
import Button from '@ux/button';
import PlusIcon from '@ux/icon/plus';

import { getFileUploadAgent } from '@/lib/file-agent';
import { logger } from '@/lib/request-context';
import { ACCEPTED_UPLOAD_FILE_TYPES } from '@/utils/file-types';

export interface UploadedFile {
  id: string;
  originalName: string;
  filename: string;
  size: number;
  mimeType: string | null;
  uploadedAt: string;
}

interface FileUploadButtonProps {
  appId: string;
  onFilesUploaded: (files: UploadedFile[]) => void;
  onUploadStart?: (files: File[]) => void;
  onUploadError?: () => void;
  disabled?: boolean;
}

export default function FileUploadButton({
  appId,
  onFilesUploaded,
  onUploadStart,
  onUploadError,
  disabled = false
}: FileUploadButtonProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleButtonClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileSelect = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);

    if (files.length === 0) {
      return;
    }

    try {
      // Notify parent that upload is starting
      onUploadStart?.(files);

      logger.debug('file-upload.chat.start', {
        appId,
        fileCount: files.length,
        totalSize: files.reduce((sum, f) => sum + f.size, 0)
      });

      const formData = new FormData();
      formData.append('appId', appId);
      files.forEach(file => formData.append('files', file));

      // Get agent token and upload directly to agents service
      const { token, uploadUrl } = await getFileUploadAgent(appId);

      const response = await fetch(uploadUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        },
        body: formData
      });

      if (!response.ok) {
        throw new Error(`Upload failed with status ${response.status}`);
      }

      const result = await response.json();

      logger.info('file-upload.chat.success', {
        appId,
        uploadId: result.uploadId,
        fileCount: result.files.length
      });

      onFilesUploaded(result.files);

      // Reset input so same file can be selected again
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    } catch (error) {
      logger.error('file-upload.chat.failed', {
        appId,
        error: error instanceof Error ? error.message : String(error)
      });

      console.error('File upload failed:', error);
      onUploadError?.();
      // TODO: Show error toast notification
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
