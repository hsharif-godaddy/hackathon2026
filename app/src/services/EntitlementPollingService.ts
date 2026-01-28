import { logger } from '@/lib/request-context';
import { SubscriptionPlan } from '@/types/credits';

export interface EntitlementData {
  subscription: any;
  subscriptionId: string;
  entitlementId: string;
}

export interface EntitlementPollingResult {
  success: boolean;
  data?: EntitlementData;
  error?: string;
}
const MAX_POLLING_DURATION_MS = 5 * 60 * 1000; // Stop polling after 5 minutes (matches deployment polling standard)

export class EntitlementPollingService {
  private maxAttempts: number = 30; // Maximum attempts (with 5-minute time limit)
  private pollInterval: number = 10000; // 10 seconds

  constructor(options?: { maxAttempts?: number; pollInterval?: number }) {
    if (options?.maxAttempts) this.maxAttempts = options.maxAttempts;
    if (options?.pollInterval) this.pollInterval = options.pollInterval;
  }

  /**
   * Poll for account-level entitlements until they are created in the backend
   */
  async pollForAccountEntitlements(
    onStatusUpdate?: (attempt: number, maxAttempts: number) => void
  ): Promise<EntitlementPollingResult> {
    return new Promise((resolve, reject) => { /* eslint-disable-line @typescript-eslint/no-unused-vars */
      let attempts = 0;
      const startTime = Date.now();

      const poll = async () => {
        try {
          attempts++;
          const elapsed = Date.now() - startTime;
          // Notify caller of status update
          if (onStatusUpdate) {
            onStatusUpdate(attempts, this.maxAttempts);
          }

          // Get the account-level subscription
          const subscriptionUrl = '/api/subscription';
          const subscriptionResponse = await fetch(subscriptionUrl, {
            credentials: 'include',
          });

          const subscriptionData = await subscriptionResponse.json();

          if (!subscriptionResponse.ok) {
            const errorMessage = subscriptionData.error || `Failed to fetch subscription data: ${subscriptionResponse.status}`;
            logger.error('entitlement-polling.account-subscription.error', {
              attempt: attempts,
              statusCode: subscriptionResponse.status,
              error: errorMessage
            });
            throw new Error(errorMessage);
          }

          if (!subscriptionData.success || !subscriptionData.data?.subscription) {
            const errorMessage = subscriptionData.error || 'Failed to get subscription data';
            logger.error('entitlement-polling.account-subscription.failed', {
              attempt: attempts,
              error: errorMessage
            });
            throw new Error(errorMessage);
          }

          const subscription = subscriptionData.data.subscription;

          // Check if the subscription plan indicates access
          if (subscription.plan === SubscriptionPlan.AiroPlus || subscription.plan === SubscriptionPlan.Starter) {
            resolve({
              success: true,
              data: {
                subscription: subscription,
                subscriptionId: subscription.id,
                entitlementId: subscription.builderEntitlementId || subscription.entitlementId || subscription.id
              }
            });
            return;
          }

          // For legacy compatibility, check entitlements if subscription has an ID
          if (subscription.id) {
            const entitlementsUrl = `/api/entitlements?subscriptionId=${encodeURIComponent(subscription.id)}`;
            const entitlementsResponse = await fetch(entitlementsUrl, {
              credentials: 'include',
            });

            const entitlementsData = await entitlementsResponse.json();

            if (entitlementsResponse.ok && entitlementsData.success && entitlementsData.data?.subscription) {
              resolve({
                success: true,
                data: {
                  subscription: entitlementsData.data.subscription,
                  subscriptionId: entitlementsData.data.subscriptionId || subscription.id,
                  entitlementId: entitlementsData.data.subscription.entitlementId
                }
              });
              return;
            }
          }

          // No entitlements found yet, continue polling if under time/attempt limits
          const currentElapsed = Date.now() - startTime;
          if (attempts < this.maxAttempts && currentElapsed < MAX_POLLING_DURATION_MS) {
            logger.info('entitlement-polling.account.no-entitlements-yet', {
              subscriptionId: subscription.id,
              plan: subscription.plan,
              attempt: attempts,
              maxAttempts: this.maxAttempts,
              elapsedSeconds: Math.round(currentElapsed / 1000),
              maxDurationSeconds: Math.round(MAX_POLLING_DURATION_MS / 1000),
              willRetryIn: `${this.pollInterval / 1000}s`
            });
            setTimeout(poll, this.pollInterval);
          } else {
            const timeoutReason = currentElapsed >= MAX_POLLING_DURATION_MS ? 'time limit exceeded' : 'max attempts reached';
            logger.info('entitlement-polling.account.timeout', {
              subscriptionId: subscription.id,
              plan: subscription.plan,
              reason: timeoutReason,
              attempts,
              maxAttempts: this.maxAttempts,
              elapsedSeconds: Math.round(elapsed / 1000),
              maxDurationSeconds: Math.round(MAX_POLLING_DURATION_MS / 1000)
            });
            resolve({
              success: false,
              error: `Entitlement polling timed out - ${timeoutReason}`
            });
          }

        } catch (error) {
          logger.error('entitlement-polling.account.error', {
            attempt: attempts,
            elapsedSeconds: Math.round((Date.now() - startTime) / 1000),
            error: error instanceof Error ? error.message : String(error)
          });

          const catchElapsed = Date.now() - startTime;
          if (attempts >= this.maxAttempts || catchElapsed >= MAX_POLLING_DURATION_MS) {
            const timeoutReason = catchElapsed >= MAX_POLLING_DURATION_MS ? 'time limit exceeded' : 'max attempts reached';
            resolve({
              success: false,
              error: error instanceof Error ? error.message : `Unknown error during entitlement polling (${timeoutReason})`
            });
          } else {
            // Try again after delay
            setTimeout(poll, this.pollInterval);
          }
        }
      };

      // Start polling
      poll();
    });
  }

