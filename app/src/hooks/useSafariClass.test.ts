import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useSafariClass } from './useSafariClass';

describe('useSafariClass', () => {
  let originalUserAgent: string;
  let originalVendor: string;

  beforeEach(() => {
    // Save original values
    originalUserAgent = navigator.userAgent;
    originalVendor = navigator.vendor;

    // Clear any existing classes
    document.documentElement.classList.remove('is-safari');
  });

  afterEach(() => {
    // Restore original values
    Object.defineProperty(navigator, 'userAgent', {
      value: originalUserAgent,
      configurable: true,
    });
    Object.defineProperty(navigator, 'vendor', {
      value: originalVendor,
      configurable: true,
    });

    // Clean up class
    document.documentElement.classList.remove('is-safari');
  });

  it('should add is-safari class when Safari is detected', () => {
    // Mock Safari user agent and vendor
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Safari/605.1.15',
      configurable: true,
    });
    Object.defineProperty(navigator, 'vendor', {
      value: 'Apple Computer, Inc.',
      configurable: true,
    });

    renderHook(() => useSafariClass());

    expect(document.documentElement.classList.contains('is-safari')).toBe(true);
  });

  it('should not add is-safari class for Chrome', () => {
    // Mock Chrome user agent
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      configurable: true,
    });
    Object.defineProperty(navigator, 'vendor', {
      value: 'Google Inc.',
      configurable: true,
    });

    renderHook(() => useSafariClass());

    expect(document.documentElement.classList.contains('is-safari')).toBe(false);
  });

  it('should not add is-safari class for Firefox', () => {
    // Mock Firefox user agent
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:120.0) Gecko/20100101 Firefox/120.0',
      configurable: true,
    });
    Object.defineProperty(navigator, 'vendor', {
      value: '',
      configurable: true,
    });

    renderHook(() => useSafariClass());

    expect(document.documentElement.classList.contains('is-safari')).toBe(false);
  });

  it('should not add is-safari class for Edge', () => {
    // Mock Edge user agent
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
      configurable: true,
    });
    Object.defineProperty(navigator, 'vendor', {
      value: 'Google Inc.',
      configurable: true,
    });

    renderHook(() => useSafariClass());

    expect(document.documentElement.classList.contains('is-safari')).toBe(false);
  });

  it('should not add is-safari class for Android Chrome', () => {
    // Mock Android Chrome user agent
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
      configurable: true,
    });
    Object.defineProperty(navigator, 'vendor', {
      value: 'Google Inc.',
      configurable: true,
    });

    renderHook(() => useSafariClass());

    expect(document.documentElement.classList.contains('is-safari')).toBe(false);
  });

  it('should add is-safari class for iOS Safari', () => {
    // Mock iOS Safari user agent and vendor
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
      configurable: true,
    });
    Object.defineProperty(navigator, 'vendor', {
      value: 'Apple Computer, Inc.',
      configurable: true,
    });

    renderHook(() => useSafariClass());

    expect(document.documentElement.classList.contains('is-safari')).toBe(true);
  });

  it('should require both Safari user agent and Apple vendor', () => {
    // Safari user agent but wrong vendor
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Safari/605.1.15',
      configurable: true,
    });
    Object.defineProperty(navigator, 'vendor', {
      value: 'Google Inc.',
      configurable: true,
    });

    renderHook(() => useSafariClass());

    expect(document.documentElement.classList.contains('is-safari')).toBe(false);
  });

  it('should remove is-safari class on unmount', () => {
    // Mock Safari
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Safari/605.1.15',
      configurable: true,
    });
    Object.defineProperty(navigator, 'vendor', {
      value: 'Apple Computer, Inc.',
      configurable: true,
    });

    const { unmount } = renderHook(() => useSafariClass());

    expect(document.documentElement.classList.contains('is-safari')).toBe(true);

    unmount();

    expect(document.documentElement.classList.contains('is-safari')).toBe(false);
  });

  it('should not remove class on unmount if not Safari', () => {
    // Mock Chrome
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      configurable: true,
    });
    Object.defineProperty(navigator, 'vendor', {
      value: 'Google Inc.',
      configurable: true,
    });

    const { unmount } = renderHook(() => useSafariClass());

    expect(document.documentElement.classList.contains('is-safari')).toBe(false);

    unmount();

    // Should still be false (no attempt to remove)
    expect(document.documentElement.classList.contains('is-safari')).toBe(false);
  });

  it('should handle multiple renders correctly', () => {
    // Mock Safari
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Safari/605.1.15',
      configurable: true,
    });
    Object.defineProperty(navigator, 'vendor', {
      value: 'Apple Computer, Inc.',
      configurable: true,
    });

    const { rerender } = renderHook(() => useSafariClass());

    expect(document.documentElement.classList.contains('is-safari')).toBe(true);

    // Rerender should not duplicate or remove class
    rerender();

    expect(document.documentElement.classList.contains('is-safari')).toBe(true);
  });
});
