import { useMemo } from 'react';
import { ThinkingIndicator } from '@airo-ux/pattern-library/primitives/thinking-indicator';

import { useAuth } from '@/hooks/useAuth';
import { isTLAShopper } from '@/lib/is-tla-shopper';

/**
 * Branded Thinker graphic for agent-working surfaces — Thinking Daddy for
 * internal TLA accounts, GoDaddy mark for general customers.
 */
export function useThinkerIndicator() {
  const { getUserInfo } = useAuth();
  const shopperId = getUserInfo()?.shopperId;

  return useMemo(
    function buildThinkerIndicator() {
      return (
        <ThinkingIndicator
          variant={isTLAShopper(shopperId) ? 'thinking-daddy' : 'godaddy'}
        />
      );
    },
    [shopperId],
  );
}