  /**
   * Poll for entitlements by app ID until they are created in the backend
   * @deprecated Use pollForAccountEntitlements() for app-agnostic subscriptions
   */
  async pollForEntitlements(
    appId: string,
    onStatusUpdate?: (attempt: number, maxAttempts: number) => void
  ): Promise<EntitlementPollingResult> {
    return new Promise((resolve, reject) => { /* eslint-disable-line @typescript-eslint/no-unused-vars */
      let attempts = 0;
      const startTime = Date.now();

      const poll = async () => {
        try {
          attempts++;
          const elapsed = Date.now() - startTime;
          // Notify caller of status update
          if (onStatusUpdate) {
            onStatusUpdate(attempts, this.maxAttempts);
          }

          // First get the subscription for this app
          const subscriptionUrl = `/api/apps/${appId}/subscription`;
          const subscriptionResponse = await fetch(subscriptionUrl, {
            credentials: 'include',
          });

          const subscriptionData = await subscriptionResponse.json();

          if (!subscriptionResponse.ok) {
            const errorMessage = subscriptionData.error || `Failed to fetch subscription data: ${subscriptionResponse.status}`;
            logger.error('entitlement-polling.subscription.error', {
              appId,
              attempt: attempts,
              statusCode: subscriptionResponse.status,
              error: errorMessage
            });
            throw new Error(errorMessage);
          }

          if (!subscriptionData.success || !subscriptionData.data?.subscription?.id) {
            const errorMessage = subscriptionData.error || 'Failed to get subscription data';
            logger.error('entitlement-polling.subscription.failed', {
              appId,
              attempt: attempts,
              error: errorMessage
            });
            throw new Error(errorMessage);
          }

          const subscriptionId = subscriptionData.data.subscription.id;
          // Now get entitlements for this subscription
          const entitlementsUrl = `/api/entitlements?subscriptionId=${encodeURIComponent(subscriptionId)}`;
          const entitlementsResponse = await fetch(entitlementsUrl, {
            credentials: 'include',
          });

          const entitlementsData = await entitlementsResponse.json();

          if (!entitlementsResponse.ok) {
            const errorMessage = `API request failed: ${entitlementsResponse.status} ${entitlementsResponse.statusText}`;
            logger.error('entitlement-polling.entitlements.error', {
              appId,
              subscriptionId,
              attempt: attempts,
              statusCode: entitlementsResponse.status,
              error: errorMessage
            });
            throw new Error(errorMessage);
          }

          if (entitlementsData.success && entitlementsData.data?.subscription) {
            resolve({
              success: true,
              data: {
                subscription: entitlementsData.data.subscription,
                subscriptionId: entitlementsData.data.subscriptionId,
                entitlementId: entitlementsData.data.subscription.entitlementId
              }
            });
            return;
          }

          // No entitlements found yet, continue polling if under time/attempt limits
          const currentElapsed = Date.now() - startTime;
          if (attempts < this.maxAttempts && currentElapsed < MAX_POLLING_DURATION_MS) {
            logger.info('entitlement-polling.no-entitlements-yet', {
              appId,
              subscriptionId,
              attempt: attempts,
              maxAttempts: this.maxAttempts,
              elapsedSeconds: Math.round(currentElapsed / 1000),
              maxDurationSeconds: Math.round(MAX_POLLING_DURATION_MS / 1000),
              willRetryIn: `${this.pollInterval / 1000}s`
            });
            setTimeout(poll, this.pollInterval);
          } else {
            const timeoutReason = currentElapsed >= MAX_POLLING_DURATION_MS ? 'time limit exceeded' : 'max attempts reached';
            logger.info('⏰ Entitlement polling timed out:', {
              appId,
              subscriptionId,
              reason: timeoutReason,
              attempts,
              maxAttempts: this.maxAttempts,
              elapsedSeconds: Math.round(elapsed / 1000),
              maxDurationSeconds: Math.round(MAX_POLLING_DURATION_MS / 1000)
            });
            resolve({
              success: false,
              error: `Entitlement polling timed out - ${timeoutReason}`
            });
          }

        } catch (error) {
          logger.error('❌ Error polling for entitlements:', {
            appId,
            attempt: attempts,
            elapsedSeconds: Math.round((Date.now() - startTime) / 1000),
            error: error instanceof Error ? error.message : String(error)
          });

          const catchElapsed = Date.now() - startTime;
          if (attempts >= this.maxAttempts || catchElapsed >= MAX_POLLING_DURATION_MS) {
            const timeoutReason = catchElapsed >= MAX_POLLING_DURATION_MS ? 'time limit exceeded' : 'max attempts reached';
            resolve({
              success: false,
              error: error instanceof Error ? error.message : `Unknown error during entitlement polling (${timeoutReason})`
            });
          } else {
            // Try again after delay
            setTimeout(poll, this.pollInterval);
          }
        }
      };

      // Start polling
      poll();
    });
  }

