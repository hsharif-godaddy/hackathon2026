// Main exports for the dev tools package
export { default as DevelopmentMode } from './components/DevelopmentMode'
export { default as ElementEditor } from './components/ElementEditor'
export { default as DevToolsProvider } from './DevToolsProvider'
export { useDevelopmentMode } from './hooks/useDevelopmentMode'

// Types
export type { RuntimeErrorData, ErrorFixRequestMessage } from './types'

// Vite plugin for auto-injection
export { devToolsPlugin } from './vite-plugin'

// FullStory injector for development tracking
export { injectFullStory } from './fullstory-injector'

// Development mode injector - only works in development
export function injectDevelopmentMode() {
  // Only inject in development environment
  if (import.meta.env.MODE !== 'development') {
    return
  }

  // Check if already injected
  if (document.getElementById('airo-dev-tools-injected')) {
    return
  }

  console.log('🎨 Airo Dev Tools activated! Injecting floating dev tools...')

  // Wait for DOM to be ready
  const inject = () => {
    // Create container for dev tools
    const container = document.createElement('div')
    container.id = 'airo-dev-tools-injected'
    container.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: 2147483647;
    `
    document.body.appendChild(container)

    // Dynamically import React and render dev tools
    Promise.all([
      import('react'),
      import('react-dom/client'),
      import('./components/DevelopmentMode')
    ]).then(([React, ReactDOM, DevelopmentModeModule]) => {
      const root = ReactDOM.createRoot(container)

      // Create dev tools component
      const DevelopmentModeComponent = DevelopmentModeModule.default
      const DevToolsComponent = React.createElement(DevelopmentModeComponent)

      root.render(DevToolsComponent)
      console.log('✅ Dev tools successfully injected into DOM')
    }).catch(error => {
      console.error('❌ Failed to inject dev tools:', error)
    })
  }

  // Inject immediately if DOM is ready, otherwise wait
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inject)
  } else {
    inject()
  }
}

// Auto-inject on import in development
if (typeof window !== 'undefined') {
  // Use a small delay to ensure DOM is ready
  setTimeout(injectDevelopmentMode, 100)
}
