/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';

import { renderWithProviders } from '@/tests/test-utils';

const mockInitApm = vi.fn().mockReturnValue({ isActive: () => true });

vi.mock('@elastic/apm-rum', () => ({
  init: mockInitApm,
}));

vi.mock('@/lib/request-context', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Must import after mocks are set up
const { detectEnvironment, detectServerUrl } = await import('./RumProvider');
const { logger } = await import('@/lib/request-context');

describe('RumProvider', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.NEXT_PUBLIC_ELASTIC_APM_ENVIRONMENT;
    delete process.env.NEXT_PUBLIC_ELASTIC_APM_SERVER_URL;
    delete process.env.NEXT_PUBLIC_ELASTIC_APM_ACTIVE;
    delete process.env.NEXT_PUBLIC_ELASTIC_APM_SERVICE_NAME;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('#detectEnvironment', () => {
    it('should return environment from NEXT_PUBLIC_ELASTIC_APM_ENVIRONMENT', () => {
      process.env.NEXT_PUBLIC_ELASTIC_APM_ENVIRONMENT = 'production';
      expect(detectEnvironment()).toBe('production');
    });

    it('should return test when env var is set to test', () => {
      process.env.NEXT_PUBLIC_ELASTIC_APM_ENVIRONMENT = 'test';
      expect(detectEnvironment()).toBe('test');
    });

    it('should default to development when env var is not set', () => {
      expect(detectEnvironment()).toBe('development');
    });

    it('should warn for unrecognized environment value', () => {
      process.env.NEXT_PUBLIC_ELASTIC_APM_ENVIRONMENT = 'staging';
      detectEnvironment();
      expect(logger.warn).toHaveBeenCalledWith(
        'rum.provider.unknown.environment',
        { environment: 'staging' }
      );
    });

    it('should not warn for recognized environment values', () => {
      process.env.NEXT_PUBLIC_ELASTIC_APM_ENVIRONMENT = 'production';
      detectEnvironment();
      expect(logger.warn).not.toHaveBeenCalled();
    });
  });

  describe('#detectServerUrl', () => {
    it('should return the configured APM server URL', () => {
      process.env.NEXT_PUBLIC_ELASTIC_APM_SERVER_URL = 'https://apm.example.com:443';
      expect(detectServerUrl()).toBe('https://apm.example.com:443');
    });

    it('should return empty string when env var is not set', () => {
      expect(detectServerUrl()).toBe('');
    });
  });

  describe('activation gate', () => {
    it('should initialize APM when NEXT_PUBLIC_ELASTIC_APM_ACTIVE is true', async () => {
      process.env.NEXT_PUBLIC_ELASTIC_APM_ACTIVE = 'true';
      process.env.NEXT_PUBLIC_ELASTIC_APM_ENVIRONMENT = 'production';
      process.env.NEXT_PUBLIC_ELASTIC_APM_SERVER_URL = 'https://apm.example.com:443';
      Object.defineProperty(window, 'location', {
        value: { hostname: 'airo-builder.godaddy.com', origin: 'https://airo-builder.godaddy.com' },
        writable: true,
      });

      const { default: RumProvider } = await import('./RumProvider');
      renderWithProviders(<RumProvider><div>child</div></RumProvider>);

      await waitFor(() => {
        expect(mockInitApm).toHaveBeenCalled();
      });
    });

    it('should not initialize APM when NEXT_PUBLIC_ELASTIC_APM_ACTIVE is false', async () => {
      process.env.NEXT_PUBLIC_ELASTIC_APM_ACTIVE = 'false';
      Object.defineProperty(window, 'location', {
        value: { hostname: 'localhost', origin: 'http://localhost:3000' },
        writable: true,
      });

      const { default: RumProvider } = await import('./RumProvider');
      renderWithProviders(<RumProvider><div>child</div></RumProvider>);

      await waitFor(() => {
        expect(mockInitApm).not.toHaveBeenCalled();
      });
    });

    it('should use activation rate when NEXT_PUBLIC_ELASTIC_APM_ACTIVE is absent', async () => {
      process.env.NEXT_PUBLIC_ELASTIC_APM_ENVIRONMENT = 'production';
      vi.spyOn(Math, 'random').mockReturnValue(0.99);
      Object.defineProperty(window, 'location', {
        value: { hostname: 'airo-builder.godaddy.com', origin: 'https://airo-builder.godaddy.com' },
        writable: true,
      });

      const { default: RumProvider } = await import('./RumProvider');
      renderWithProviders(<RumProvider><div>child</div></RumProvider>);

      await waitFor(() => {
        expect(mockInitApm).not.toHaveBeenCalled();
      });
    });

    it('should activate when random is below activation rate', async () => {
      process.env.NEXT_PUBLIC_ELASTIC_APM_ENVIRONMENT = 'production';
      process.env.NEXT_PUBLIC_ELASTIC_APM_SERVER_URL = 'https://apm.example.com:443';
      vi.spyOn(Math, 'random').mockReturnValue(0.01);
      Object.defineProperty(window, 'location', {
        value: { hostname: 'airo-builder.godaddy.com', origin: 'https://airo-builder.godaddy.com' },
        writable: true,
      });

      const { default: RumProvider } = await import('./RumProvider');
      renderWithProviders(<RumProvider><div>child</div></RumProvider>);

      await waitFor(() => {
        expect(mockInitApm).toHaveBeenCalled();
      });
    });

    it('should fall back to rate 0 for unknown environment values', async () => {
      process.env.NEXT_PUBLIC_ELASTIC_APM_ENVIRONMENT = 'staging';
      vi.spyOn(Math, 'random').mockReturnValue(0);
      Object.defineProperty(window, 'location', {
        value: { hostname: 'localhost', origin: 'http://localhost:3000' },
        writable: true,
      });

      const { default: RumProvider } = await import('./RumProvider');
      renderWithProviders(<RumProvider><div>child</div></RumProvider>);

      await waitFor(() => {
        expect(mockInitApm).not.toHaveBeenCalled();
      });
    });
  });
});