  /**
   * Check for entitlements once (no polling) - useful for quick checks
   */
  async checkEntitlementsOnce(appId: string): Promise<EntitlementPollingResult> {
    try {
      logger.info('🔍 Checking entitlements once:', appId);

      // First get the subscription for this app
      const subscriptionUrl = `/api/apps/${appId}/subscription`;
      const subscriptionResponse = await fetch(subscriptionUrl, {
        credentials: 'include',
      });

      const subscriptionData = await subscriptionResponse.json();

      if (!subscriptionResponse.ok) {
        const errorMessage = subscriptionData.error || `Failed to fetch subscription data: ${subscriptionResponse.status}`;
        logger.error('entitlement-check.subscription.error', {
          appId,
          statusCode: subscriptionResponse.status,
          error: errorMessage
        });
        return {
          success: false,
          error: errorMessage
        };
      }

      if (!subscriptionData.success || !subscriptionData.data?.subscription?.id) {
        const errorMessage = subscriptionData.error || 'Failed to get subscription data';
        logger.error('entitlement-check.subscription.failed', {
          appId,
          error: errorMessage
        });
        return {
          success: false,
          error: errorMessage
        };
      }

      const subscriptionId = subscriptionData.data.subscription.id;

      // Now get entitlements for this subscription
      const entitlementsUrl = `/api/entitlements?subscriptionId=${encodeURIComponent(subscriptionId)}`;
      const entitlementsResponse = await fetch(entitlementsUrl, {
        credentials: 'include',
      });

      const entitlementsData = await entitlementsResponse.json();

      if (!entitlementsResponse.ok) {
        const errorMessage = `API request failed: ${entitlementsResponse.status} ${entitlementsResponse.statusText}`;
        logger.error('entitlement-check.entitlements.error', {
          appId,
          subscriptionId,
          statusCode: entitlementsResponse.status,
          error: errorMessage
        });
        return {
          success: false,
          error: errorMessage
        };
      }

      if (entitlementsData.success && entitlementsData.data?.subscription) {
        logger.info('entitlement-check.success', {
          appId,
          subscriptionId,
          entitlementId: entitlementsData.data.subscription.entitlementId
        });

        return {
          success: true,
          data: {
            subscription: entitlementsData.data.subscription,
            subscriptionId: entitlementsData.data.subscriptionId,
            entitlementId: entitlementsData.data.subscription.entitlementId
          }
        };
      }

      logger.info('entitlement-check.no-entitlements', {
        appId,
        subscriptionId
      });

      return {
        success: false,
        error: 'No entitlements found'
      };

    } catch (error) {
      logger.error('❌ Error checking entitlements:', {
        appId,
        error: error instanceof Error ? error.message : String(error)
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error checking entitlements'
      };
    }
  }
}

// Export singleton instance
export const entitlementPollingService = new EntitlementPollingService();
