/* eslint-disable react-hooks/rules-of-hooks */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useResponsive, SM_BREAKPOINT, LG_BREAKPOINT } from './useResponsive';
import { useMediaQuery } from 'react-responsive';

const XS_BREAKPOINT_MAX = SM_BREAKPOINT - 1;
const MD_BREAKPOINT_MAX = LG_BREAKPOINT - 1;

// Mock react-responsive
vi.mock('react-responsive', () => ({
  useMediaQuery: vi.fn(),
}));

const mockUseMediaQuery = vi.mocked(useMediaQuery);

describe('useResponsive', function useResponsiveTests() {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should return false for both mobile and tablet on desktop width', function desktop() {
    mockUseMediaQuery.mockImplementation((query) => {
      if (query.maxWidth === XS_BREAKPOINT_MAX) return false; // isMobile
      if (query.minWidth === SM_BREAKPOINT && query.maxWidth === MD_BREAKPOINT_MAX) return false; // isTablet
      return false;
    });

    const { result } = renderHook(() => useResponsive());

    expect(result.current.isMobile).toBe(false);
    expect(result.current.isTablet).toBe(false);
  });

  it('should return true for mobile and false for tablet on mobile width', function mobile() {
    mockUseMediaQuery.mockImplementation((query) => {
      if (query.maxWidth === XS_BREAKPOINT_MAX) return true; // isMobile
      if (query.minWidth === SM_BREAKPOINT && query.maxWidth === MD_BREAKPOINT_MAX) return false; // isTablet
      return false;
    });

    const { result } = renderHook(() => useResponsive());

    expect(result.current.isMobile).toBe(true);
    expect(result.current.isTablet).toBe(false);
  });

  it('should return false for mobile and true for tablet on tablet width', function tablet() {
    mockUseMediaQuery.mockImplementation((query) => {
      if (query.maxWidth === XS_BREAKPOINT_MAX) return false; // isMobile
      if (query.minWidth === SM_BREAKPOINT && query.maxWidth === MD_BREAKPOINT_MAX) return true; // isTablet
      return false;
    });

    const { result } = renderHook(() => useResponsive());

    expect(result.current.isMobile).toBe(false);
    expect(result.current.isTablet).toBe(true);
  });

  it('should return true for mobile at 639px (just below tablet)', function mobile639() {
    mockUseMediaQuery.mockImplementation((query) => {
      if (query.maxWidth === XS_BREAKPOINT_MAX) return true; // isMobile
      if (query.minWidth === SM_BREAKPOINT && query.maxWidth === MD_BREAKPOINT_MAX) return false; // isTablet
      return false;
    });

    const { result } = renderHook(() => useResponsive());

    expect(result.current.isMobile).toBe(true);
    expect(result.current.isTablet).toBe(false);
  });

  it('should return false for mobile and true for tablet at 640px (tablet start)', function tablet640() {
    mockUseMediaQuery.mockImplementation((query) => {
      if (query.maxWidth === XS_BREAKPOINT_MAX) return false; // isMobile
      if (query.minWidth === SM_BREAKPOINT && query.maxWidth === MD_BREAKPOINT_MAX) return true; // isTablet
      return false;
    });

    const { result } = renderHook(() => useResponsive());

    expect(result.current.isMobile).toBe(false);
    expect(result.current.isTablet).toBe(true);
  });

  it('should return false for mobile and true for tablet at 1023px (tablet end)', function tablet1023() {
    mockUseMediaQuery.mockImplementation((query) => {
      if (query.maxWidth === XS_BREAKPOINT_MAX) return false; // isMobile
      if (query.minWidth === SM_BREAKPOINT && query.maxWidth === MD_BREAKPOINT_MAX) return true; // isTablet
      return false;
    });

    const { result } = renderHook(() => useResponsive());

    expect(result.current.isMobile).toBe(false);
    expect(result.current.isTablet).toBe(true);
  });

  it('should return false for both mobile and tablet at 1024px (desktop start)', function desktop1024() {
    mockUseMediaQuery.mockImplementation((query) => {
      if (query.maxWidth === XS_BREAKPOINT_MAX) return false; // isMobile
      if (query.minWidth === SM_BREAKPOINT && query.maxWidth === MD_BREAKPOINT_MAX) return false; // isTablet
      return false;
    });

    const { result } = renderHook(() => useResponsive());

    expect(result.current.isMobile).toBe(false);
    expect(result.current.isTablet).toBe(false);
  });

  it('should return object with isMobile and isTablet boolean properties', function returnType() {
    mockUseMediaQuery.mockImplementation((query) => {
      if (query.maxWidth === XS_BREAKPOINT_MAX) return false; // isMobile
      if (query.minWidth === SM_BREAKPOINT && query.maxWidth === MD_BREAKPOINT_MAX) return false; // isTablet
      return false;
    });

    const { result } = renderHook(() => useResponsive());

    expect(result.current).toHaveProperty('isMobile');
    expect(result.current).toHaveProperty('isTablet');
    expect(typeof result.current.isMobile).toBe('boolean');
    expect(typeof result.current.isTablet).toBe('boolean');
  });
});

