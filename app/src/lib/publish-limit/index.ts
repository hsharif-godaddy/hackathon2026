/**
 * Publish Limit Configuration and Types
 *
 * This module contains constants and types for managing publish limits
 * based on subscription plans when the app-builder-grants feature flag is enabled.
 */

import type { SiteInfo } from '@/lib/control-plane/types';
import { SubscriptionPlan } from '@/types/credits';

/**
 * Plan publish limits map
 *
 * Defines the maximum number of apps that can be published for each subscription plan.
 * - 0 = no publishing allowed (free plan shows paywall)
 * - number = limited publishing (shows limit modal when reached)
 */
export const PLAN_PUBLISH_LIMITS: Record<SubscriptionPlan, number | null> = {
  [SubscriptionPlan.None]: 0,
  [SubscriptionPlan.Free]: 0,
  [SubscriptionPlan.Starter]: 1,
  [SubscriptionPlan.Professional]: 10,
  [SubscriptionPlan.Ultimate]: 50,
  [SubscriptionPlan.AiroPlus]: 9,
};

/**
 * Result of publish limit check
 */
export interface PublishLimitResult {
  /** Whether the user can publish the current app */
  canPublish: boolean;
  /** Number of currently published apps */
  currentCount: number;
  /** Maximum number of apps allowed (null = unlimited, 0 = none/free plan) */
  limit: number | null;
  /** User's subscription plan */
  plan: SubscriptionPlan | undefined;
  /** List of published apps */
  publishedApps: SiteInfo[];
}

/**
 * Get the publish limit for a subscription plan
 *
 * @param plan - The subscription plan
 * @returns The publish limit (null = unlimited, number = limit)
 */
export function getPublishLimit(plan: SubscriptionPlan | undefined): number | null {
  if (!plan) return 0;
  // Use 'in' check to distinguish between missing key and explicit null value
  if (plan in PLAN_PUBLISH_LIMITS) {
    return PLAN_PUBLISH_LIMITS[plan];
  }
  return 0;
}

interface VariantWithLifecycle {
  variant: string;
  status: string;
}

interface AppWithVariants {
  variantsWithLifecycle?: VariantWithLifecycle[];
  variants?: string[];
}

/**
 * Check if an app has an active publish variant
 *
 * Handles both variantsWithLifecycle and variants formats.
 * variantsWithLifecycle is preferred as it includes status information.
 *
 * @param app - App or site object with variantsWithLifecycle or variants
 * @returns True if the app has an active publish variant
 */
export function isPublishedApp<T extends AppWithVariants>(app: T): boolean {
  // V2: Check variantsWithLifecycle for active publish variant
  if (app.variantsWithLifecycle?.length) {
    return app.variantsWithLifecycle.some(
      v => v.variant === 'publish' && v.status === 'active'
    );
  }

  // Fallback: Check variants array for 'publish' (local development)
  if (app.variants?.length) {
    return app.variants.includes('publish');
  }

  return false;
}

/**
 * Filter apps to only those with active publish variants
 *
 * @param apps - Array of apps or sites with variantsWithLifecycle
 * @returns Filtered array of published apps
 */
export function filterPublishedApps<T extends AppWithVariants>(apps: T[]): T[] {
  return apps.filter(isPublishedApp);
}

/**
 * Check if a user can publish based on their plan and current published apps count
 *
 * @param plan - The subscription plan
 * @param currentPublishedCount - Number of currently published apps
 * @param currentAppId - The app being published (excluded from limit check if already published)
 * @param publishedAppIds - List of currently published app IDs
 * @returns Whether the user can publish
 */
export function canPublishWithPlan(
  plan: SubscriptionPlan | undefined,
  currentPublishedCount: number,
  currentAppId?: string,
  publishedAppIds?: string[]
): boolean {
  const limit = getPublishLimit(plan);

  // Unlimited publishing
  if (limit === null) return true;

  // No publishing allowed
  if (limit === 0) return false;

  // Allow re-publishing of already-published apps without counting against limit.
  // This is intentional: users should always be able to update their existing published apps.
  // The app is already counted in currentPublishedCount, so re-publishing doesn't consume
  // an additional slot. Once unpublish is implemented, unpublishing will free the slot.
  if (currentAppId && publishedAppIds?.includes(currentAppId)) {
    return true;
  }

  // Check if under limit
  return currentPublishedCount < limit;
}
