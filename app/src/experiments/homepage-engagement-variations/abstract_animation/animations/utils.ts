export const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
