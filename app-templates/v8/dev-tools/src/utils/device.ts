/**
 * Detects if the current device supports touch input (mobile/tablet).
 * Checks for touch events and pointer capabilities.
 */
export function isTouchDevice(): boolean {
  return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
}
