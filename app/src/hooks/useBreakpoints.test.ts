/* eslint-disable react-hooks/rules-of-hooks */
/**
 * @vitest-environment jsdom
 */

import { useMediaQuery } from 'react-responsive';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

import { LG_BREAKPOINT, MD_BREAKPOINT, SM_BREAKPOINT, useBreakpoints, XL_BREAKPOINT } from './useBreakpoints';

const BELOW_SM_MAX = SM_BREAKPOINT - 1;
const BELOW_MD_MAX = MD_BREAKPOINT - 1;

vi.mock('react-responsive', () => ({
  useMediaQuery: vi.fn(),
}));

const mockUseMediaQuery = vi.mocked(useMediaQuery);

function mockMediaQuery(matches: {
  belowSm: boolean;
  belowMd: boolean;
  smAndUp: boolean;
  mdAndUp: boolean;
  lgAndUp: boolean;
  xlAndUp: boolean;
}): void {
  mockUseMediaQuery.mockImplementation(function (query) {
    if (query.maxWidth === BELOW_SM_MAX) return matches.belowSm;
    if (query.maxWidth === BELOW_MD_MAX) return matches.belowMd;
    if (query.minWidth === SM_BREAKPOINT) return matches.smAndUp;
    if (query.minWidth === MD_BREAKPOINT) return matches.mdAndUp;
    if (query.minWidth === LG_BREAKPOINT) return matches.lgAndUp;
    if (query.minWidth === XL_BREAKPOINT) return matches.xlAndUp;
    return false;
  });
}

describe('useBreakpoints', function useBreakpointsTests() {
  beforeEach(function reset() {
    vi.clearAllMocks();
  });

  afterEach(function cleanup() {
    vi.clearAllMocks();
  });

  describe('below sm (< 640px, pre-sm default range)', function belowSmTests() {
    it('should flag isBelowSmBreakpoint and isBelowMdBreakpoint at 639px', function at639() {
      mockMediaQuery({
        belowSm: true,
        belowMd: true,
        smAndUp: false,
        mdAndUp: false,
        lgAndUp: false,
        xlAndUp: false,
      });

      const { result } = renderHook(() => useBreakpoints());

      expect(result.current.isBelowSmBreakpoint).toBe(true);
      expect(result.current.isBelowMdBreakpoint).toBe(true);
      expect(result.current.isSmBreakpoint).toBe(false);
      expect(result.current.isMdBreakpoint).toBe(false);
    });
  });

  describe('between sm and md (640–767px)', function betweenSmAndMdTests() {
    it('should not flag isBelowSmBreakpoint at 767px', function at767() {
      mockMediaQuery({
        belowSm: false,
        belowMd: true,
        smAndUp: true,
        mdAndUp: false,
        lgAndUp: false,
        xlAndUp: false,
      });

      const { result } = renderHook(() => useBreakpoints());

      expect(result.current.isBelowSmBreakpoint).toBe(false);
      expect(result.current.isBelowMdBreakpoint).toBe(true);
      expect(result.current.isSmBreakpoint).toBe(true);
      expect(result.current.isMdBreakpoint).toBe(false);
    });

    it('should flag isBelowMdBreakpoint at 640px (mobile layout, not below sm)', function at640() {
      mockMediaQuery({
        belowSm: false,
        belowMd: true,
        smAndUp: true,
        mdAndUp: false,
        lgAndUp: false,
        xlAndUp: false,
      });

      const { result } = renderHook(() => useBreakpoints());

      expect(result.current.isBelowSmBreakpoint).toBe(false);
      expect(result.current.isBelowMdBreakpoint).toBe(true);
    });
  });

  describe('at md and above (≥ 768px, desktop layout)', function mdAndAboveTests() {
    it('should clear isBelowMdBreakpoint at 768px', function at768() {
      mockMediaQuery({
        belowSm: false,
        belowMd: false,
        smAndUp: true,
        mdAndUp: true,
        lgAndUp: false,
        xlAndUp: false,
      });

      const { result } = renderHook(() => useBreakpoints());

      expect(result.current.isBelowSmBreakpoint).toBe(false);
      expect(result.current.isBelowMdBreakpoint).toBe(false);
      expect(result.current.isSmBreakpoint).toBe(true);
      expect(result.current.isMdBreakpoint).toBe(true);
    });

    it('should flag lg at 1024px', function at1024() {
      mockMediaQuery({
        belowSm: false,
        belowMd: false,
        smAndUp: true,
        mdAndUp: true,
        lgAndUp: true,
        xlAndUp: false,
      });

      const { result } = renderHook(() => useBreakpoints());

      expect(result.current.isLgBreakpoint).toBe(true);
      expect(result.current.isXlBreakpoint).toBe(false);
    });

    it('should flag xl at 1280px', function at1280() {
      mockMediaQuery({
        belowSm: false,
        belowMd: false,
        smAndUp: true,
        mdAndUp: true,
        lgAndUp: true,
        xlAndUp: true,
      });

      const { result } = renderHook(() => useBreakpoints());

      expect(result.current.isXlBreakpoint).toBe(true);
    });

    it('should not flag xl at 1279px', function at1279() {
      mockMediaQuery({
        belowSm: false,
        belowMd: false,
        smAndUp: true,
        mdAndUp: true,
        lgAndUp: true,
        xlAndUp: false,
      });

      const { result } = renderHook(() => useBreakpoints());

      expect(result.current.isLgBreakpoint).toBe(true);
      expect(result.current.isXlBreakpoint).toBe(false);
    });

    it('should not flag lg at 1023px', function at1023() {
      mockMediaQuery({
        belowSm: false,
        belowMd: false,
        smAndUp: true,
        mdAndUp: true,
        lgAndUp: false,
        xlAndUp: false,
      });

      const { result } = renderHook(() => useBreakpoints());

      expect(result.current.isLgBreakpoint).toBe(false);
      expect(result.current.isMdBreakpoint).toBe(true);
    });
  });

  describe('return shape', function returnShapeTests() {
    it('should expose all breakpoint boolean properties', function returnType() {
      mockMediaQuery({
        belowSm: false,
        belowMd: false,
        smAndUp: false,
        mdAndUp: false,
        lgAndUp: false,
        xlAndUp: false,
      });

      const { result } = renderHook(() => useBreakpoints());

      expect(result.current).toHaveProperty('isBelowSmBreakpoint');
      expect(result.current).toHaveProperty('isBelowMdBreakpoint');
      expect(result.current).toHaveProperty('isSmBreakpoint');
      expect(result.current).toHaveProperty('isMdBreakpoint');
      expect(result.current).toHaveProperty('isLgBreakpoint');
      expect(result.current).toHaveProperty('isXlBreakpoint');
      expect(typeof result.current.isBelowSmBreakpoint).toBe('boolean');
      expect(typeof result.current.isBelowMdBreakpoint).toBe('boolean');
    });
  });
});
