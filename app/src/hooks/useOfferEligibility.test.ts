/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';

import { useOfferEligibility } from './useOfferEligibility';

describe('useOfferEligibility', () => {
  it('returns eligible=true when a valid ISC is present', () => {
    const { result } = renderHook(() =>
      useOfferEligibility({ isc: 'GDWELCOME' })
    );
    expect(result.current).toEqual({ eligible: true });
  });

  it('returns eligible=false when ISC is null', () => {
    const { result } = renderHook(() => useOfferEligibility({ isc: null }));
    expect(result.current).toEqual({ eligible: false });
  });
});
