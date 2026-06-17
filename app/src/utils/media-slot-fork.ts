import { parseCollectionOccurrenceIndex } from '@airo/shared/media';

import type { BusMediaSlotForkContext } from '@/utils/eventBus';

export { parseCollectionOccurrenceIndex };

const SESSION_KEY_PREFIX = 'media-slot-fork:';
const SESSION_INDEX_PREFIX = 'media-slot-occurrence:';

export function saveMediaSlotForkContext(slotName: string, forkContext: BusMediaSlotForkContext): void {
  try {
    sessionStorage.setItem(`${SESSION_KEY_PREFIX}${slotName}`, JSON.stringify(forkContext));
  } catch {
    // sessionStorage may be unavailable
  }
}

export function loadMediaSlotForkContext(slotName: string): BusMediaSlotForkContext | null {
  try {
    const raw = sessionStorage.getItem(`${SESSION_KEY_PREFIX}${slotName}`);
    if (!raw) {
      return null;
    }
    return JSON.parse(raw) as BusMediaSlotForkContext;
  } catch {
    return null;
  }
}

export function clearMediaSlotForkContext(slotName: string): void {
  try {
    sessionStorage.removeItem(`${SESSION_KEY_PREFIX}${slotName}`);
    sessionStorage.removeItem(`${SESSION_INDEX_PREFIX}${slotName}`);
  } catch {
    // sessionStorage may be unavailable
  }
}

export function saveMediaSlotOccurrenceIndex(slotName: string, occurrenceIndex: number): void {
  try {
    sessionStorage.setItem(`${SESSION_INDEX_PREFIX}${slotName}`, String(occurrenceIndex));
  } catch {
    // sessionStorage may be unavailable
  }
}

export function loadMediaSlotOccurrenceIndex(slotName: string): number | null {
  try {
    const raw = sessionStorage.getItem(`${SESSION_INDEX_PREFIX}${slotName}`);
    if (raw == null) {
      return null;
    }
    const index = parseInt(raw, 10);
    return Number.isFinite(index) && index >= 0 ? index : null;
  } catch {
    return null;
  }
}
