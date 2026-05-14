import { useMemo } from 'react';

import { type KnownIsc, normalizeIsc } from '@/lib/domain-offers/isc-config';

export type IscSource = 'url' | 'cookie' | null;

export interface ResolvedIsc {
  isc: KnownIsc | null;
  source: IscSource;
}

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const prefix = `${name}=`;
  const parts = document.cookie ? document.cookie.split(';') : [];
  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed.startsWith(prefix)) {
      const raw = trimmed.slice(prefix.length);
      // Guard against malformed percent-encoding (e.g. truncated %E0%A4%A) —
      // decodeURIComponent throws URIError. Same pattern as visitor-id.ts.
      try {
        return decodeURIComponent(raw);
      } catch {
        return raw;
      }
    }
  }
  return null;
}

export function useIscResolver(): ResolvedIsc {
  return useMemo<ResolvedIsc>(() => {
    if (typeof window === 'undefined') return { isc: null, source: null };

    const urlParams = new URLSearchParams(window.location.search);
    const fromUrl = normalizeIsc(urlParams.get('isc'));
    if (fromUrl) return { isc: fromUrl, source: 'url' };

    const fromCookie = normalizeIsc(readCookie('isc'));
    if (fromCookie) return { isc: fromCookie, source: 'cookie' };

    return { isc: null, source: null };
  }, []);
}
