import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTargetOrigin, isOriginAllowed, postMessageToIframe } from './postMessage';

// Mock the logger
vi.mock('@/lib/request-context', () => ({
  logger: {
    warn: vi.fn(),
  },
}));

// Import the mocked logger
import { logger } from '@/lib/request-context';

describe('postMessage utilities', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset environment before each test
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
  });

  describe('getTargetOrigin', () => {
    it('should return configured origin when NEXT_PUBLIC_IFRAME_ORIGIN is set', () => {
      process.env.NEXT_PUBLIC_IFRAME_ORIGIN = 'https://app.example.com';
      expect(getTargetOrigin()).toBe('https://app.example.com');
    });

    it('should return wildcard when NEXT_PUBLIC_IFRAME_ORIGIN is not set', () => {
      delete process.env.NEXT_PUBLIC_IFRAME_ORIGIN;
      expect(getTargetOrigin()).toBe('*');
    });

    it('should log warning when using wildcard', () => {
      delete process.env.NEXT_PUBLIC_IFRAME_ORIGIN;
      getTargetOrigin();
      expect(logger.warn).toHaveBeenCalledWith(
        'post-message.no-origin-configured',
        expect.objectContaining({
          message: expect.stringContaining('security risk'),
        })
      );
    });

    it('should not log warning when origin is configured', () => {
      process.env.NEXT_PUBLIC_IFRAME_ORIGIN = 'https://app.example.com';
      getTargetOrigin();
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('should handle empty string as wildcard', () => {
      process.env.NEXT_PUBLIC_IFRAME_ORIGIN = '';
      const result = getTargetOrigin();
      // Empty string is falsy in the check, so it returns wildcard
      expect(result).toBe('*');
    });
  });

  describe('isOriginAllowed', () => {
    describe('with configured origin', () => {
      beforeEach(() => {
        process.env.NEXT_PUBLIC_IFRAME_ORIGIN = 'https://app.example.com';
      });

      it('should allow matching origin', () => {
        const event = { origin: 'https://app.example.com' } as MessageEvent;
        expect(isOriginAllowed(event)).toBe(true);
      });

      it('should reject non-matching origin', () => {
        const event = { origin: 'https://evil.com' } as MessageEvent;
        expect(isOriginAllowed(event)).toBe(false);
      });

      it('should reject subdomain when exact match configured', () => {
        const event = { origin: 'https://subdomain.app.example.com' } as MessageEvent;
        expect(isOriginAllowed(event)).toBe(false);
      });

      it('should reject localhost when production origin configured', () => {
        const event = { origin: 'http://localhost:3000' } as MessageEvent;
        expect(isOriginAllowed(event)).toBe(false);
      });
    });

    describe('without configured origin (development mode)', () => {
      beforeEach(() => {
        delete process.env.NEXT_PUBLIC_IFRAME_ORIGIN;
      });

      it('should allow localhost', () => {
        const event = { origin: 'http://localhost:3000' } as MessageEvent;
        expect(isOriginAllowed(event)).toBe(true);
      });

      it('should allow localhost with different port', () => {
        const event = { origin: 'http://localhost:8080' } as MessageEvent;
        expect(isOriginAllowed(event)).toBe(true);
      });

      it('should allow 127.0.0.1', () => {
        const event = { origin: 'http://127.0.0.1:3000' } as MessageEvent;
        expect(isOriginAllowed(event)).toBe(true);
      });

      it('should allow airoapp.ai domain', () => {
        const event = { origin: 'https://airoapp.ai' } as MessageEvent;
        expect(isOriginAllowed(event)).toBe(true);
      });

      it('should allow airoapp.ai subdomains', () => {
        const event = { origin: 'https://app.airoapp.ai' } as MessageEvent;
        expect(isOriginAllowed(event)).toBe(true);
      });

      it('should allow deeply nested airoapp.ai subdomains', () => {
        const event = { origin: 'https://api.staging.airoapp.ai' } as MessageEvent;
        expect(isOriginAllowed(event)).toBe(true);
      });

      it('should reject non-localhost, non-airoapp.ai domains', () => {
        const event = { origin: 'https://evil.com' } as MessageEvent;
        expect(isOriginAllowed(event)).toBe(false);
      });

      it('should reject domains that contain but do not end with airoapp.ai', () => {
        const event = { origin: 'https://airoapp.ai.evil.com' } as MessageEvent;
        expect(isOriginAllowed(event)).toBe(false);
      });

      it('should handle invalid origin URLs', () => {
        const event = { origin: 'not-a-valid-url' } as MessageEvent;
        expect(isOriginAllowed(event)).toBe(false);
      });

      it('should handle empty origin', () => {
        const event = { origin: '' } as MessageEvent;
        expect(isOriginAllowed(event)).toBe(false);
      });
    });

    describe('with wildcard origin configured', () => {
      beforeEach(() => {
        process.env.NEXT_PUBLIC_IFRAME_ORIGIN = '*';
      });

      it('should allow localhost', () => {
        const event = { origin: 'http://localhost:3000' } as MessageEvent;
        expect(isOriginAllowed(event)).toBe(true);
      });

      it('should allow airoapp.ai domains', () => {
        const event = { origin: 'https://app.airoapp.ai' } as MessageEvent;
        expect(isOriginAllowed(event)).toBe(true);
      });

      it('should reject non-whitelisted domains', () => {
        const event = { origin: 'https://evil.com' } as MessageEvent;
        expect(isOriginAllowed(event)).toBe(false);
      });
    });
  });

  describe('postMessageToIframe', () => {
    let mockIframe: HTMLIFrameElement;
    let mockContentWindow: { postMessage: ReturnType<typeof vi.fn> };

    beforeEach(() => {
      mockContentWindow = {
        postMessage: vi.fn(),
      };
      mockIframe = {
        contentWindow: mockContentWindow as any,
      } as HTMLIFrameElement;
      process.env.NEXT_PUBLIC_IFRAME_ORIGIN = 'https://app.example.com';
    });

    it('should send message to iframe with configured origin', () => {
      const message = { type: 'test', data: 'hello' };
      postMessageToIframe(mockIframe, message);

      expect(mockContentWindow.postMessage).toHaveBeenCalledWith(
        message,
        'https://app.example.com'
      );
    });

    it('should send message with wildcard when origin not configured', () => {
      delete process.env.NEXT_PUBLIC_IFRAME_ORIGIN;
      const message = { type: 'test', data: 'hello' };
      postMessageToIframe(mockIframe, message);

      expect(mockContentWindow.postMessage).toHaveBeenCalledWith(message, '*');
    });

    it('should handle null contentWindow', () => {
      Object.defineProperty(mockIframe, 'contentWindow', {
        value: null,
        writable: true,
        configurable: true
      });
      const message = { type: 'test' };

      postMessageToIframe(mockIframe, message);

      expect(mockContentWindow.postMessage).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        'post-message.no-content-window',
        expect.objectContaining({
          message: expect.stringContaining('contentWindow not available'),
        })
      );
    });

    it('should handle undefined contentWindow', () => {
      Object.defineProperty(mockIframe, 'contentWindow', {
        value: undefined,
        writable: true,
        configurable: true
      });
      const message = { type: 'test' };

      postMessageToIframe(mockIframe, message);

      expect(mockContentWindow.postMessage).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalled();
    });

    it('should send complex message objects', () => {
      const message = {
        type: 'complex',
        data: {
          nested: true,
          array: [1, 2, 3],
          value: 'test',
        },
      };
      postMessageToIframe(mockIframe, message);

      expect(mockContentWindow.postMessage).toHaveBeenCalledWith(
        message,
        'https://app.example.com'
      );
    });

    it('should send string messages', () => {
      const message = 'simple string message';
      postMessageToIframe(mockIframe, message);

      expect(mockContentWindow.postMessage).toHaveBeenCalledWith(
        message,
        'https://app.example.com'
      );
    });

    it('should send null messages', () => {
      postMessageToIframe(mockIframe, null);

      expect(mockContentWindow.postMessage).toHaveBeenCalledWith(
        null,
        'https://app.example.com'
      );
    });

    describe('local dev iframe-src origin override', () => {
      const originalNodeEnv = process.env.NODE_ENV;

      beforeEach(() => {
        delete process.env.NEXT_PUBLIC_IFRAME_ORIGIN;
        process.env.NODE_ENV = 'development';
      });

      afterEach(() => {
        process.env.NODE_ENV = originalNodeEnv;
      });

      it('targets the iframe.src origin instead of wildcard in dev', () => {
        const iframe = {
          contentWindow: mockContentWindow as any,
          src: 'https://local.gasket.dev-godaddy.com:5001/preview',
        } as HTMLIFrameElement;

        postMessageToIframe(iframe, { type: 'ping' });

        expect(mockContentWindow.postMessage).toHaveBeenCalledWith(
          { type: 'ping' },
          'https://local.gasket.dev-godaddy.com:5001'
        );
        expect(logger.warn).not.toHaveBeenCalled();
      });

      it('strips path and query from iframe.src', () => {
        const iframe = {
          contentWindow: mockContentWindow as any,
          src: 'http://localhost:5002/some/path?token=abc',
        } as HTMLIFrameElement;

        postMessageToIframe(iframe, { type: 'ping' });

        expect(mockContentWindow.postMessage).toHaveBeenCalledWith(
          { type: 'ping' },
          'http://localhost:5002'
        );
      });

      it('falls back to wildcard when iframe has no src', () => {
        const iframe = {
          contentWindow: mockContentWindow as any,
          src: '',
        } as HTMLIFrameElement;

        postMessageToIframe(iframe, { type: 'ping' });

        expect(mockContentWindow.postMessage).toHaveBeenCalledWith({ type: 'ping' }, '*');
        expect(logger.warn).toHaveBeenCalledWith(
          'post-message.no-origin-configured',
          expect.any(Object),
        );
      });

      it('falls back to wildcard when iframe.src is unparseable', () => {
        const iframe = {
          contentWindow: mockContentWindow as any,
          src: 'not a url',
        } as HTMLIFrameElement;

        postMessageToIframe(iframe, { type: 'ping' });

        expect(mockContentWindow.postMessage).toHaveBeenCalledWith({ type: 'ping' }, '*');
        expect(logger.warn).toHaveBeenCalled();
      });

      it('does not override origin outside development', () => {
        process.env.NODE_ENV = 'production';
        const iframe = {
          contentWindow: mockContentWindow as any,
          src: 'https://local.gasket.dev-godaddy.com:5001/preview',
        } as HTMLIFrameElement;

        postMessageToIframe(iframe, { type: 'ping' });

        expect(mockContentWindow.postMessage).toHaveBeenCalledWith({ type: 'ping' }, '*');
        expect(logger.warn).toHaveBeenCalled();
      });
    });
  });

  describe('integration scenarios', () => {
    it('should use consistent origin between getTargetOrigin and postMessageToIframe', () => {
      process.env.NEXT_PUBLIC_IFRAME_ORIGIN = 'https://secure.example.com';

      const origin = getTargetOrigin();
      const mockContentWindow = { postMessage: vi.fn() };
      const mockIframe = {
        contentWindow: mockContentWindow as any,
      } as HTMLIFrameElement;

      postMessageToIframe(mockIframe, { test: true });

      expect(mockContentWindow.postMessage).toHaveBeenCalledWith(
        { test: true },
        origin
      );
    });

    it('should handle development environment correctly', () => {
      delete process.env.NEXT_PUBLIC_IFRAME_ORIGIN;

      const localhostEvent = { origin: 'http://localhost:3000' } as MessageEvent;
      const prodEvent = { origin: 'https://app.example.com' } as MessageEvent;

      expect(isOriginAllowed(localhostEvent)).toBe(true);
      expect(isOriginAllowed(prodEvent)).toBe(false);
      expect(getTargetOrigin()).toBe('*');
    });
  });
});
