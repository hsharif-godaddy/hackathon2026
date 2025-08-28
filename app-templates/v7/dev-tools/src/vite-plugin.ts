import type { Plugin } from 'vite'
import { V7_CONFIG } from '../v7-config'

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
            lastImport + `\n// Auto-inject dev tools in development (v7)\nif (import.meta.env.MODE === 'development') {\n  import('${V7_CONFIG.importPath}').then(({ injectDevelopmentMode }) => {\n    injectDevelopmentMode();\n  });\n}`
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
