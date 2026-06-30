import { appFetch } from '@/lib/gasket-config';
import { logger } from '@/lib/request-context';

export interface GrantPollingResult {
  success: boolean;
  grantCount?: number;
  error?: string;
  /** Whether polling was aborted via AbortSignal */
  aborted?: boolean;
}

const MAX_POLLING_DURATION_MS = 60 * 1000; // 1 minute for grants (shorter than entitlements)
const DEFAULT_POLL_INTERVAL = 2000; // 2 seconds
const DEFAULT_MAX_ATTEMPTS = 30;

export class GrantPollingService {
  private maxAttempts: number;
  private pollInterval: number;

  constructor(options?: { maxAttempts?: number; pollInterval?: number }) {
    this.maxAttempts = options?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.pollInterval = options?.pollInterval ?? DEFAULT_POLL_INTERVAL;
  }

  /**
   * Poll for grants until the count increases from the initial count
   * Used after credit purchase to wait for the new grant to appear
   * @param signal - AbortSignal for cancellation (e.g., on component unmount)
   * @param onError - Callback for transient errors during polling (continues polling after error)
   */
  async pollForNewGrant(
    subscriptionId: string,
    initialGrantCount: number,
    onStatusUpdate?: (attempt: number, maxAttempts: number) => void,
    signal?: AbortSignal,
    onError?: (error: Error, attempt: number) => void
  ): Promise<GrantPollingResult> {
    return new Promise((resolve) => {
      let attempts = 0;
      const startTime = Date.now();
      let timeoutId: ReturnType<typeof setTimeout> | null = null;

      // Handle abort signal
      const handleAbort = () => {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        logger.info('grant-polling.aborted', {
          subscriptionId,
          attempts,
          elapsedMs: Date.now() - startTime,
        });
        resolve({
          success: false,
          error: 'Polling aborted',
          aborted: true,
        });
      };

      if (signal?.aborted) {
        handleAbort();
        return;
      }

      signal?.addEventListener('abort', handleAbort);

      const poll = async () => {
        // Check if aborted before each poll
        if (signal?.aborted) {
          return;
        }

        try {
          attempts++;
          const elapsed = Date.now() - startTime;

          if (onStatusUpdate) {
            onStatusUpdate(attempts, this.maxAttempts);
          }

          const params = new URLSearchParams({
            subscriptionId,
            syncSpend: 'false', // Don't need to sync spend for count check
          });

          const response = await appFetch(
            `/api/credits/grants?${params.toString()}`,
            { signal },
            { handle401: true }
          );

          // Check if aborted after fetch
          if (signal?.aborted) {
            return;
          }

          const data = await response.json();

          if (!response.ok) {
            const errorMessage = data.error || `Failed to fetch grants: ${response.status}`;
            logger.error('grant-polling.fetch.error', {
              subscriptionId,
              attempt: attempts,
              statusCode: response.status,
              error: errorMessage,
            });
            throw new Error(errorMessage);
          }

          if (data.success && Array.isArray(data.data)) {
            const currentGrantCount = data.data.length;

            logger.info('grant-polling.check', {
              subscriptionId,
              attempt: attempts,
              initialGrantCount,
              currentGrantCount,
            });

            // Success: grant count increased
            if (currentGrantCount > initialGrantCount) {
              logger.info('grant-polling.success', {
                subscriptionId,
                attempts,
                initialGrantCount,
                currentGrantCount,
                elapsedMs: Date.now() - startTime,
              });

              signal?.removeEventListener('abort', handleAbort);
              resolve({
                success: true,
                grantCount: currentGrantCount,
              });
              return;
            }
          }

          // Grant not found yet, continue polling if under limits
          const currentElapsed = Date.now() - startTime;
          if (attempts < this.maxAttempts && currentElapsed < MAX_POLLING_DURATION_MS) {
            timeoutId = setTimeout(poll, this.pollInterval);
          } else {
            const timeoutReason = currentElapsed >= MAX_POLLING_DURATION_MS
              ? 'time limit exceeded'
              : 'max attempts reached';

            logger.warn('grant-polling.timeout', {
              subscriptionId,
              reason: timeoutReason,
              attempts,
              maxAttempts: this.maxAttempts,
              elapsedMs: elapsed,
              initialGrantCount,
            });

            signal?.removeEventListener('abort', handleAbort);
            resolve({
              success: false,
              error: `Grant polling timed out - ${timeoutReason}`,
            });
          }
        } catch (error) {
          // Don't log or continue if aborted
          if (signal?.aborted) {
            return;
          }

          const errorObj = error instanceof Error ? error : new Error(String(error));
          logger.error('grant-polling.error', {
            subscriptionId,
            attempt: attempts,
            error: errorObj.message,
          });

          // Notify caller of transient error
          onError?.(errorObj, attempts);

          const catchElapsed = Date.now() - startTime;
          if (attempts >= this.maxAttempts || catchElapsed >= MAX_POLLING_DURATION_MS) {
            signal?.removeEventListener('abort', handleAbort);
            resolve({
              success: false,
              error: errorObj.message,
            });
          } else {
            timeoutId = setTimeout(poll, this.pollInterval);
          }
        }
      };

      poll();
    });
  }
}

export const grantPollingService = new GrantPollingService();
