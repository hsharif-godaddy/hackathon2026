import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useIsMobile } from './use-mobile';

describe('useIsMobile', () => {
  let matchMediaMock: {
    matches: boolean;
    media: string;
    addListener: ReturnType<typeof vi.fn>;
    removeListener: ReturnType<typeof vi.fn>;
    addEventListener: ReturnType<typeof vi.fn>;
    removeEventListener: ReturnType<typeof vi.fn>;
    dispatchEvent: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    // Mock matchMedia
    matchMediaMock = {
      matches: false,
      media: '(max-width: 767px)',
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    };

    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockReturnValue(matchMediaMock),
    });

    // Mock window.innerWidth
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      value: 1024,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should return false for desktop width', () => {
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      value: 1024,
    });

    const { result } = renderHook(() => useIsMobile());

    expect(result.current).toBe(false);
  });

  it('should return true for mobile width', () => {
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      value: 500,
    });

    const { result } = renderHook(() => useIsMobile());

    expect(result.current).toBe(true);
  });

  it('should return false for width at breakpoint (768px)', () => {
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      value: 768,
    });

    const { result } = renderHook(() => useIsMobile());

    expect(result.current).toBe(false);
  });

  it('should return true for width just below breakpoint (767px)', () => {
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      value: 767,
    });

    const { result } = renderHook(() => useIsMobile());

    expect(result.current).toBe(true);
  });

  it('should add event listener for media query changes', () => {
    renderHook(() => useIsMobile());

    expect(matchMediaMock.addEventListener).toHaveBeenCalledWith(
      'change',
      expect.any(Function)
    );
  });

  it('should remove event listener on unmount', () => {
    const { unmount } = renderHook(() => useIsMobile());

    unmount();

    expect(matchMediaMock.removeEventListener).toHaveBeenCalledWith(
      'change',
      expect.any(Function)
    );
  });

  it('should update when window is resized', () => {
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      value: 1024,
      configurable: true,
    });

    const { result } = renderHook(() => useIsMobile());

    expect(result.current).toBe(false);

    // Simulate window resize to mobile
    act(() => {
      Object.defineProperty(window, 'innerWidth', {
        writable: true,
        value: 500,
        configurable: true,
      });

      // Get the change callback
      const changeCallback = matchMediaMock.addEventListener.mock.calls[0][1];
      changeCallback();
    });

    expect(result.current).toBe(true);
  });

  it('should create media query with correct breakpoint', () => {
    renderHook(() => useIsMobile());

    expect(window.matchMedia).toHaveBeenCalledWith('(max-width: 767px)');
  });

  it('should return boolean false initially', () => {
    const { result } = renderHook(() => useIsMobile());

    expect(typeof result.current).toBe('boolean');
  });

  it('should handle multiple resize events', () => {
    const { result } = renderHook(() => useIsMobile());

    // Desktop
    act(() => {
      Object.defineProperty(window, 'innerWidth', {
        writable: true,
        value: 1024,
        configurable: true,
      });
      const changeCallback = matchMediaMock.addEventListener.mock.calls[0][1];
      changeCallback();
    });
    expect(result.current).toBe(false);

    // Mobile
    act(() => {
      Object.defineProperty(window, 'innerWidth', {
        writable: true,
        value: 500,
        configurable: true,
      });
      const changeCallback = matchMediaMock.addEventListener.mock.calls[0][1];
      changeCallback();
    });
    expect(result.current).toBe(true);

    // Desktop again
    act(() => {
      Object.defineProperty(window, 'innerWidth', {
        writable: true,
        value: 1024,
        configurable: true,
      });
      const changeCallback = matchMediaMock.addEventListener.mock.calls[0][1];
      changeCallback();
    });
    expect(result.current).toBe(false);
  });
});
