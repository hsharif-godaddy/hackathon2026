import { useEffect, useRef, useCallback } from 'react';
import { logger } from '@/lib/request-context';

/**
 * Type definitions for Elastic APM RUM agent
 */
interface ApmTransaction {
  name: string;
  type: string;
  end: () => void;
  addLabels: (labels: Record<string, string | number | boolean>) => void;
}

interface ApmAgent {
  startTransaction: (name: string, type: string) => ApmTransaction | null;
  getCurrentTransaction: () => ApmTransaction | null;
  isActive: () => boolean;
}

/**
 * Global storage structure for APM page timing transactions
 * Stored on window object to survive component remounts
 */
interface ApmTransactionStorage {
  transaction: ApmTransaction;
  startTime: number;
}

/**
 * Extend Window interface to include APM-related global properties
 */
declare global {
  interface Window {
    __apmInstance?: ApmAgent;
    [key: string]: any; // Allow dynamic keys for page timing storage
  }
}

// Type guard for APM transaction storage
function isApmTransactionStorage(value: any): value is ApmTransactionStorage {
  return value && typeof value === 'object' && 'transaction' in value && 'startTime' in value;
}

/**
 * Get the APM agent instance with proper typing
 * 
 * The APM RUM agent is a singleton initialized by RumProvider
 * and stored globally on the window object for access by custom hooks.
 * 
 * @returns APM agent instance or null if unavailable
 */
function getApmAgent(): ApmAgent | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const apm = window.__apmInstance;
  
  // Check if APM exists and is active
  if (!apm || !apm.isActive || !apm.isActive()) {
    return null;
  }
  
  return apm;
}

/**
 * Custom hook to track time spent on a page using Elastic APM RUM
 * 
 * Automatically starts a custom transaction when the component mounts
 * and ends it when the component unmounts, measuring total page visit duration.
 * 
 * This hook creates custom RUM transactions separate from the automatic
 * page-load and route-change transactions. These transactions measure
 * user engagement time (how long they stay on the page) rather than
 * technical performance metrics.
 * 
 * IMPORTANT: The transaction survives component remounts by storing it globally.
 * This ensures a single continuous transaction even if the URL changes via
 * router.replace() (e.g., job ID → real app ID transition).
 * 
 * The hook handles multiple types of navigation:
 * - Client-side Next.js navigation (via manual endTransaction call)
 * - SSO redirects (via beforeunload event)
 * - Tab closes and browser navigation (via beforeunload event)
 * - Component remounts (reuses existing transaction)
 * 
 * @param pageName - Name of the page (e.g., 'create-page', 'develop-page')
 * @param pageId - Optional app ID to add as app_id label (can be updated later via updateLabels)
 * @param additionalLabels - DEPRECATED: Not used due to React dependency limitations.
 *   Adding object parameters to useEffect dependencies causes infinite re-renders.
 *   Labels are captured at component mount time only.
 * @returns Object with endTransaction and updateLabels functions
 * 
 * Transaction name format: `page-{pageName}` (e.g., 'page-create-page', 'page-develop-page')
 * 
 * Labels added to transaction:
 * - page_name: The pageName parameter
 * - app_id: The pageId parameter (if provided, can be updated dynamically)
 * 
 * @example
 * ```tsx
 * function CreatePage() {
 *   const { endTransaction, updateLabels } = usePageTiming('create-page', jobId);
 *   // Creates transaction: "page-create-page" with labels: { page_name: 'create-page', app_id: jobId }
 *   
 *   // Update labels when real app ID becomes available
 *   useEffect(() => {
 *     if (realAppId) {
 *       updateLabels({ app_id: realAppId, updated_from_job_id: true });
 *     }
 *   }, [realAppId, updateLabels]);
 *   
 *   const handleRedirect = () => {
 *     endTransaction(); // End transaction before navigating away
 *     router.push('/other-page');
 *   };
 *   
 *   return <div>...</div>;
 * }
 * ```
 */
