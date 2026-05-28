import '@testing-library/jest-dom/vitest';

const { getComputedStyle } = window;
window.getComputedStyle = (elt) => getComputedStyle(elt);

if (typeof window.matchMedia !== 'function') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

/* `ResizeObserver` is not implemented in jsdom. A handful of UXCore2
 * components (notably `@ux/corner-actions`) call `new ResizeObserver(...)`
 * at mount time. Without a stub every test that renders one of those
 * components would throw. Keep this no-op global minimal — individual
 * tests should assert behavior, not observer callbacks. */
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    // biome-ignore lint/complexity/noUselessConstructor: matches the real ResizeObserver API so CodeQL doesn't flag production `new ResizeObserver(callback)` calls
    constructor(_callback: ResizeObserverCallback) {}
    observe() {}
    unobserve() {}
    disconnect() {}
  } as typeof ResizeObserver;
}

/* `scrollIntoView` is not implemented in jsdom. `@ux/listbox` calls it on
 * the focused option so the visually focused item stays on-screen during
 * keyboard navigation — a no-op stub keeps tests that interact with
 * ChoiceList (and any future listbox-based component) from throwing. */
if (typeof Element.prototype.scrollIntoView !== 'function') {
  Element.prototype.scrollIntoView = function scrollIntoView() {};
}

/* `Element.prototype.scrollTo` is not implemented in jsdom. Some components
 * may call `element.scrollTo()` (e.g. future smooth-scroll utilities). A no-op
 * stub keeps those tests from throwing. Note: `PanelChrome`'s smart auto-scroll
 * uses `element.scrollTop = n` (direct assignment) rather than `scrollTo`, so
 * auto-scroll tests assert on `element.scrollTop` instead of spying here. */
if (typeof Element.prototype.scrollTo !== 'function') {
  Element.prototype.scrollTo = function scrollTo() {};
}

/* `PointerEvent` may be absent or present-but-not-constructable in jsdom.
 * Docked-edge-resize tests need to fire pointerdown/pointermove with `clientX`.
 * Guard on constructability (not just `undefined`) to cover both cases. */
if (typeof globalThis.PointerEvent !== 'function') {
  globalThis.PointerEvent = class PointerEvent extends MouseEvent {
    pointerId: number;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init as MouseEventInit);
      this.pointerId = init.pointerId ?? 0;
    }
  } as typeof PointerEvent;
}

/* `Element.getAnimations()` is not implemented in jsdom. React Aria's
 * `SharedElementTransition` (used by `@godaddy/antares`'s
 * `SegmentedController` for its animated active-segment indicator) calls
 * it on every selection change. Returning an empty array satisfies the
 * "nothing in flight" branch without animating. */
if (typeof Element.prototype.getAnimations !== 'function') {
  Element.prototype.getAnimations = function getAnimations() {
    return [];
  };
}
