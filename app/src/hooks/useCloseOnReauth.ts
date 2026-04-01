import { useEffect, useRef } from 'react';

import { useAuthUIStore } from '@/stores/useAuthUIStore';

/**
 * Calls `onClose` when a *new* re-authentication event occurs.
 * Use in modals that make authenticated API calls to prevent z-fighting
 * with AuthBoundary/SsoLogin when a 401 triggers the auth flow.
 *
 * Tracks needsReauthSeq so it only fires on new events, not on mount
 * if needsReauth was already true from an earlier uncleared event.
 */
export function useCloseOnReauth(isOpen: boolean, onClose: () => void) {
  const seq = useAuthUIStore((state) => state.needsReauthSeq);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const seqAtOpen = useRef(seq);
  const wasOpen = useRef(isOpen);

  // Reset baseline when modal opens so long-lived components
  // don't permanently block modals after a prior reauth event.
  if (isOpen && !wasOpen.current) {
    seqAtOpen.current = seq;
  }
  wasOpen.current = isOpen;

  useEffect(() => {
    if (isOpen && seq > seqAtOpen.current) {
      onCloseRef.current();
    }
  }, [isOpen, seq]);
}
