import { useDevelopmentMode } from '../hooks/useDevelopmentMode'
import { useState, useEffect } from 'react'
import ElementEditor from './ElementEditor'
import { safePostMessage, isOriginAllowed } from '../utils/postMessage'
import { captureAndResizeScreenshot } from '../utils/screenshot'

export default function DevelopmentMode() {
  const {
    isEnabled,
    isSelectMode,
    selectedElement,
    showEditor,
    editorPosition,
    isInlineEditing,
    clearSelection,
    toggleSelectMode,
    isTextEditable,
    startInlineEditing,
    stopInlineEditing,
    cancelInlineEditing
  } = useDevelopmentMode()

  // State to control indicator visibility on hover
  const [isIndicatorHovered, setIsIndicatorHovered] = useState(false)

  // Check if floating button should be visible via environment variable
  const showFloatingButton = import.meta.env.VITE_SHOW_DEV_TOOLS === 'true'

  // Visual context capture for AI assistance
  useEffect(() => {
    let activeSection = 'unknown'
    let sectionsObserver: IntersectionObserver | null = null
    let isScriptReady = false

    // Set up intersection observer for section detection
    function setupSectionObserver() {
      try {
        // Use compound selector for efficient single DOM query
        const compoundSelector = [
          '[data-section]', 'section[id]', 'main > div[id]', 'main > section',
          '.section', 'header', 'nav', 'main', 'aside', 'footer',
          '[class*="section"]', '[class*="hero"]', '[class*="about"]',
          '[class*="contact"]', '[class*="education"]', '[class*="experience"]'
        ].join(', ')

        // Single query with compound selector to reduce DOM traversal
        const sections = Array.from(new Set(document.querySelectorAll(compoundSelector)))

        if (sections.length === 0) {
          activeSection = 'main-content'
          isScriptReady = true
          return
        }

        sectionsObserver = new IntersectionObserver((entries) => {
          let bestMatch: Element | null = null
          let bestRatio = 0

          entries.forEach(entry => {
            if (entry.isIntersecting && entry.intersectionRatio > bestRatio) {
              bestRatio = entry.intersectionRatio
              bestMatch = entry.target
            }
          })

          if (bestMatch && bestRatio > 0.3) {
            const element = bestMatch as HTMLElement
            const sectionName =
              element.getAttribute('data-section') ||
              element.getAttribute('id') ||
              element.className.split(' ').find((c: string) =>
                c.includes('section') || c.includes('hero') || c.includes('about') ||
                c.includes('contact') || c.includes('education') || c.includes('experience')
              ) ||
              element.tagName.toLowerCase()

            if (sectionName && sectionName !== activeSection) {
              activeSection = sectionName
            }
          }
        }, {
          threshold: [0, 0.1, 0.3, 0.5, 0.7, 1],
          rootMargin: '-10% 0px -10% 0px'
        })

        sections.forEach(section => sectionsObserver?.observe(section))
        isScriptReady = true

      } catch (error) {
        activeSection = 'content'
        isScriptReady = true
      }
    }

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', setupSectionObserver)
    } else {
      setupSectionObserver()
    }

    // Listen for visual context requests from parent window
    const handleMessage = (event: MessageEvent) => {
      try {
        // Validate origin for security
        if (!isOriginAllowed(event)) {
          return
        }

        if (event.data && event.data.type === 'RESTORE_SCROLL_POSITION') {
          if (event.data.scrollPosition) {
            try {
              window.scrollTo(event.data.scrollPosition.x, event.data.scrollPosition.y)
            } catch (error) {
              console.error('Failed to restore scroll position:', error)
            }
          }
        } else if (event.data && event.data.type === 'RESTORE_STATE_AFTER_REFRESH') {
          // Restore URL/navigation first
          if (event.data.url) {
            const currentPath = window.location.pathname + window.location.search
            if (currentPath !== event.data.url) {
              try {
                // Use history API to navigate without full page reload
                window.history.pushState(null, '', event.data.url)

                // Dispatch a popstate event to notify React Router of the navigation
                const popStateEvent = new PopStateEvent('popstate', { state: null })
                window.dispatchEvent(popStateEvent)
              } catch (error) {
                console.error('Failed to restore URL:', error)
              }
            }
          }

          // Then restore scroll position after a delay to ensure page has updated
          if (event.data.scrollPosition) {
            setTimeout(() => {
              try {
                window.scrollTo(event.data.scrollPosition.x, event.data.scrollPosition.y)
              } catch (error) {
                console.error('Failed to restore scroll position:', error)
              }
            }, 100)
          }
        } else if (event.data && event.data.type === 'REQUEST_VISUAL_CONTEXT') {
          const context = {
            page: window.location.pathname + window.location.search,
            scroll_position: {
              x: window.scrollX || window.pageXOffset || 0,
              y: window.scrollY || window.pageYOffset || 0
            },
            active_section: activeSection,
            viewport: {
              width: window.innerWidth,
              height: window.innerHeight
            },
            timestamp: Date.now(),
            script_ready: isScriptReady
          }

          // Send response back to parent
          if (window.parent !== window) {
            safePostMessage(window.parent, {
              type: 'VISUAL_CONTEXT_RESPONSE',
              context: context
            })
          }
        } else if (event.data && event.data.type === 'REQUEST_SCREENSHOT') {
          // Capture and resize screenshot
          captureAndResizeScreenshot().then(screenshot => {
            if (screenshot && window.parent !== window) {
              safePostMessage(window.parent, {
                type: 'SCREENSHOT_RESPONSE',
                screenshot: screenshot
              })
            }
          }).catch((error) => {
            console.error('Screenshot: Error capturing:', error)
          })
        }
      } catch (error) {

        // Send error response
        if (window.parent !== window) {
          safePostMessage(window.parent, {
            type: 'VISUAL_CONTEXT_RESPONSE',
            context: {
              page: '/',
              scroll_position: { x: 0, y: 0 },
              active_section: 'error',
              viewport: { width: 0, height: 0 },
              timestamp: Date.now(),
              error: error instanceof Error ? error.message : 'Unknown error'
            }
          })
        }
      }
    }

    window.addEventListener('message', handleMessage)

    // Notify parent that iframe is ready for state restoration
    if (window.parent !== window) {
      safePostMessage(window.parent, {
        type: 'IFRAME_READY'
      })
    }

    return () => {
      if (sectionsObserver) {
        sectionsObserver.disconnect()
      }
      window.removeEventListener('message', handleMessage)
    }
  }, [])

  if (!isEnabled) {
    return null
  }

  return (
    <>
      {/* Development Mode Floating Button - Only show if environment variable is set */}
      {showFloatingButton && (
        <button
        data-dev-tools="floating-button"
        className="fixed bottom-10 left-10 w-7.5 h-7.5 rounded-full bg-intents-ux-boxLowContrast-backgroundColor backdrop-blur-10px text-white p-1.5 font-semibold text-sm z-999999 box-shadow-md border transition-opacity duration-200 cursor-pointer"
        style={{
          background: isSelectMode
            ? 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)'
            : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        }}
        onClick={() => {
          toggleSelectMode()
        }}
        onMouseOver={(e) => {
          e.currentTarget.style.transform = 'scale(1.1)'
        }}
        onMouseOut={(e) => {
          e.currentTarget.style.transform = 'scale(1)'
        }}
        title={isSelectMode ? 'Exit selection mode' : 'Enter selection mode (Dev Tools)'}
        >
          {isSelectMode ? '✕' : '🎨'}
        </button>
      )}

      {/* Development Mode Indicator */}
      {(isSelectMode || isInlineEditing) && (
        <div
          data-dev-tools="indicator"
          onMouseEnter={() => setIsIndicatorHovered(true)}
          onMouseLeave={() => setIsIndicatorHovered(false)}
          className="fixed top-[10px] left-1/4 transform -translate-x-1/2 bg-white text-black p-1.5 rounded-sm font-semibold text-sm z-999998 shadow-md border border-border transition-opacity duration-200 cursor-pointer"
          style={{ opacity: isIndicatorHovered ? 0 : 1 }}
          title="Hover to temporarily hide this indicator"
        >
          {isInlineEditing ? (
            <>Editing text - Press Enter to save, Escape to cancel</>
          ) : (
            <>Click element to edit</>
          )}
        </div>
      )}

      {/* Element Editor */}
      <ElementEditor
        isOpen={showEditor}
        onClose={clearSelection}
        position={editorPosition}
        selectedElement={selectedElement}
        isInlineEditing={isInlineEditing}
        isTextEditable={isTextEditable}
        startInlineEditing={startInlineEditing}
        stopInlineEditing={stopInlineEditing}
        cancelInlineEditing={cancelInlineEditing}
      />
    </>
  )
}
