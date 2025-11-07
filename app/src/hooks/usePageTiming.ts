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

  const apm = (window as any).__apmInstance as ApmAgent | undefined;
  
  // Check if APM exists and is active
  if (!apm || !apm.isActive || !apm.isActive()) {
    logger.debug('hooks.usePageTiming.getApmAgent.inactive', {
      message: 'APM agent is not active',
      has_apm: !!apm,
      has_isActive: !!(apm && apm.isActive)
    });
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
 * The hook handles multiple types of navigation:
 * - Client-side Next.js navigation (via manual endTransaction call)
 * - SSO redirects (via beforeunload event)
 * - Tab closes and browser navigation (via beforeunload event)
 * - Component unmount (via useEffect cleanup)
 * 
 * @param pageName - Name of the page (e.g., 'create-page', 'develop-page')
 * @param pageId - Optional app ID to add as app_id label
 * @param additionalLabels - DEPRECATED: Not used due to React dependency limitations.
 *   Adding object parameters to useEffect dependencies causes infinite re-renders.
 *   Labels are captured at component mount time only.
 * @returns Object with endTransaction function to manually end the transaction before component unmount
 * 
 * Transaction name format: `page-{pageName}` (e.g., 'page-create-page', 'page-develop-page')
 * 
 * Labels added to transaction:
 * - page_name: The pageName parameter
 * - app_id: The pageId parameter (if provided)
 * 
 * @example
 * ```tsx
 * function CreatePage() {
 *   const { endTransaction } = usePageTiming('create-page', appId);
 *   // Creates transaction: "page-create-page" with labels: { page_name: 'create-page', app_id: appId }
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
): { endTransaction: () => void } {
  const transactionRef = useRef<ApmTransaction | null>(null);
  const startTimeRef = useRef<number>(0);
  const initAttemptedRef = useRef<boolean>(false);

  const endTransaction = useCallback(() => {
    if (transactionRef.current) {
      try {
        const duration = Date.now() - startTimeRef.current;
        transactionRef.current.end();
        
        logger.info('hooks.usePageTiming.transaction.ended.manual', {
          message: 'Manually ended page timing transaction',
          page_name: pageName,
          duration_seconds: Math.round(duration / 1000),
          duration_ms: duration
        });

        transactionRef.current = null;
      } catch (error) {
        logger.error('hooks.usePageTiming.transaction.end.error', {
          message: 'Failed to end transaction manually',
          page_name: pageName,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }, [pageName]);

  useEffect(() => {
    // Only attempt initialization once
    if (initAttemptedRef.current) return;
    initAttemptedRef.current = true;

    const initTransaction = () => {
      // Wait a bit for RUM to initialize
      setTimeout(() => {
        const apm = getApmAgent();
        
        if (!apm) {
          logger.warn('hooks.usePageTiming.init.no-apm', {
            message: 'APM agent not available for page timing',
            page_name: pageName,
            app_id: pageId,
            window_defined: typeof window !== 'undefined',
            has_apm_instance: !!(window as any).__apmInstance
          });
          return;
        }

        // Start custom transaction for page timing
        const transactionName = `page-${pageName}`;

        startTimeRef.current = Date.now();
        
        try {
          const transaction = apm.startTransaction(transactionName, 'page-timing');

          if (transaction) {
            transactionRef.current = transaction;

            // Add labels for filtering in Kibana
            // Note: Only pageName and pageId are used as labels since additionalLabels
            // cannot be tracked in the dependency array (would cause infinite re-renders)
            transaction.addLabels({
              page_name: pageName,
              ...(pageId && { app_id: pageId })
            });

            logger.info('hooks.usePageTiming.transaction.started', {
              message: 'Started page timing transaction',
              transaction_name: transactionName,
              page_name: pageName,
              app_id: pageId
            });
          } else {
            logger.warn('hooks.usePageTiming.transaction.null', {
              message: 'startTransaction returned null',
              transaction_name: transactionName,
              page_name: pageName
            });
          }
        } catch (error) {
          logger.error('hooks.usePageTiming.transaction.error', {
            message: 'Error starting transaction',
            page_name: pageName,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }, 1000);
    };

    initTransaction();

    // Add beforeunload event listener to catch SSO redirects, tab closes, and other unload events
    const handleBeforeUnload = () => {
      if (transactionRef.current) {
        const duration = Date.now() - startTimeRef.current;
        transactionRef.current.end();
        
        logger.info('hooks.usePageTiming.transaction.ended.beforeunload', {
          message: 'Ended page timing transaction on page unload',
          page_name: pageName,
          duration_seconds: Math.round(duration / 1000),
          duration_ms: duration,
          trigger: 'beforeunload'
        });
        
        transactionRef.current = null;
      }
    };
    
    window.addEventListener('beforeunload', handleBeforeUnload);

    // Cleanup: End transaction when component unmounts
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      
      if (transactionRef.current) {
        try {
          const duration = Date.now() - startTimeRef.current;
          transactionRef.current.end();
          
          logger.info('hooks.usePageTiming.transaction.ended', {
            message: 'Ended page timing transaction',
            page_name: pageName,
            duration_seconds: Math.round(duration / 1000),
            duration_ms: duration
          });
        } catch (error) {
          logger.warn('hooks.usePageTiming.transaction.end.failure', {
            message: 'Failed to end transaction',
            page_name: pageName,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }
    };
  }, [pageName, pageId]);

  return { endTransaction };
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

    logger.debug('hooks.usePagePhases.phase.started', {
      message: 'Started page phase tracking',
      page_name: pageName,
      phase_name: phaseName
    });
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

    logger.debug('hooks.usePagePhases.phase.ended', {
      message: 'Ended page phase tracking',
      page_name: pageName,
      phase_name: phaseName,
      duration_seconds: Math.round(duration / 1000),
      duration_ms: duration
    });
  };

  // Cleanup: End all active phases on unmount
  useEffect(() => {
    return () => {
      // Synchronously end all phases during cleanup
      activePhases.current.forEach((phase, phaseName) => {
        const duration = Date.now() - phase.startTime;
        activePhases.current.delete(phaseName);
        
        logger.debug('hooks.usePagePhases.phase.cleanup', {
          message: 'Cleaning up page phase on unmount',
          page_name: pageName,
          phase_name: phaseName,
          duration_ms: duration
        });
        
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
