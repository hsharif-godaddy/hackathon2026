// Main exports for the dev tools package
export { default as DevelopmentMode } from './components/DevelopmentMode'
export { default as DevToolsProvider } from './DevToolsProvider'

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

export function injectPreviewHeader() {
  if (import.meta.env.MODE !== 'development' && !import.meta.env.VITE_PREVIEW_MODE) return
  if (typeof window === 'undefined') return
  if (!new URLSearchParams(window.location.search).has('airoPreview')) return
  if (document.getElementById('airo-preview-header')) return

  const inject = () => {
    const container = document.createElement('div')
    container.id = 'airo-preview-header'
    container.style.position = 'relative'
    container.style.top = 'auto'
    container.style.left = 'auto'
    container.style.right = 'auto'
    container.style.zIndex = 'auto'
    container.style.width = '100%'
    container.style.display = 'block'
    container.style.height = '40px'
    document.body.prepend(container)

    Promise.all([
      import('react'),
      import('react-dom/client'),
      import('./components/PreviewHeader')
    ]).then(([React, ReactDOM, { default: PreviewHeader }]) => {
      const root = ReactDOM.createRoot(container)
      root.render(React.createElement(PreviewHeader))
      requestAnimationFrame(() => {
        // Style inner element
        const inner = container.firstElementChild as HTMLElement
        if (inner) {
          inner.style.position = 'relative'
          inner.style.width = '100%'
          inner.style.height = '40px'
        }

        // Make header fixed at top
        container.style.position = 'fixed'
        container.style.top = '0'
        container.style.left = '0'
        container.style.right = '0'
        container.style.zIndex = '999999'
        container.style.transition = 'transform 0.2s ease'

        // Push body content down
        document.body.style.paddingTop = '40px'

        // Find and offset any fixed top:0 elements inside the site
        const siteFixedEls: HTMLElement[] = []
        document.querySelectorAll('#app *').forEach(el => {
          if (el instanceof HTMLElement) {
            const style = getComputedStyle(el)
            if (style.position === 'fixed' && style.top === '0px') {
              el.style.top = '40px'
              el.style.transition = 'top 0.2s ease'
              siteFixedEls.push(el)
            }
          }
        })

        // Hide header on scroll, show at top
        let lastScroll = 0
        const handleScroll = () => {
          const currentScroll = window.scrollY
          if (currentScroll <= 0) {
            container.style.transform = 'translateY(0)'
            siteFixedEls.forEach(el => el.style.top = '40px')
          } else if (currentScroll > lastScroll) {
            container.style.transform = 'translateY(-100%)'
            siteFixedEls.forEach(el => el.style.top = '0px')
          }
          lastScroll = currentScroll
        }
        window.addEventListener('scroll', handleScroll, { passive: true })

        window.scrollTo({ top: 0, behavior: 'instant' })
      })
    }).catch(error => {
      console.error('❌ Failed to inject preview header:', error)
    })
  }

  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', inject)
    : inject()
}

// Auto-inject on import in development
if (typeof window !== 'undefined') {
  // Use a small delay to ensure DOM is ready
  setTimeout(injectDevelopmentMode, 100)
  injectPreviewHeader()
}
