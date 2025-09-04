import type { Plugin } from 'vite'
import { V7_CONFIG } from './v7-config'

/**
 * V7-specific override for the vite plugin
 * This file contains the v7-specific import path and entry point configuration
 */
export function createV7VitePlugin(basePlugin: () => Plugin): Plugin {
  const plugin = basePlugin()
  
  return {
    ...plugin,
    transform(code, id) {
      // Use v7-specific entry points and import path
      if (V7_CONFIG.entryPoints.some(entry => id.includes(entry))) {
        console.log('🔧 Injecting dev tools initialization into v7 entry point...')
        
        let result = code
        
        // Find the last import statement
        const importRegex = /import.*from.*['"];?\s*$/gm
        const imports = code.match(importRegex)
        
        if (imports && imports.length > 0) {
          const lastImport = imports[imports.length - 1]
          result = result.replace(
            lastImport,
            lastImport + `\n// Auto-inject dev tools in development (v7 config)\nif (import.meta.env.MODE === 'development') {\n  import('${V7_CONFIG.importPath}').then(({ injectDevelopmentMode }) => {\n    injectDevelopmentMode();\n  });\n}`
          )
        }
        
        console.log('✅ Dev tools auto-injection added to v7 entry point')
        return result
      }
      
      return null
    }
  }
}