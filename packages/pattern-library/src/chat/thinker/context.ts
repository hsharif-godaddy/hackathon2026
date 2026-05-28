import { createContext } from 'react';

/**
 * Context broadcast by `Thinker` to its descendants when the `complete` prop
 * is active. `ThinkerReasoningBlock` reads this to skip its 3-line preview
 * and render its full content, so that revealing the collapsed panel shows
 * the entire reasoning stream immediately.
 *
 * Kept in a standalone module so the context identity is stable and there is
 * no circular import between `Thinker` and its compound slots.
 */
export const ThinkerCompleteContext = createContext(false);
