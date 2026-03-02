export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
export const MAX_FILE_SIZE_MB = MAX_FILE_SIZE / (1024 * 1024);
export const MAX_FILES_PER_UPLOAD = 5;
export const UPLOAD_TIMEOUT_MS = 60_000; // 60 seconds
export const UPLOAD_TIMEOUT_SECONDS = UPLOAD_TIMEOUT_MS / 1000;

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

  const oversizedFiles = files.filter(f => f.size > MAX_FILE_SIZE);
  if (oversizedFiles.length === 1) {
    return t('builder_chatfiles_error_file_too_large', { name: oversizedFiles[0].name, size: (oversizedFiles[0].size / (1024 * 1024)).toFixed(1), limit: MAX_FILE_SIZE_MB });
  }
  if (oversizedFiles.length > 1) {
    return t('builder_chatfiles_error_files_too_large', {
      count: oversizedFiles.length,
      names: oversizedFiles.map(f => f.name).join(', '),
      limit: MAX_FILE_SIZE_MB
    });
  }

  return null;
}
