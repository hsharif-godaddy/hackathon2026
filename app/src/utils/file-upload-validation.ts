export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
export const MAX_FILES_PER_UPLOAD = 5;
export const UPLOAD_TIMEOUT_MS = 60_000; // 60 seconds

interface TranslateFn {
  (key: string, values?: Record<string, unknown>): string;
}

/**
 * Validate files before upload. Returns an error message string if validation
 * fails, or null if all files pass.
 */
export function validate(
  files: File[],
  t: TranslateFn
): string | null {
  if (files.length > MAX_FILES_PER_UPLOAD) {
    return t('builder_chatfiles_error_max_files', { count: MAX_FILES_PER_UPLOAD });
  }

  const oversizedFile = files.find(f => f.size > MAX_FILE_SIZE);
  if (oversizedFile) {
    return t('builder_chatfiles_error_file_too_large', { name: oversizedFile.name, size: (oversizedFile.size / (1024 * 1024)).toFixed(1), limit: 10 });
  }

  return null;
}
