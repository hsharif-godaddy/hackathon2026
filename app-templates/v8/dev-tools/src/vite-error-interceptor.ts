import { Plugin } from 'vite';

interface ErrorData {
  message: string;
  stack?: string;
  loc?: {
    file: string;
    line?: number;
    column?: number;
  };
  frame?: string;
}

/**
 * Vite plugin that intercepts build and compilation errors 
 * and makes them available to the client-side error handling system
 */
export function errorInterceptorPlugin(): Plugin {
  return {
    name: 'error-interceptor',
    
    // Handle build errors during development
    buildStart() {
      if (this.meta.watchMode) {
        this.addWatchFile('virtual:error-state');
      }
    },

    transform(_code: string, id: string) {
      try {
        return null;
      } catch (error: any) {
        const errorData: ErrorData = {
          message: error.message || 'Transform failed',
          stack: error.stack,
          loc: {
            file: id,
            line: error.loc?.line,
            column: error.loc?.column
          }
        };

        if (this.meta.watchMode) {
          this.emitFile({
            type: 'asset',
            fileName: 'compile-error.json',
            source: JSON.stringify(errorData)
          });
        }

        throw error; // Re-throw to maintain normal error flow
      }
    },

    configureServer(server) {
      server.ws.on('vite:error', (data) => {
        console.error('Build error intercepted:', data);
      });

      const originalPrintUrls = server.printUrls;
      server.printUrls = function() {
        originalPrintUrls.call(this);
      };

      const originalSsrLoadModule = server.ssrLoadModule;
      server.ssrLoadModule = async function(url, opts) {
        try {
          return await originalSsrLoadModule.call(this, url, opts);
        } catch (error: any) {
          server.ws.send('compile-error', {
            type: 'error',
            err: {
              message: error.message,
              stack: error.stack,
              loc: error.loc,
              frame: error.frame
            }
          });
          throw error;
        }
      };
    },

    resolveId(id: string) {
      if (id === 'virtual:error-state') {
        return id;
      }
      return null;
    },

    load(id: string) {
      if (id === 'virtual:error-state') {
        return `
          let currentError = null;
          let errorHandlers = [];
          
          export function setError(error) {
            currentError = error;
            errorHandlers.forEach(handler => handler(error));
          }
          
          export function getError() {
            return currentError;
          }
          
          export function clearError() {
            currentError = null;
          }
          
          export function onError(handler) {
            errorHandlers.push(handler);
            return () => {
              errorHandlers = errorHandlers.filter(h => h !== handler);
            };
          }
          
          // Listen for HMR errors
          if (import.meta.hot) {
            import.meta.hot.on('compile-error', (data) => {
              setError(data.err);
            });
          }
        `;
      }
      return null;
    }
  };
}
