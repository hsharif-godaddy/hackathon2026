import type { KnownIsc } from '@/lib/domain-offers/isc-config';

export interface UseOfferEligibilityOptions {
  isc: KnownIsc | null;
}

export interface OfferEligibility {
  eligible: boolean;
}

// Dedicated seam: today eligibility = "has a valid ISC" and the real NC gate
// is enforced server-side by SAPI and checkout. A stricter commerce-API or
// pricing-merch pre-check can replace this body without touching callers.
export function useOfferEligibility({
  isc,
}: UseOfferEligibilityOptions): OfferEligibility {
  return { eligible: isc !== null };
}
