'use client';

import { useEffect } from 'react';

/**
 * Type definitions for Elastic APM RUM agent (subset used by this hook)
 * The Window.__apmInstance type is extended in usePageTiming.ts
 */
interface ApmAgent {
  addLabels: (labels: Record<string, string | number | boolean>) => void;
  setCustomContext: (context: Record<string, unknown>) => void;
  startTransaction: (name: string, type: string) => ApmTransaction | null;
  isActive?: () => boolean;
}

interface ApmTransaction {
  name: string;
  type: string;
  end: () => void;
  addLabels: (labels: Record<string, string | number | boolean>) => void;
}

interface RumAppContextOptions {
  appId?: string | null;
  customerId?: string | null;
}

/**
 * Get the APM agent instance with proper typing
 *
 * The APM RUM agent is a singleton initialized by RumProvider
 * and stored globally on the window object for access by custom hooks.
 * The Window type is extended in usePageTiming.ts with __apmInstance.
 *
 * @returns APM agent instance or null if unavailable
 */
function getApmAgent(): ApmAgent | null {
  if (typeof window === 'undefined') {
    return null;
  }

  // Cast to our local ApmAgent type which includes setCustomContext
  // The global Window.__apmInstance is typed in usePageTiming.ts
  return (window as unknown as { __apmInstance?: ApmAgent }).__apmInstance ?? null;
}

/**
 * Hook to add appId and customerId labels to all RUM transactions.
 *
 * Call this in any page/component where these values are known.
 * The labels are added using apm.addLabels() which updates (not duplicates)
 * existing labels when called with the same keys.
 *
 * @param options - Object containing appId and/or customerId
 *
 * @example
 * ```tsx
 * function DevelopPage() {
 *   const appId = useAppIdFromParams();
 *   const { getUserInfo } = useAuthContext();
 *   const customerId = useMemo(() => getUserInfo()?.customerId, [getUserInfo]);
 *
 *   // Labels will be updated whenever appId or customerId changes
 *   useRumAppContext({ appId, customerId });
 *
 *   return <div>...</div>;
 * }
 * ```
 */
export function useRumAppContext(options: RumAppContextOptions) {
  const { appId, customerId } = options;

  useEffect(() => {
    if (!appId && !customerId) {return;}

    const apm = getApmAgent();
    if (!apm) {return;}

    // Build labels object with available values
    const labels: Record<string, string> = {};
    if (appId) {labels.appId = appId;}
    if (customerId) {labels.customerId = customerId;}

    // Add labels to all subsequent transactions
    // addLabels() merges with existing labels, replacing values for duplicate keys
    apm.addLabels(labels);

    // Also set in custom context for richer querying
    apm.setCustomContext(labels);
  }, [appId, customerId]);
}

/**
 * Utility function to add labels to the current RUM transaction.
 *
 * Can be called from anywhere (not just React components).
 * Labels are merged with existing labels; duplicate keys are replaced.
 *
 * @param labels - Key-value pairs to add as labels
 *
 * @example
 * ```ts
 * // Add labels during an event handler
 * addRumLabels({ action: 'save', fileCount: 3 });
 * ```
 */
export function addRumLabels(labels: Record<string, string | number | boolean>) {
  const apm = getApmAgent();
  if (!apm) {return;}

  apm.addLabels(labels);
}

/**
 * Utility function to start a custom RUM transaction.
 *
 * Use this to track specific operations or user flows that span
 * multiple components or async operations.
 *
 * @param name - Transaction name (e.g., 'checkout-flow', 'file-upload')
 * @param type - Transaction type (e.g., 'user-interaction', 'custom')
 * @returns Transaction object with end() and addLabels() methods, or null if APM unavailable
 *
 * @example
 * ```ts
 * const transaction = startRumTransaction('publish-flow', 'user-interaction');
 * if (transaction) {
 *   transaction.addLabels({ appId: '123' });
 *   await performPublish();
 *   transaction.end();
 * }
 * ```
 */
export function startRumTransaction(name: string, type: string): ApmTransaction | null {
  const apm = getApmAgent();
  if (!apm) {return null;}

  return apm.startTransaction(name, type);
}
