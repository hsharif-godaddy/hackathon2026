import { type ReactElement,useMemo } from 'react';
import { ThinkingIndicator } from '@airo-ux/pattern-library/primitives/thinking-indicator';

import { useSwitchboard } from '@/hooks/useSwitchboard';

/**
 * Branded Thinker graphic for agent-working surfaces — Thinking Daddy when the
 * `appbuilder-thinking-daddy` flag is on, GoDaddy mark otherwise.
 */
export function useThinkerIndicator(): ReactElement {
  const isThinkingDaddyEnabled: boolean = useSwitchboard('appbuilder-thinking-daddy') === true;

  return useMemo(
    function buildThinkerIndicator(): ReactElement {
      return (
        <ThinkingIndicator
          variant={isThinkingDaddyEnabled ? 'thinking-daddy' : 'godaddy'}
        />
      );
    },
    [isThinkingDaddyEnabled],
  );
}
