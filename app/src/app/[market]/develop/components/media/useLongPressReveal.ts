import { useCallback, useRef, useState } from 'react';

const LONG_PRESS_MS = 450;

interface LongPressHandlers {
  onTouchStart: () => void;
  onTouchEnd: () => void;
  onTouchMove: () => void;
  onContextMenu: (event: { preventDefault: () => void }) => void;
}

interface UseLongPressReveal {
  /** Key of the tile whose actions are currently revealed via long-press, or null. */
  revealedKey: string | null;
  /** Touch handlers to spread onto a tile; reveals that tile's actions on hold. */
  getHandlers: (key: string) => LongPressHandlers;
  /** Hide any revealed actions (e.g. on a normal tap elsewhere). */
  clearRevealed: () => void;
  /**
   * Returns true once if the most recent touch was a completed long-press, so
   * the caller can swallow the trailing click that would otherwise select the
   * tile. Resets on read.
   */
  consumeLongPress: () => boolean;
}

/**
 * Touch long-press → reveal interaction for media thumbnails. Desktop reveals
 * tile actions on hover (CSS group-hover); touch devices have no hover, so a
 * press-and-hold ("hold to interact") reveals them instead.
 */
export function useLongPressReveal(): UseLongPressReveal {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firedRef = useRef<boolean>(false);
  const [revealedKey, setRevealedKey] = useState<string | null>(null);

  const cancelTimer = useCallback((): void => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const getHandlers = useCallback(
    (key: string): LongPressHandlers => ({
      onTouchStart: (): void => {
        cancelTimer();
        firedRef.current = false;
        timerRef.current = setTimeout((): void => {
          firedRef.current = true;
          setRevealedKey(key);
        }, LONG_PRESS_MS);
      },
      onTouchEnd: cancelTimer,
      onTouchMove: cancelTimer,
      // A held press fires the OS context menu / image callout; swallow it so the
      // hold only reveals the tile's actions rather than opening a native menu
      // (or, previously, jumping straight to the delete dialog).
      onContextMenu: (event: { preventDefault: () => void }): void => {
        event.preventDefault();
      },
    }),
    [cancelTimer],
  );

  const clearRevealed = useCallback((): void => {
    cancelTimer();
    setRevealedKey(null);
  }, [cancelTimer]);

  const consumeLongPress = useCallback((): boolean => {
    const fired: boolean = firedRef.current;
    firedRef.current = false;
    return fired;
  }, []);

  return { revealedKey, getHandlers, clearRevealed, consumeLongPress };
}
