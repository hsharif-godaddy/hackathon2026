import type { Plugin } from 'vite'

/**
 * Vite plugin to inject development tools only in development mode
 * This ensures the dev tools are never included in production builds
 */
export function devToolsInjectorPlugin(): Plugin {
  return {
    name: 'dev-tools-injector',
    apply: 'serve', // Only apply in development mode
    enforce: 'pre', // Run before other plugins
    transform(code, id) {
      // Inject into the main entry point instead of App.tsx
      if (id.includes('src/main.tsx') || id.includes('src/index.tsx') || id.includes('entry-client.tsx')) {
        console.log('🔧 Injecting dev tools initialization into entry point...')
        
        // Add dev tools import and initialization after React import
        let result = code
        
        // Find the last import statement
        const importRegex = /import.*from.*['"];?\s*$/gm
        const imports = code.match(importRegex)
        
        if (imports && imports.length > 0) {
          const lastImport = imports[imports.length - 1]
          result = result.replace(
            lastImport,
            lastImport + `\n// Auto-inject dev tools in development\nif (import.meta.env.MODE === 'development') {\n  import('../../dev-tools/src/index').then(({ injectDevelopmentMode }) => {\n    injectDevelopmentMode();\n  });\n}`
          )
        }
        
        console.log('✅ Dev tools auto-injection added to entry point')
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
