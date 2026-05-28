'use client';

import Box from '@ux/box';

import { DesignFileUploadError } from '@/app/[market]/components/DesignFileUpload';
import { PromptCharCount } from '@/components/home/PromptCharCount';

export interface PromptInputErrorsProps {
  bytesRemaining: number;
  isOverLimit: boolean;
  fileUploadError: string | null;
}

export function PromptInputErrors({
  bytesRemaining,
  isOverLimit,
  fileUploadError,
}: PromptInputErrorsProps) {
  return (
    <Box>
      {/* Character Counter */}
      <PromptCharCount bytesRemaining={bytesRemaining} isOverLimit={isOverLimit} />
      {/* File Upload error messages */}
      {fileUploadError && <DesignFileUploadError error={fileUploadError} />}
    </Box>
  );
}
