/* eslint-disable react-hooks/rules-of-hooks */
/**
 * @vitest-environment jsdom
 */

import { useMediaQuery } from 'react-responsive';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

import { LG_BREAKPOINT, MD_BREAKPOINT, SM_BREAKPOINT, useBreakpoints, XL_BREAKPOINT } from './useBreakpoints';

const XS_BREAKPOINT_MAX = SM_BREAKPOINT - 1;

// Mock react-responsive
vi.mock('react-responsive', () => ({
  useMediaQuery: vi.fn(),
}));

const mockUseMediaQuery = vi.mocked(useMediaQuery);

describe('useBreakpoints', function useBreakpointsTests() {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should return correct values for mobile width (< 640px)', function mobile() {
    mockUseMediaQuery.mockImplementation(function (query) {
      if (query.maxWidth === XS_BREAKPOINT_MAX) return true; // isBelowSmBreakpoint
      if (query.minWidth === SM_BREAKPOINT) return false; // isSmBreakpoint
      if (query.minWidth === MD_BREAKPOINT) return false; // isMdBreakpoint
      if (query.minWidth === LG_BREAKPOINT) return false; // isLgBreakpoint
      if (query.minWidth === XL_BREAKPOINT) return false; // isXlBreakpoint
      return false;
    });

    const { result } = renderHook(() => useBreakpoints());

    expect(result.current.isBelowSmBreakpoint).toBe(true);
    expect(result.current.isSmBreakpoint).toBe(false);
    expect(result.current.isMdBreakpoint).toBe(false);
    expect(result.current.isLgBreakpoint).toBe(false);
    expect(result.current.isXlBreakpoint).toBe(false);
  });

  it('should return correct values for sm breakpoint (640px)', function sm640() {
    mockUseMediaQuery.mockImplementation(function (query) {
      if (query.maxWidth === XS_BREAKPOINT_MAX) return false; // isBelowSmBreakpoint
      if (query.minWidth === SM_BREAKPOINT) return true; // isSmBreakpoint
      if (query.minWidth === MD_BREAKPOINT) return false; // isMdBreakpoint
      if (query.minWidth === LG_BREAKPOINT) return false; // isLgBreakpoint
      if (query.minWidth === XL_BREAKPOINT) return false; // isXlBreakpoint
      return false;
    });

    const { result } = renderHook(() => useBreakpoints());

    expect(result.current.isBelowSmBreakpoint).toBe(false);
    expect(result.current.isSmBreakpoint).toBe(true);
    expect(result.current.isMdBreakpoint).toBe(false);
    expect(result.current.isLgBreakpoint).toBe(false);
    expect(result.current.isXlBreakpoint).toBe(false);
  });

  it('should return correct values for md breakpoint (768px)', function md768() {
    mockUseMediaQuery.mockImplementation(function (query) {
      if (query.maxWidth === XS_BREAKPOINT_MAX) return false; // isBelowSmBreakpoint
      if (query.minWidth === SM_BREAKPOINT) return true; // isSmBreakpoint
      if (query.minWidth === MD_BREAKPOINT) return true; // isMdBreakpoint
      if (query.minWidth === LG_BREAKPOINT) return false; // isLgBreakpoint
      if (query.minWidth === XL_BREAKPOINT) return false; // isXlBreakpoint
      return false;
    });

    const { result } = renderHook(() => useBreakpoints());

    expect(result.current.isBelowSmBreakpoint).toBe(false);
    expect(result.current.isSmBreakpoint).toBe(true);
    expect(result.current.isMdBreakpoint).toBe(true);
    expect(result.current.isLgBreakpoint).toBe(false);
    expect(result.current.isXlBreakpoint).toBe(false);
  });

  it('should return correct values for lg breakpoint (1024px)', function lg1024() {
    mockUseMediaQuery.mockImplementation(function (query) {
      if (query.maxWidth === XS_BREAKPOINT_MAX) return false; // isBelowSmBreakpoint
      if (query.minWidth === SM_BREAKPOINT) return true; // isSmBreakpoint
      if (query.minWidth === MD_BREAKPOINT) return true; // isMdBreakpoint
      if (query.minWidth === LG_BREAKPOINT) return true; // isLgBreakpoint
      if (query.minWidth === XL_BREAKPOINT) return false; // isXlBreakpoint
      return false;
    });

    const { result } = renderHook(() => useBreakpoints());

    expect(result.current.isBelowSmBreakpoint).toBe(false);
    expect(result.current.isSmBreakpoint).toBe(true);
    expect(result.current.isMdBreakpoint).toBe(true);
    expect(result.current.isLgBreakpoint).toBe(true);
    expect(result.current.isXlBreakpoint).toBe(false);
  });

  it('should return correct values at 639px (just below sm)', function belowSm639() {
    mockUseMediaQuery.mockImplementation(function (query) {
      if (query.maxWidth === XS_BREAKPOINT_MAX) return true; // isBelowSmBreakpoint
      if (query.minWidth === SM_BREAKPOINT) return false; // isSmBreakpoint
      if (query.minWidth === MD_BREAKPOINT) return false; // isMdBreakpoint
      if (query.minWidth === LG_BREAKPOINT) return false; // isLgBreakpoint
      if (query.minWidth === XL_BREAKPOINT) return false; // isXlBreakpoint
      return false;
    });

    const { result } = renderHook(() => useBreakpoints());

    expect(result.current.isBelowSmBreakpoint).toBe(true);
    expect(result.current.isSmBreakpoint).toBe(false);
    expect(result.current.isMdBreakpoint).toBe(false);
    expect(result.current.isLgBreakpoint).toBe(false);
    expect(result.current.isXlBreakpoint).toBe(false);
  });

  it('should return correct values at 767px (just below md)', function belowMd767() {
    mockUseMediaQuery.mockImplementation(function (query) {
      if (query.maxWidth === XS_BREAKPOINT_MAX) return false; // isBelowSmBreakpoint
      if (query.minWidth === SM_BREAKPOINT) return true; // isSmBreakpoint
      if (query.minWidth === MD_BREAKPOINT) return false; // isMdBreakpoint
      if (query.minWidth === LG_BREAKPOINT) return false; // isLgBreakpoint
      if (query.minWidth === XL_BREAKPOINT) return false; // isXlBreakpoint
      return false;
    });

    const { result } = renderHook(() => useBreakpoints());

    expect(result.current.isBelowSmBreakpoint).toBe(false);
    expect(result.current.isSmBreakpoint).toBe(true);
    expect(result.current.isMdBreakpoint).toBe(false);
    expect(result.current.isLgBreakpoint).toBe(false);
    expect(result.current.isXlBreakpoint).toBe(false);
  });

  it('should return correct values at 1023px (just below lg)', function belowLg1023() {
    mockUseMediaQuery.mockImplementation(function (query) {
      if (query.maxWidth === XS_BREAKPOINT_MAX) return false; // isBelowSmBreakpoint
      if (query.minWidth === SM_BREAKPOINT) return true; // isSmBreakpoint
      if (query.minWidth === MD_BREAKPOINT) return true; // isMdBreakpoint
      if (query.minWidth === LG_BREAKPOINT) return false; // isLgBreakpoint
      if (query.minWidth === XL_BREAKPOINT) return false; // isXlBreakpoint
      return false;
    });

    const { result } = renderHook(() => useBreakpoints());

    expect(result.current.isBelowSmBreakpoint).toBe(false);
    expect(result.current.isSmBreakpoint).toBe(true);
    expect(result.current.isMdBreakpoint).toBe(true);
    expect(result.current.isLgBreakpoint).toBe(false);
    expect(result.current.isXlBreakpoint).toBe(false);
  });

  it('should return correct values for xl breakpoint (1280px)', function xl1280() {
    mockUseMediaQuery.mockImplementation(function (query) {
      if (query.maxWidth === XS_BREAKPOINT_MAX) return false; // isBelowSmBreakpoint
      if (query.minWidth === SM_BREAKPOINT) return true; // isSmBreakpoint
      if (query.minWidth === MD_BREAKPOINT) return true; // isMdBreakpoint
      if (query.minWidth === LG_BREAKPOINT) return true; // isLgBreakpoint
      if (query.minWidth === XL_BREAKPOINT) return true; // isXlBreakpoint
      return false;
    });

    const { result } = renderHook(() => useBreakpoints());

    expect(result.current.isBelowSmBreakpoint).toBe(false);
    expect(result.current.isSmBreakpoint).toBe(true);
    expect(result.current.isMdBreakpoint).toBe(true);
    expect(result.current.isLgBreakpoint).toBe(true);
    expect(result.current.isXlBreakpoint).toBe(true);
  });

  it('should return correct values at 1279px (just below xl)', function belowXl1279() {
    mockUseMediaQuery.mockImplementation(function (query) {
      if (query.maxWidth === XS_BREAKPOINT_MAX) return false; // isBelowSmBreakpoint
      if (query.minWidth === SM_BREAKPOINT) return true; // isSmBreakpoint
      if (query.minWidth === MD_BREAKPOINT) return true; // isMdBreakpoint
      if (query.minWidth === LG_BREAKPOINT) return true; // isLgBreakpoint
      if (query.minWidth === XL_BREAKPOINT) return false; // isXlBreakpoint
      return false;
    });

    const { result } = renderHook(() => useBreakpoints());

    expect(result.current.isBelowSmBreakpoint).toBe(false);
    expect(result.current.isSmBreakpoint).toBe(true);
    expect(result.current.isMdBreakpoint).toBe(true);
    expect(result.current.isLgBreakpoint).toBe(true);
    expect(result.current.isXlBreakpoint).toBe(false);
  });

  it('should return object with all breakpoint boolean properties', function returnType() {
    mockUseMediaQuery.mockImplementation(function (query) {
      if (query.maxWidth === XS_BREAKPOINT_MAX) return false; // isBelowSmBreakpoint
      if (query.minWidth === SM_BREAKPOINT) return false; // isSmBreakpoint
      if (query.minWidth === MD_BREAKPOINT) return false; // isMdBreakpoint
      if (query.minWidth === LG_BREAKPOINT) return false; // isLgBreakpoint
      if (query.minWidth === XL_BREAKPOINT) return false; // isXlBreakpoint
      return false;
    });

    const { result } = renderHook(() => useBreakpoints());

    expect(result.current).toHaveProperty('isBelowSmBreakpoint');
    expect(result.current).toHaveProperty('isSmBreakpoint');
    expect(result.current).toHaveProperty('isMdBreakpoint');
    expect(result.current).toHaveProperty('isLgBreakpoint');
    expect(result.current).toHaveProperty('isXlBreakpoint');
    expect(typeof result.current.isBelowSmBreakpoint).toBe('boolean');
    expect(typeof result.current.isSmBreakpoint).toBe('boolean');
    expect(typeof result.current.isMdBreakpoint).toBe('boolean');
    expect(typeof result.current.isLgBreakpoint).toBe('boolean');
    expect(typeof result.current.isXlBreakpoint).toBe('boolean');
  });
});
