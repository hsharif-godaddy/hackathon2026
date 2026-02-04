import { beforeEach, describe, expect, it, vi } from 'vitest';

// We need to test the internal isValidOrigin function
// Since it's not exported, we'll test it indirectly through captureVisualContext
// by mocking the MessageEvent
// Import the module - this will allow us to spy on internal functions
import * as visualContextModule from './visualContextCapture';

describe('visualContextCapture', () => {
  describe('origin validation for preview domains', () => {
    let mockIframe: HTMLIFrameElement;
    let mockContentWindow: any;

    beforeEach(() => {
      // Create a mock iframe with contentWindow
      mockContentWindow = {
        postMessage: vi.fn(),
      };
      mockIframe = {
        id: 'preview-iframe',
        contentWindow: mockContentWindow,
        clientWidth: 1200,
        clientHeight: 800,
      } as any;

      // Mock document.getElementById to return our mock iframe
      vi.spyOn(document, 'getElementById').mockReturnValue(mockIframe);

      // Mock console methods to avoid noise in tests
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    describe('valid preview domain origins', () => {
      it('should accept test environment preview domain', async () => {
        const capturePromise = visualContextModule.captureVisualContext();

        // Simulate response from preview domain
        const responseEvent = new MessageEvent('message', {
          origin: 'https://fw1tzd36ai.preview.c4.test-airoapp.ai',
          source: mockContentWindow,
          data: {
            type: 'VISUAL_CONTEXT_RESPONSE',
            context: {
              page: '/',
              scroll_position: { x: 0, y: 0 },
              viewport: { width: 1200, height: 800 },
              timestamp: Date.now(),
            },
          },
        });

        window.dispatchEvent(responseEvent);

        const context = await capturePromise;
        expect(context).toBeDefined();
        expect(context?.page).toBe('/');
        expect(console.warn).not.toHaveBeenCalledWith(
          '[VisualContext] Message rejected: Invalid origin',
          expect.any(String)
        );
      });

      it('should accept dev environment preview domain', async () => {
        const capturePromise = visualContextModule.captureVisualContext();

        const responseEvent = new MessageEvent('message', {
          origin: 'https://abc123xyz.preview.c4.dev-airoapp.ai',
          source: mockContentWindow,
          data: {
            type: 'VISUAL_CONTEXT_RESPONSE',
            context: {
              page: '/about',
              scroll_position: { x: 0, y: 100 },
              viewport: { width: 1200, height: 800 },
              timestamp: Date.now(),
            },
          },
        });

        window.dispatchEvent(responseEvent);

        const context = await capturePromise;
        expect(context).toBeDefined();
        expect(context?.page).toBe('/about');
        expect(console.warn).not.toHaveBeenCalledWith(
          '[VisualContext] Message rejected: Invalid origin',
          expect.any(String)
        );
      });

      it('should accept production environment preview domain', async () => {
        const capturePromise = visualContextModule.captureVisualContext();

        const responseEvent = new MessageEvent('message', {
          origin: 'https://myapp123.preview.c4.airoapp.ai',
          source: mockContentWindow,
          data: {
            type: 'VISUAL_CONTEXT_RESPONSE',
            context: {
              page: '/contact',
              scroll_position: { x: 0, y: 200 },
              viewport: { width: 1200, height: 800 },
              timestamp: Date.now(),
            },
          },
        });

        window.dispatchEvent(responseEvent);

        const context = await capturePromise;
        expect(context).toBeDefined();
        expect(context?.page).toBe('/contact');
        expect(console.warn).not.toHaveBeenCalledWith(
          '[VisualContext] Message rejected: Invalid origin',
          expect.any(String)
        );
      });

      it('should accept preview domain with different cell numbers', async () => {
        const cellNumbers = ['c0', 'c1', 'c2', 'c3', 'c4', 'c9', 'c10', 'c99', 'c100'];

        for (const cell of cellNumbers) {
          const capturePromise = visualContextModule.captureVisualContext();

          const responseEvent = new MessageEvent('message', {
            origin: `https://test-app.preview.${cell}.test-airoapp.ai`,
            source: mockContentWindow,
            data: {
              type: 'VISUAL_CONTEXT_RESPONSE',
              context: {
                page: '/',
                scroll_position: { x: 0, y: 0 },
                viewport: { width: 1200, height: 800 },
                timestamp: Date.now(),
              },
            },
          });

          window.dispatchEvent(responseEvent);

          const context = await capturePromise;
          expect(context).toBeDefined();
        }
      });
    });

    describe('localhost origins', () => {
      it('should accept http://localhost with port', async () => {
        const capturePromise = visualContextModule.captureVisualContext();

        const responseEvent = new MessageEvent('message', {
          origin: 'http://localhost:5001',
          source: mockContentWindow,
          data: {
            type: 'VISUAL_CONTEXT_RESPONSE',
            context: {
              page: '/',
              scroll_position: { x: 0, y: 0 },
              viewport: { width: 1200, height: 800 },
              timestamp: Date.now(),
            },
          },
        });

        window.dispatchEvent(responseEvent);

        const context = await capturePromise;
        expect(context).toBeDefined();
      });

      it('should accept https://localhost with port', async () => {
        const capturePromise = visualContextModule.captureVisualContext();

        const responseEvent = new MessageEvent('message', {
          origin: 'https://localhost:3000',
          source: mockContentWindow,
          data: {
            type: 'VISUAL_CONTEXT_RESPONSE',
            context: {
              page: '/',
              scroll_position: { x: 0, y: 0 },
              viewport: { width: 1200, height: 800 },
              timestamp: Date.now(),
            },
          },
        });

        window.dispatchEvent(responseEvent);

        const context = await capturePromise;
        expect(context).toBeDefined();
      });

      it('should accept 127.0.0.1', async () => {
        const capturePromise = visualContextModule.captureVisualContext();

        const responseEvent = new MessageEvent('message', {
          origin: 'http://127.0.0.1',
          source: mockContentWindow,
          data: {
            type: 'VISUAL_CONTEXT_RESPONSE',
            context: {
              page: '/',
              scroll_position: { x: 0, y: 0 },
              viewport: { width: 1200, height: 800 },
              timestamp: Date.now(),
            },
          },
        });

        window.dispatchEvent(responseEvent);

        const context = await capturePromise;
        expect(context).toBeDefined();
      });
    });

    describe('invalid origins', () => {
      it('should reject non-preview subdomain', async () => {
        const capturePromise = visualContextModule.captureVisualContext();

        const responseEvent = new MessageEvent('message', {
          origin: 'https://evil-app.agent.c4.test-airoapp.ai', // agent, not preview
          source: mockContentWindow,
          data: {
            type: 'VISUAL_CONTEXT_RESPONSE',
            context: {
              page: '/',
              scroll_position: { x: 0, y: 0 },
              viewport: { width: 1200, height: 800 },
              timestamp: Date.now(),
            },
          },
        });

        window.dispatchEvent(responseEvent);

        await capturePromise;

        expect(console.warn).toHaveBeenCalledWith(
          '[VisualContext] Message rejected: Invalid origin',
          'https://evil-app.agent.c4.test-airoapp.ai'
        );
      });

      it('should reject lookalike domain', async () => {
        const capturePromise = visualContextModule.captureVisualContext();

        const responseEvent = new MessageEvent('message', {
          origin: 'https://abc.preview.c4.airoapp-ai.com', // airoapp-ai.com, not airoapp.ai
          source: mockContentWindow,
          data: {
            type: 'VISUAL_CONTEXT_RESPONSE',
            context: {
              page: '/',
              scroll_position: { x: 0, y: 0 },
              viewport: { width: 1200, height: 800 },
              timestamp: Date.now(),
            },
          },
        });

        window.dispatchEvent(responseEvent);

        await capturePromise;

        expect(console.warn).toHaveBeenCalledWith(
          '[VisualContext] Message rejected: Invalid origin',
          'https://abc.preview.c4.airoapp-ai.com'
        );
      });

      it('should reject domain suffix attack', async () => {
        const capturePromise = visualContextModule.captureVisualContext();

        const responseEvent = new MessageEvent('message', {
          origin: 'https://abc.preview.c4.test-airoapp.ai.evil.com',
          source: mockContentWindow,
          data: {
            type: 'VISUAL_CONTEXT_RESPONSE',
            context: {
              page: '/',
              scroll_position: { x: 0, y: 0 },
              viewport: { width: 1200, height: 800 },
              timestamp: Date.now(),
            },
          },
        });

        window.dispatchEvent(responseEvent);

        await capturePromise;

        expect(console.warn).toHaveBeenCalledWith(
          '[VisualContext] Message rejected: Invalid origin',
          'https://abc.preview.c4.test-airoapp.ai.evil.com'
        );
      });

      it('should reject http (non-https) preview domain', async () => {
        const capturePromise = visualContextModule.captureVisualContext();

        const responseEvent = new MessageEvent('message', {
          origin: 'http://abc.preview.c4.test-airoapp.ai', // http, not https
          source: mockContentWindow,
          data: {
            type: 'VISUAL_CONTEXT_RESPONSE',
            context: {
              page: '/',
              scroll_position: { x: 0, y: 0 },
              viewport: { width: 1200, height: 800 },
              timestamp: Date.now(),
            },
          },
        });

        window.dispatchEvent(responseEvent);

        await capturePromise;

        expect(console.warn).toHaveBeenCalledWith(
          '[VisualContext] Message rejected: Invalid origin',
          'http://abc.preview.c4.test-airoapp.ai'
        );
      });

      it('should reject missing cell number', async () => {
        const capturePromise = visualContextModule.captureVisualContext();

        const responseEvent = new MessageEvent('message', {
          origin: 'https://abc.preview.test-airoapp.ai', // missing c4
          source: mockContentWindow,
          data: {
            type: 'VISUAL_CONTEXT_RESPONSE',
            context: {
              page: '/',
              scroll_position: { x: 0, y: 0 },
              viewport: { width: 1200, height: 800 },
              timestamp: Date.now(),
            },
          },
        });

        window.dispatchEvent(responseEvent);

        await capturePromise;

        expect(console.warn).toHaveBeenCalledWith(
          '[VisualContext] Message rejected: Invalid origin',
          'https://abc.preview.test-airoapp.ai'
        );
      });

      it('should reject arbitrary environment prefix', async () => {
        const capturePromise = visualContextModule.captureVisualContext();

        const responseEvent = new MessageEvent('message', {
          origin: 'https://abc.preview.c4.evil-airoapp.ai', // evil- not allowed
          source: mockContentWindow,
          data: {
            type: 'VISUAL_CONTEXT_RESPONSE',
            context: {
              page: '/',
              scroll_position: { x: 0, y: 0 },
              viewport: { width: 1200, height: 800 },
              timestamp: Date.now(),
            },
          },
        });

        window.dispatchEvent(responseEvent);

        await capturePromise;

        expect(console.warn).toHaveBeenCalledWith(
          '[VisualContext] Message rejected: Invalid origin',
          'https://abc.preview.c4.evil-airoapp.ai'
        );
      });

      it('should reject completely unrelated domain', async () => {
        const capturePromise = visualContextModule.captureVisualContext();

        const responseEvent = new MessageEvent('message', {
          origin: 'https://evil.com',
          source: mockContentWindow,
          data: {
            type: 'VISUAL_CONTEXT_RESPONSE',
            context: {
              page: '/',
              scroll_position: { x: 0, y: 0 },
              viewport: { width: 1200, height: 800 },
              timestamp: Date.now(),
            },
          },
        });

        window.dispatchEvent(responseEvent);

        await capturePromise;

        expect(console.warn).toHaveBeenCalledWith(
          '[VisualContext] Message rejected: Invalid origin',
          'https://evil.com'
        );
      });
    });

    describe('edge cases', () => {
      it('should handle timeout when no response is received', async () => {
        const context = await visualContextModule.captureVisualContext();

        // Should return fallback context after timeout
        expect(context).toBeDefined();
        expect(context?.active_section).toBe('dev-tools-initializing');
        expect(console.warn).toHaveBeenCalledWith(
          '[VisualContext] Timeout: No response from iframe after 500ms - check VITE_PARENT_ORIGIN is set correctly'
        );
      });

      it('should ignore messages from wrong source', async () => {
        const capturePromise = visualContextModule.captureVisualContext();

        // Create a different window object
        const wrongSource = { postMessage: vi.fn() };

        const responseEvent = new MessageEvent('message', {
          origin: 'https://abc.preview.c4.test-airoapp.ai',
          source: wrongSource as any, // Wrong source
          data: {
            type: 'VISUAL_CONTEXT_RESPONSE',
            context: {
              page: '/',
              scroll_position: { x: 0, y: 0 },
              viewport: { width: 1200, height: 800 },
              timestamp: Date.now(),
            },
          },
        });

        window.dispatchEvent(responseEvent);

        // Should timeout because message is ignored
        const context = await capturePromise;
        expect(context?.active_section).toBe('dev-tools-initializing');
      });

      it('should handle same origin correctly', async () => {
        const capturePromise = visualContextModule.captureVisualContext();

        const responseEvent = new MessageEvent('message', {
          origin: window.location.origin,
          source: mockContentWindow,
          data: {
            type: 'VISUAL_CONTEXT_RESPONSE',
            context: {
              page: '/',
              scroll_position: { x: 0, y: 0 },
              viewport: { width: 1200, height: 800 },
              timestamp: Date.now(),
            },
          },
        });

        window.dispatchEvent(responseEvent);

        const context = await capturePromise;
        expect(context).toBeDefined();
        expect(context?.page).toBe('/');
      });
    });
  });
});
