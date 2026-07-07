import type { Plugin } from 'vite'
import { V7_CONFIG } from '../v7-config'

const STATIC_MAIN_ENTRY_RE =
  /<script\b(?=[^>]*\btype=["']module["'])(?=[^>]*\bsrc=["']\/src\/main\.tsx["'])[^>]*>\s*<\/script>/i;
const DEV_RETRY_MAIN_ENTRY = `<script type="module">
      await import('/dev-tools/src/error-client.ts')
      let mainLoaded = false
      import('/src/main.tsx').then(() => { mainLoaded = true }).catch(err => {
        // Vite dep optimization can cause transient import failures that resolve
        // in 1-3s. Retry once before reporting the error to avoid false positives.
        setTimeout(() => {
          if (mainLoaded) return
          import('/src/main.tsx').then(() => { mainLoaded = true }).catch(retryErr => {
            window.dispatchEvent(new CustomEvent('vite:initial-error', { detail: retryErr }));
          });
        }, 2000);
      })
    </script>`;

/**
 * Vite plugin to inject development tools only in development mode
 * This ensures the dev tools are never included in production builds
 * 
 * V7 version: Uses v7-specific configuration for import paths and entry points
 */
export function devToolsInjectorPlugin(): Plugin {
  return {
    name: 'dev-tools-injector',
    apply: 'serve', // Only apply in development mode
    enforce: 'pre', // Run before other plugins
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        return html.replace(STATIC_MAIN_ENTRY_RE, DEV_RETRY_MAIN_ENTRY)
      }
    },
    transform(code, id) {
      // Use v7-specific entry points
      const isEntryPoint = V7_CONFIG.entryPoints.some(entry => id.includes(entry)) ||
                          (V7_CONFIG.hasEntryClient && id.includes('entry-client.tsx'))
      
      if (isEntryPoint) {
        console.log('🔧 Injecting dev tools initialization into v7 entry point...')
        
        // Add dev tools import and initialization after React import
        let result = code
        
        // Find the last import statement
        const importRegex = /import.*from.*['"];?\s*$/gm
        const imports = code.match(importRegex)
        
        if (imports && imports.length > 0) {
          const lastImport = imports[imports.length - 1]
          result = result.replace(
            lastImport,
            lastImport + `\nif (import.meta.env.MODE === 'development') {\n  await import('../dev-tools/src/utils/edit-mode-timer-pause');\n}\n// Auto-inject dev tools in development (v7)\nif (import.meta.env.MODE === 'development') {\n  import('${V7_CONFIG.importPath}').then(({ injectDevelopmentMode }) => {\n    injectDevelopmentMode();\n  });\n}`
          )
        }
        
        console.log('✅ Dev tools auto-injection added to v7 entry point')
        return result
      }
      
      return null
    }
  }
}

/**
 * Dev tools injection plugin only - source mapper should be imported separately
 */
export function devToolsPlugin(): Plugin {
  return devToolsInjectorPlugin()
}
