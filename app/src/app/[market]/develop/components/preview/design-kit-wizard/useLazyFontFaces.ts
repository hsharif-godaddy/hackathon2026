import { useCallback, useRef } from 'react';

/** Weights loaded for preview faces — small on purpose. */
const PREVIEW_WEIGHTS = '400;600';

/**
 * Inject a single Google Fonts stylesheet `<link>` for the families in `families`
 * that are not already in `registry`. Mutates `registry` to record what was loaded.
 * Pure DOM side effect; safe to call repeatedly — only new families trigger a request.
 */
export function ensureFontFacesLoaded(families: string[], registry: Set<string>): void {
  if (typeof document === 'undefined') return;
  const fresh = families.filter((f) => f && !registry.has(f));
  if (fresh.length === 0) return;

  for (const f of fresh) registry.add(f);

  const familyParams = fresh.map((f) => `family=${encodeURIComponent(f).replace(/%20/g, '+')}:wght@${PREVIEW_WEIGHTS}`);
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.setAttribute('data-design-kit-font', '');
  link.href = `https://fonts.googleapis.com/css2?${familyParams.join('&')}&display=swap`;
  document.head.appendChild(link);
}

let tagExampleFontsRequested = false;

/**
 * Preload the per-tag example fonts (rendered in the filter chips) in a SINGLE
 * Google Fonts request. The set is fixed, so this fires once per page and is a
 * no-op on every subsequent call. Weight 400 only — these are small chip labels.
 */
export function ensureTagExampleFontsLoaded(families: string[]): void {
  if (tagExampleFontsRequested || typeof document === 'undefined' || families.length === 0) return;
  tagExampleFontsRequested = true;

  const familyParams = families.map((f) => `family=${encodeURIComponent(f).replace(/%20/g, '+')}:wght@400`);
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.setAttribute('data-design-kit-tag-fonts', '');
  link.href = `https://fonts.googleapis.com/css2?${familyParams.join('&')}&display=swap`;
  document.head.appendChild(link);
}

/**
 * Hook returning a stable `requestFonts(families)` callback that lazily loads
 * preview faces for the given families, deduped across the component's lifetime.
 */
export function useLazyFontFaces(): (families: string[]) => void {
  const registry = useRef<Set<string>>(new Set());
  return useCallback((families: string[]) => {
    ensureFontFacesLoaded(families, registry.current);
  }, []);
}
