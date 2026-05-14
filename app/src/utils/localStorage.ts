import { logger } from '@/lib/request-context';

export function safeGetItem(key: string): string | null {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    return localStorage.getItem(key);
  } catch (error: unknown) {
    logger.warn('localStorage.getItem.failed', {
      key,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export function safeSetItem(key: string, value: string): void {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    localStorage.setItem(key, value);
  } catch (error: unknown) {
    logger.warn('localStorage.setItem.failed', {
      key,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