export function usePageTiming(
  pageName: string,
  pageId?: string,
  additionalLabels?: Record<string, string | number | boolean>
): { endTransaction: () => void; updateLabels: (labels: Record<string, string | number | boolean>) => void } {
  const transactionRef = useRef<ApmTransaction | null>(null);
  const startTimeRef = useRef<number>(0);
  const initAttemptedRef = useRef<boolean>(false);
  
  // Helper to get consistent global storage key
  const getGlobalKey = useCallback(() => `__apm_page_timing_${pageName}`, [pageName]);

  const updateLabels = useCallback((labels: Record<string, string | number | boolean>) => {
    // Try ref first, then check global storage
    const globalKey = getGlobalKey();
    const stored = window[globalKey];
    const storedTransaction = isApmTransactionStorage(stored) ? stored : undefined;
    const transaction = transactionRef.current || storedTransaction?.transaction;
    
    if (transaction) {
      try {
        transaction.addLabels(labels);
      } catch (error) {
        logger.error('hooks.usePageTiming.labels.error', {
          page_name: pageName,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }, [pageName, getGlobalKey]);

  const endTransaction = useCallback(() => {
    // Try ref first, then check global storage
    const globalKey = getGlobalKey();
    const stored = window[globalKey];
    const storedTransaction = isApmTransactionStorage(stored) ? stored : undefined;
    const transaction = transactionRef.current || storedTransaction?.transaction;
    const startTime = startTimeRef.current || storedTransaction?.startTime;
    
    if (transaction) {
      try {
        transaction.end();

        // Clean up global storage
        delete window[globalKey];
        transactionRef.current = null;
      } catch (error) {
        logger.error('hooks.usePageTiming.transaction.end.error', {
          page_name: pageName,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }, [pageName, getGlobalKey]);

  useEffect(() => {
    // Use global flag that survives component remounts
    const globalKey = getGlobalKey();
    const stored = window[globalKey];
    const existingTransaction = isApmTransactionStorage(stored) ? stored : undefined;
    
    // If transaction already exists (from previous mount), reuse it
    if (existingTransaction) {
      transactionRef.current = existingTransaction.transaction;
      startTimeRef.current = existingTransaction.startTime;
      return; // Don't create a new transaction
    }
    
    // Only attempt initialization once (check ref as backup)
    if (initAttemptedRef.current) return;
    initAttemptedRef.current = true;

    const initTransaction = () => {
      // Wait a bit for RUM to initialize
      setTimeout(() => {
        const apm = getApmAgent();

        if (!apm) return;

        // Start custom transaction for page timing
        const transactionName = `page-${pageName}`;

        startTimeRef.current = Date.now();

        try {
          const transaction = apm.startTransaction(transactionName, 'page-timing');

          if (transaction) {
            transactionRef.current = transaction;

            // Store globally to survive remounts
            window[globalKey] = {
              transaction,
              startTime: startTimeRef.current
            };

            // Add labels for filtering in Kibana
            // Note: Only pageName and pageId are used as labels since additionalLabels
            // cannot be tracked in the dependency array (would cause infinite re-renders)
            transaction.addLabels({
              page_name: pageName,
              ...(pageId && { app_id: pageId })
            });
          }
        } catch (error) {
          logger.error('hooks.usePageTiming.transaction.error', {
            page_name: pageName,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }, 1000);
    };

    initTransaction();

    // Add beforeunload event listener to catch SSO redirects, tab closes, and other unload events
    const handleBeforeUnload = () => {
      const globalKey = getGlobalKey();
      const stored = window[globalKey];
      const storedTransaction = isApmTransactionStorage(stored) ? stored : undefined;
      const transaction = transactionRef.current || storedTransaction?.transaction;
      
      if (transaction) {
        transaction.end();

        // Clean up global storage
        delete window[globalKey];
        transactionRef.current = null;
      }
    };
    
    window.addEventListener('beforeunload', handleBeforeUnload);

    // Cleanup: Don't end transaction on unmount (might be a remount!)
    // Transaction stays alive in global storage for reuse
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      // Note: We don't end the transaction here because component might remount
      // Transaction will be ended via:
      // 1. Manual endTransaction() call, or
      // 2. beforeunload event, or
      // 3. Navigation to a different page
    };
  }, []); // Empty array - only run once per page visit

  return { endTransaction, updateLabels };
}

/**
 * Custom hook to track specific phases or sections within a page
 * 
 * Useful for tracking time spent in specific states or sections
 * (e.g., time in chat vs preview pane)
 * 
 * @param pageName - Name of the page for context
 * @returns Object with startPhase and endPhase functions
 * 
 * @example
 * ```tsx
 * function DevelopPage() {
 *   const { startPhase, endPhase } = usePagePhases('develop-page');
 *   
 *   const handleChatFocus = () => startPhase('chat-interaction');
 *   const handleChatBlur = () => endPhase('chat-interaction');
 *   
 *   return <ChatPane onFocus={handleChatFocus} onBlur={handleChatBlur} />;
 * }
 * ```
 */
export function usePagePhases(pageName: string) {
  const activePhases = useRef<Map<string, { startTime: number }>>(new Map());

  const startPhase = (phaseName: string, labels?: Record<string, string | number | boolean>) => {
    const apm = getApmAgent();
    if (!apm) return;

    // Track phase start time
    activePhases.current.set(phaseName, {
      startTime: Date.now()
    });

    // Start a custom transaction for this phase
    const transaction = apm.startTransaction(
      `${pageName}-phase-${phaseName}`,
      'page-phase'
    );

    if (transaction && labels) {
      transaction.addLabels({
        page_name: pageName,
        phase_name: phaseName,
        ...labels
      });
    }
  };

  const endPhase = (phaseName: string) => {
    const phase = activePhases.current.get(phaseName);
    if (!phase) return;

    const duration = Date.now() - phase.startTime;
    activePhases.current.delete(phaseName);

    const apm = getApmAgent();
    if (!apm) return;

    const transaction = apm.getCurrentTransaction();
    if (transaction) {
      transaction.addLabels({
        phase_duration_ms: duration
      });
      transaction.end();
    }
  };

  // Cleanup: End all active phases on unmount
  useEffect(() => {
    return () => {
      // Synchronously end all phases during cleanup
      activePhases.current.forEach((phase, phaseName) => {
        const duration = Date.now() - phase.startTime;
        activePhases.current.delete(phaseName);

        // Attempt to end transaction synchronously
        const apm = getApmAgent();
        if (apm) {
          const transaction = apm.getCurrentTransaction();
          if (transaction) {
            transaction.addLabels({
              phase_duration_ms: duration
            });
            transaction.end();
          }
        }
      });
    };
  }, [pageName]);

  return { startPhase, endPhase };
}
