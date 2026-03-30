import { useDevelopmentMode } from '../hooks/useDevelopmentMode'
import { useState, useEffect } from 'react'
import ElementEditor, { editorTypographyStyles } from './ElementEditor'
import { safePostMessage, isOriginAllowed } from '../utils/postMessage'
import { captureAndResizeScreenshot, captureViewportScreenshot } from '../utils/screenshot'
import { useEditMode } from "../hooks/useEditMode";
import ImageHoverBar from "./ImageHoverBar";
import { initTranslations } from "../utils/translations";

export default function DevelopmentMode() {
  // Load translations from i18n API on mount
  useEffect(() => { void initTranslations(); }, []);
  const [isEditModeActive, setIsEditModeActive] = useState(false); // off by default, parent enables via EDIT_MODE_ENABLED message

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
  } = useDevelopmentMode({ isEditModeActive })

  const { hoveredImage, handleBarMouseEnter, handleBarMouseLeave } = useEditMode(isEditModeActive)

  // State to control indicator visibility on hover
  const [isIndicatorHovered, setIsIndicatorHovered] = useState(false)

  // Check if floating button should be visible via environment variable
  const showFloatingButton = import.meta.env.VITE_SHOW_DEV_TOOLS === 'true'

  // Visual context capture for AI assistance
  useEffect(() => {
    let activeSection = 'unknown'
    let visibleSections: { name: string; id?: string; visible_area: number }[] = []
    let sectionsObserver: IntersectionObserver | null = null
    let isScriptReady = false

    // Cached visual context for instant responses
    let cachedContext = {
      page: window.location.pathname + window.location.search + window.location.hash,
      scroll_position: { x: 0, y: 0 },
      active_section: 'unknown',
      visible_sections: [] as { name: string; id?: string; visible_area: number }[],
      viewport: { width: window.innerWidth, height: window.innerHeight },
      timestamp: Date.now(),
      script_ready: false
    }

    // Update cached context
    const updateCachedContext = () => {
      cachedContext = {
        page: window.location.pathname + window.location.search + window.location.hash,
        scroll_position: {
          x: window.scrollX || window.pageXOffset || 0,
          y: window.scrollY || window.pageYOffset || 0
        },
        active_section: activeSection,
        visible_sections: visibleSections,
        viewport: {
          width: window.innerWidth,
          height: window.innerHeight
        },
        timestamp: Date.now(),
        script_ready: isScriptReady
      }
    }

    // Reload images for a specific media slot by adding cache-busting timestamp
    function reloadMediaSlot(slotPath: string) {
      const timestamp = Date.now()
      const slotUrlPattern = `/airo-assets/images/${slotPath}`

      // Reload <img> elements
      document.querySelectorAll<HTMLImageElement>('img').forEach((img) => {
        if (img.src.includes(slotUrlPattern)) {
          const url = new URL(img.src)
          url.searchParams.set('_t', String(timestamp))
          img.src = url.toString()
        }
      })

      // Reload CSS background images
      document.querySelectorAll<HTMLElement>('[style*="background"]').forEach((el) => {
        const bgImage = window.getComputedStyle(el).backgroundImage
        if (bgImage?.includes(slotUrlPattern)) {
          const urlMatch = bgImage.match(/url\(["']?([^"')]+)["']?\)/)
          if (urlMatch?.[1]) {
            const url = new URL(urlMatch[1], window.location.origin)
            url.searchParams.set('_t', String(timestamp))
            el.style.backgroundImage = `url("${url.toString()}")`
          }
        }
      })
    }

    // Track visible area of all observed sections for accurate detection
    const sectionVisibility = new Map<Element, { ratio: number; visibleArea: number }>()

    // Extract a human-readable name for a section element
    function getSectionName(element: HTMLElement): string {
      // 1. Explicit attributes
      if (element.getAttribute('data-section')) return element.getAttribute('data-section')!
      if (element.getAttribute('id')) return element.getAttribute('id')!
      if (element.getAttribute('aria-label')) return element.getAttribute('aria-label')!

      // 2. First heading inside the section (most reliable for agent-generated pages)
      const heading = element.querySelector('h1, h2, h3, h4, h5, h6')
      if (heading?.textContent) {
        const text = heading.textContent.trim().substring(0, 60)
        if (text) return text
      }

      // 3. Tag name fallback
      return element.tagName.toLowerCase()
    }

    // Debug overlay for visualizing section detection (Ctrl+Shift+D to toggle)
    let debugVisible = false
    const debugOverlay = document.createElement('div')
    debugOverlay.setAttribute('data-airo-dev-tools', '')
    debugOverlay.style.cssText = 'position:fixed;bottom:8px;right:8px;z-index:999999;background:rgba(0,0,0,0.85);color:#0f0;font-family:monospace;font-size:11px;padding:8px 10px;border-radius:6px;pointer-events:none;max-width:300px;line-height:1.4;display:none;'
    document.body.appendChild(debugOverlay)

    const handleDebugToggle = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'D') {
        e.preventDefault()
        debugVisible = !debugVisible
        debugOverlay.style.display = debugVisible ? 'block' : 'none'
        if (debugVisible) {
          updateDebugOverlay()
        } else if (prevHighlighted) {
          prevHighlighted.style.outline = ''
          prevHighlighted = null
        }
      }
    }
    window.addEventListener('keydown', handleDebugToggle)

    let prevHighlighted: HTMLElement | null = null
    function addLine(parent: HTMLElement, text: string, color?: string) {
      const span = document.createElement('span')
      span.textContent = text
      if (color) span.style.color = color
      parent.appendChild(span)
      parent.appendChild(document.createElement('br'))
    }

    function updateDebugOverlay() {
      if (!debugVisible) return

      // Build ranked list of visible sections
      const ranked: { name: string; area: number; ratio: number; el: Element }[] = []
      sectionVisibility.forEach((info, el) => {
        const name = getSectionName(el as HTMLElement)
        ranked.push({ name, area: info.visibleArea, ratio: info.ratio, el })
      })
      ranked.sort((a, b) => b.area - a.area)

      const scrollY = Math.round(window.scrollY || 0)

      // Clear and rebuild with DOM APIs (no innerHTML)
      debugOverlay.textContent = ''
      addLine(debugOverlay, `active: ${activeSection}`, '#ff0')
      addLine(debugOverlay, `scroll: ${scrollY}px`)
      addLine(debugOverlay, `page: ${(window.location.pathname + window.location.search + window.location.hash).substring(0, 40)}`)
      addLine(debugOverlay, '---')
      ranked.slice(0, 8).forEach((r, i) => {
        addLine(debugOverlay, `${i === 0 ? '>' : ' '} ${r.name} (${Math.round(r.area)}px\u00B2 ${Math.round(r.ratio * 100)}%)`)
      })

      // Highlight the winning section
      if (prevHighlighted) {
        prevHighlighted.style.outline = ''
        prevHighlighted = null
      }
      if (ranked.length > 0) {
        const winner = ranked[0].el as HTMLElement
        winner.style.outline = '2px dashed rgba(0,255,0,0.6)'
        prevHighlighted = winner
      }
    }

    // Set up intersection observer for section detection
    function setupSectionObserver() {
      try {
        // Query content sections and page boundaries only.
        // Structural containers (main, nav, aside) are excluded — they wrap
        // content sections and always win area-based ranking, defeating detection.
        // Class-based selectors ([class*="hero"] etc.) are excluded — they cause
        // nested elements to inflate parent rankings. Templates use <section> tags;
        // data-section is the escape hatch for non-section layouts.
        const candidates = Array.from(new Set(
          document.querySelectorAll('[data-section], section, header, footer')
        ))

        // Filter out descendant elements: if a <section> contains a <header>,
        // keep the outer <section> to avoid understating its visible area.
        const sections = candidates.filter(el =>
          !candidates.some(other => other !== el && other.contains(el))
        )

        if (sections.length === 0) {
          activeSection = 'main-content'
          isScriptReady = true
          return
        }

        sectionsObserver = new IntersectionObserver((entries) => {
          // Update visibility map with changed entries
          entries.forEach(entry => {
            if (entry.isIntersecting) {
              sectionVisibility.set(entry.target, {
                ratio: entry.intersectionRatio,
                visibleArea: entry.intersectionRect.width * entry.intersectionRect.height
              })
            } else {
              sectionVisibility.delete(entry.target)
            }
          })

          // Find section with largest visible area from ALL tracked sections
          let bestMatch: Element | null = null
          let bestArea = 0

          sectionVisibility.forEach((info, element) => {
            if (info.visibleArea > bestArea) {
              bestArea = info.visibleArea
              bestMatch = element
            }
          })

          // Build ranked list of visible sections (capped to limit payload size)
          const ranked: { name: string; id?: string; visible_area: number }[] = []
          sectionVisibility.forEach((info, element) => {
            const htmlEl = element as HTMLElement
            const entry: { name: string; id?: string; visible_area: number } = {
              name: getSectionName(htmlEl),
              visible_area: info.visibleArea
            }
            const id = htmlEl.getAttribute('id')
            if (id) entry.id = id
            ranked.push(entry)
          })
          ranked.sort((a, b) => b.visible_area - a.visible_area)
          visibleSections = ranked.slice(0, 5)

          if (bestMatch && bestArea > 0) {
            const sectionName = getSectionName(bestMatch as HTMLElement)

            if (sectionName && sectionName !== activeSection) {
              activeSection = sectionName
              updateCachedContext()
            }
          }
          updateDebugOverlay()
        }, {
          threshold: [0, 0.1, 0.3, 0.5, 0.7, 1],
          rootMargin: '-10% 0px -10% 0px'
        })

        sections.forEach(section => sectionsObserver?.observe(section))
        isScriptReady = true
        updateCachedContext()

      } catch (error) {
        activeSection = 'content'
        isScriptReady = true
        updateCachedContext()
      }
    }

    // Update cache on scroll (throttled to avoid performance issues)
    let scrollTimeout: ReturnType<typeof setTimeout> | null = null
    const handleScroll = () => {
      if (scrollTimeout) return
      scrollTimeout = setTimeout(() => {
        updateCachedContext()
        updateDebugOverlay()
        scrollTimeout = null
      }, 150) // Throttle to every 150ms
    }

    // Update cache on resize
    let resizeTimeout: ReturnType<typeof setTimeout> | null = null
    const handleResize = () => {
      if (resizeTimeout) return
      resizeTimeout = setTimeout(() => {
        updateCachedContext()
        resizeTimeout = null
      }, 150)
    }

    // Re-initialize section observer on SPA navigation
    let navigationTimeout: ReturnType<typeof setTimeout> | null = null
    const handleNavigation = () => {
      // Debounce rapid navigation events
      if (navigationTimeout) clearTimeout(navigationTimeout)
      navigationTimeout = setTimeout(() => {
        if (sectionsObserver) {
          sectionsObserver.disconnect()
        }
        sectionVisibility.clear()
        activeSection = 'unknown'
        visibleSections = []
        setupSectionObserver()
        updateCachedContext()
        navigationTimeout = null
      }, 150)
    }

    // Intercept pushState/replaceState for SPA navigation detection
    // React Router uses pushState for <Link> clicks, which doesn't fire popstate
    const originalPushState = history.pushState.bind(history)
    const originalReplaceState = history.replaceState.bind(history)
    history.pushState = (...args: Parameters<typeof history.pushState>) => {
      originalPushState(...args)
      handleNavigation()
    }
    history.replaceState = (...args: Parameters<typeof history.replaceState>) => {
      originalReplaceState(...args)
      handleNavigation()
    }

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', setupSectionObserver)
    } else {
      setupSectionObserver()
    }

    // Listen for scroll and resize to keep cache fresh
    window.addEventListener('scroll', handleScroll, { passive: true })
    window.addEventListener('resize', handleResize)
    // Listen for browser back/forward (popstate covers hash changes in modern browsers)
    window.addEventListener('popstate', handleNavigation)

    // Listen for visual context requests from parent window
    const handleMessage = (event: MessageEvent) => {
      try {
        // Validate origin for security
        if (!isOriginAllowed(event)) {
          console.warn('[DevTools] Message rejected - origin not allowed:', event.origin, 'VITE_PARENT_ORIGIN:', import.meta.env.VITE_PARENT_ORIGIN)
          return
        }

        if (event.data && event.data.type === 'EDIT_MODE_ENABLED') {
          setIsEditModeActive(true);
          return;
        }
        if (event.data && event.data.type === 'EDIT_MODE_DISABLED') {
          setIsEditModeActive(false);
          return;
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
            const currentPath = window.location.pathname + window.location.search + window.location.hash
            if (currentPath !== event.data.url) {
              try {
                // Use original pushState to avoid triggering our monkey-patched navigation handler
                originalPushState(null, '', event.data.url)

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
          // Update cache one final time to ensure freshness, then send immediately
          updateCachedContext()

          // Send cached response back to parent (near-instant response)
          if (window.parent !== window) {
            safePostMessage(window.parent, {
              type: 'VISUAL_CONTEXT_RESPONSE',
              context: cachedContext
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
        } else if (event.data && event.data.type === 'REQUEST_VIEWPORT_SCREENSHOT') {
          captureViewportScreenshot().then(screenshot => {
            if (screenshot && window.parent !== window) {
              safePostMessage(window.parent, {
                type: 'VIEWPORT_SCREENSHOT_RESPONSE',
                screenshot: screenshot
              })
            }
          }).catch((error) => {
            console.error('Viewport eval screenshot: Error capturing:', error)
          })
        } else if (event.data?.type === 'RELOAD_MEDIA_SLOT' && event.data.slotPath) {
          reloadMediaSlot(event.data.slotPath)
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
      sectionVisibility.clear()
      if (prevHighlighted) prevHighlighted.style.outline = ''
      debugOverlay.remove()
      window.removeEventListener('keydown', handleDebugToggle)
      history.pushState = originalPushState
      history.replaceState = originalReplaceState
      window.removeEventListener('message', handleMessage)
      window.removeEventListener('scroll', handleScroll)
      window.removeEventListener('resize', handleResize)
      window.removeEventListener('popstate', handleNavigation)
      document.removeEventListener('DOMContentLoaded', setupSectionObserver)
      if (scrollTimeout) clearTimeout(scrollTimeout)
      if (resizeTimeout) clearTimeout(resizeTimeout)
      if (navigationTimeout) clearTimeout(navigationTimeout)
    }
  }, [])

  if (!isEnabled) {
    return null
  }

  return (
    <div data-airo-dev-tools>
      {/* Development Mode Floating Button - Only show if environment variable is set */}
      {showFloatingButton && (
        <button
        data-dev-tools="floating-button"
        className="fixed bottom-10 left-10 w-7.5 h-7.5 rounded-full backdrop-blur-10px text-white p-1.5 font-semibold text-sm z-999999 box-shadow-md border transition-opacity duration-200 cursor-pointer"
        style={{
          background: isSelectMode
            ? 'linear-gradient(135deg, var(--color-error-gradient-start) 0%, var(--color-error-gradient-end) 100%)'
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
          className="fixed top-[10px] left-1/2 transform -translate-x-1/2 bg-white text-black px-2 py-0.5 rounded-sm z-999998 shadow-md border border-border transition-opacity duration-200 cursor-pointer"
          style={{ opacity: isIndicatorHovered ? 0 : 1, ...editorTypographyStyles }}
          title="Hover to temporarily hide this indicator"
        >
          <div className="font-semibold text-sm">
            {isInlineEditing ? (
              <>Editing text - Press Enter to save, Escape to cancel</>
            ) : (
              <>Click element to edit</>
            )}
          </div>
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
      {isEditModeActive && hoveredImage && (
        <ImageHoverBar
          hoveredImage={hoveredImage}
          onMouseEnter={handleBarMouseEnter}
          onMouseLeave={handleBarMouseLeave}
        />
      )}
    </div>
  )
}
