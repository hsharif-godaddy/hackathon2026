import { useState, useEffect, useRef } from 'react'
import { safePostMessage, isOriginAllowed } from '../utils/postMessage'
import { captureAndResizeScreenshot, captureViewportScreenshot } from '../utils/screenshot'
import { useEditMode } from "../hooks/useEditMode";
import ElementHoverBar from "./ElementHoverBar";
import { setTranslations } from "../utils/translations";
import { resolveRouteForModule } from "../route-discovery";

export default function DevelopmentMode() {
  const [isEditModeActive, setIsEditModeActive] = useState(false); // off by default, parent enables via EDIT_MODE_ENABLED message
  const [isMultiSelectActive, setIsMultiSelectActive] = useState(false); // off by default, parent enables via MULTI_SELECT_ENABLED message
  const [, setTranslationsLoaded] = useState(0); // counter that always changes to force re-render

  const { hoveredElement, handleBarMouseEnter, handleBarMouseLeave } = useEditMode(isEditModeActive, isMultiSelectActive)
  const [quickEditActive, setQuickEditActive] = useState(false)
  const frozenElementRef = useRef(hoveredElement)

  // Keep the frozen ref up to date whenever we're not in quick edit mode
  if (!quickEditActive && hoveredElement) {
    frozenElementRef.current = hoveredElement
  }

  const effectiveElement = quickEditActive ? frozenElementRef.current : hoveredElement

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

    // Clear stale theme preview state from previous sessions
    localStorage.removeItem('airo-dev-original-theme')
    localStorage.removeItem('airo-dev-preview-theme')
    localStorage.removeItem('airo-dev-original-font')

    // Theme preview: convert hex to HSL for CSS custom properties
    function hexToHsl(hex: string): string {
      const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
      if (!result) return '0 0% 0%'

      const r = parseInt(result[1], 16) / 255
      const g = parseInt(result[2], 16) / 255
      const b = parseInt(result[3], 16) / 255

      const max = Math.max(r, g, b)
      const min = Math.min(r, g, b)
      let h = 0
      let s = 0
      const l = (max + min) / 2

      if (max !== min) {
        const d = max - min
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min)

        switch (max) {
          case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break
          case g: h = ((b - r) / d + 2) / 6; break
          case b: h = ((r - g) / d + 4) / 6; break
        }
      }

      return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`
    }

    function applyThemePreview(palette: any) {
      const root = document.documentElement

      // CSS custom properties to update (shadcn/ui format) - matches updateCssColors exactly
      const cssVars = [
        { key: '--background', value: palette.background },
        { key: '--foreground', value: palette.foreground },
        { key: '--card', value: palette.card ?? palette.muted },
        { key: '--card-foreground', value: palette.cardForeground ?? palette.foreground },
        { key: '--popover', value: palette.background },
        { key: '--popover-foreground', value: palette.foreground },
        { key: '--primary', value: palette.primary },
        { key: '--primary-foreground', value: palette.primaryForeground },
        { key: '--secondary', value: palette.secondary },
        { key: '--secondary-foreground', value: palette.secondaryForeground },
        { key: '--muted', value: palette.muted },
        { key: '--muted-foreground', value: palette.mutedForeground },
        { key: '--accent', value: palette.accent },
        { key: '--accent-foreground', value: palette.accentForeground },
        { key: '--destructive', value: palette.destructive },
        { key: '--destructive-foreground', value: palette.destructiveForeground },
        { key: '--border', value: palette.border },
        { key: '--input', value: palette.border },
        { key: '--ring', value: palette.primary },
        { key: '--chart-1', value: palette.chart1 },
        { key: '--chart-2', value: palette.chart2 },
        { key: '--chart-3', value: palette.chart3 },
        { key: '--chart-4', value: palette.chart4 },
        { key: '--chart-5', value: palette.chart5 },
        { key: '--sidebar', value: palette.muted },
        { key: '--sidebar-foreground', value: palette.foreground },
        { key: '--sidebar-primary', value: palette.primary },
        { key: '--sidebar-primary-foreground', value: palette.primaryForeground },
        { key: '--sidebar-accent', value: palette.accent },
        { key: '--sidebar-accent-foreground', value: palette.accentForeground },
        { key: '--sidebar-border', value: palette.border },
        { key: '--sidebar-ring', value: palette.primary }
      ].filter(item => item.value !== undefined && item.value !== null)

      // Store original theme on first preview for revert
      const hasOriginalTheme = localStorage.getItem('airo-dev-original-theme')
      if (!hasOriginalTheme) {
        const originalTheme: Record<string, string> = {}
        cssVars.forEach(({ key }) => {
          const currentValue = getComputedStyle(root).getPropertyValue(key)
          if (currentValue) {
            originalTheme[key] = currentValue.trim()
          }
        })
        localStorage.setItem('airo-dev-original-theme', JSON.stringify(originalTheme))
      }

      // Apply new theme values as HSL
      cssVars.forEach(({ key, value }) => {
        if (value) {
          root.style.setProperty(key, hexToHsl(value))
        }
      })

      localStorage.setItem('airo-dev-preview-theme', JSON.stringify(palette))
    }

    function revertThemePreview() {
      const originalThemeStr = localStorage.getItem('airo-dev-original-theme')
      if (!originalThemeStr) return

      const originalTheme = JSON.parse(originalThemeStr)
      const root = document.documentElement

      Object.entries(originalTheme).forEach(([key, value]) => {
        root.style.setProperty(key, value as string)
      })

      localStorage.removeItem('airo-dev-original-theme')
      localStorage.removeItem('airo-dev-preview-theme')
    }

    function buildGoogleFontsHref(headerFont: { name: string; weights: string[] }, bodyFont: { name: string; weights: string[] }) {
      const fontMap = new Map<string, Set<string>>()
      for (const f of [headerFont, bodyFont]) {
        if (!f?.name) continue
        const existing = fontMap.get(f.name) || new Set<string>()
        for (const w of f.weights || ['400', '700']) existing.add(w)
        fontMap.set(f.name, existing)
      }
      const parts: string[] = []
      fontMap.forEach((weights, name) => {
        const enc = encodeURIComponent(name).replace(/%20/g, '+')
        parts.push(`${enc}:wght@${Array.from(weights).sort().join(';')}`)
      })
      return `https://fonts.googleapis.com/css2?family=${parts.join('&family=')}&display=swap`
    }

    function applyFontPreview(data: { headerFont: { name: string; weights: string[] }; bodyFont: { name: string; weights: string[] } }) {
      const root = document.documentElement
      const { headerFont, bodyFont } = data
      if (!headerFont?.name || !bodyFont?.name) return

      const hasOriginalFont = localStorage.getItem('airo-dev-original-font')
      if (!hasOriginalFont) {
        const originalFont: Record<string, string> = {
          '--font-heading': getComputedStyle(root).getPropertyValue('--font-heading').trim(),
          '--font-sans': getComputedStyle(root).getPropertyValue('--font-sans').trim(),
        }
        localStorage.setItem('airo-dev-original-font', JSON.stringify(originalFont))
      }

      let fontLink = document.getElementById('airo-preview-font-link') as HTMLLinkElement | null
      if (!fontLink) {
        fontLink = document.createElement('link')
        fontLink.id = 'airo-preview-font-link'
        fontLink.rel = 'stylesheet'
        document.head.appendChild(fontLink)
      }
      fontLink.href = buildGoogleFontsHref(headerFont, bodyFont)

      root.style.setProperty('--font-heading', `"${headerFont.name}", ui-sans-serif, system-ui, sans-serif`)
      root.style.setProperty('--font-sans', `"${bodyFont.name}", ui-sans-serif, system-ui, sans-serif`)
    }

    function revertFontPreview() {
      const originalFontStr = localStorage.getItem('airo-dev-original-font')
      if (!originalFontStr) return

      try {
        const originalFont = JSON.parse(originalFontStr) as Record<string, string>
        const root = document.documentElement
        Object.entries(originalFont).forEach(([key, value]) => {
          root.style.setProperty(key, value)
        })
        localStorage.removeItem('airo-dev-original-font')
        const fontLink = document.getElementById('airo-preview-font-link')
        fontLink?.remove()
      } catch (error) {
        // Clear stale/corrupt localStorage key but keep preview font active
        // (removing the link without restoring CSS vars would break the preview)
        localStorage.removeItem('airo-dev-original-font')
      }
    }

    // Media version cache-busting via MutationObserver
    // Watches for dynamically added/changed images and applies version params
    let mediaVersions: Record<string, string> = {}
    let mediaVersionsCleanup: (() => void) | null = null
    let mediaObserver: MutationObserver | null = null

    const SLOT_URL_PREFIX = '/airo-assets/images/'

    function applyVersionToUrl(url: string): string | null {
      const prefixIdx = url.indexOf(SLOT_URL_PREFIX)
      if (prefixIdx === -1) return null

      const afterPrefix = url.substring(prefixIdx + SLOT_URL_PREFIX.length)
      // Extract slot path (everything before ? or end)
      const slotPath = afterPrefix.split('?')[0]
      const version = mediaVersions[slotPath]
      if (!version) return null

      try {
        const parsed = new URL(url, window.location.origin)
        if (parsed.searchParams.get('_v') === version) return null // already correct
        parsed.searchParams.set('_v', version)
        return parsed.toString()
      } catch {
        return null
      }
    }

    function patchImageElement(img: HTMLImageElement) {
      if (!img.src) return
      const patched = applyVersionToUrl(img.src)
      if (patched) img.src = patched
    }

    function patchBackgroundImage(el: HTMLElement) {
      const bgImage = el.style.backgroundImage
      if (!bgImage?.includes(SLOT_URL_PREFIX)) return
      const urlMatch = bgImage.match(/url\(["']?([^"')]+)["']?\)/)
      if (!urlMatch?.[1]) return
      const patched = applyVersionToUrl(urlMatch[1])
      if (patched) el.style.backgroundImage = `url("${patched}")`
    }

    function patchAllImages() {
      document.querySelectorAll<HTMLImageElement>('img').forEach(patchImageElement)
      // Use getComputedStyle for full scan to catch CSS-applied backgrounds,
      // not just inline styles (the MutationObserver can only detect inline changes)
      document.querySelectorAll<HTMLElement>('*').forEach((el) => {
        const bgImage = window.getComputedStyle(el).backgroundImage
        if (!bgImage || bgImage === 'none' || !bgImage.includes(SLOT_URL_PREFIX)) return
        const urlMatch = bgImage.match(/url\(["']?([^"')]+)["']?\)/)
        if (!urlMatch?.[1]) return
        const patched = applyVersionToUrl(urlMatch[1])
        if (patched) el.style.backgroundImage = `url("${patched}")`
      })
    }

    // Set up the MutationObserver to catch dynamically rendered images
    mediaObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'childList') {
          for (const node of mutation.addedNodes) {
            if (!(node instanceof HTMLElement)) continue
            if (node instanceof HTMLImageElement) {
              patchImageElement(node)
            }
            // Check descendants of added nodes
            node.querySelectorAll<HTMLImageElement>('img').forEach(patchImageElement)
            if (node.style?.backgroundImage) patchBackgroundImage(node)
            node.querySelectorAll<HTMLElement>('[style*="background"]').forEach(patchBackgroundImage)
          }
        } else if (mutation.type === 'attributes') {
          const target = mutation.target as HTMLElement
          if (mutation.attributeName === 'src' && target instanceof HTMLImageElement) {
            patchImageElement(target)
          } else if (mutation.attributeName === 'style') {
            patchBackgroundImage(target)
          }
        }
      }
    })

    mediaObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['src', 'style'],
    })

    // Load version map from virtual module (dev mode only)
    // Use a variable to prevent Vite from statically resolving this import —
    // older apps without the mediaVersionsPlugin will gracefully fall back via .catch()
    if (import.meta.env.MODE === 'development') {
      const mediaVersionsModule = 'virtual:' + 'media-versions'
      import(/* @vite-ignore */ mediaVersionsModule).then(({ getVersions, onVersionsUpdate }) => {
        mediaVersions = getVersions()
        patchAllImages()
        mediaVersionsCleanup = onVersionsUpdate((newVersions: Record<string, string>) => {
          mediaVersions = newVersions
          patchAllImages()
        })
      }).catch(() => {
        // Virtual module not available — plugin may not be loaded
      })
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

        if (event.data && event.data.type === 'DEVTOOLS_TRANSLATIONS') {
          // Receive devtools_* translations from parent window (AAB app)
          if (event.data.translations && typeof event.data.translations === 'object') {
            setTranslations(event.data.translations);
            setTranslationsLoaded(v => v + 1); // Increment counter to force re-render
          }
          return;
        }
        if (event.data && event.data.type === 'EDIT_MODE_ENABLED') {
          setIsEditModeActive(true);
          return;
        }
        if (event.data && event.data.type === 'EDIT_MODE_DISABLED') {
          setIsEditModeActive(false);
          return;
        }
        if (event.data && event.data.type === 'MULTI_SELECT_ENABLED') {
          setIsMultiSelectActive(true);
          return;
        }
        if (event.data && event.data.type === 'MULTI_SELECT_DISABLED') {
          setIsMultiSelectActive(false);
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
          // `modulePath`, when present, is the source file the parent wants
          // us to land on the registered route for. We resolve it against the
          // live route registry so skill-installed pages (mounted at
          // non-filename paths) navigate correctly. Falls back to the raw
          // `url` when the registry can't help.
          const url: string | null = typeof event.data.url === 'string' ? event.data.url : null
          const modulePath: string | null =
            typeof event.data.modulePath === 'string' ? event.data.modulePath : null
          const currentPath = window.location.pathname + window.location.search + window.location.hash
          const resolvePromise: Promise<string | null> = (url || modulePath)
            ? resolveRouteForModule({ url, modulePath }, currentPath).catch((error) => {
                console.error('Failed to resolve route for checkout hint:', error)
                return url && url !== currentPath ? url : null
              })
            : Promise.resolve(null)

          resolvePromise.then((target) => {
            if (target && target !== currentPath) {
              try {
                // Use original pushState to avoid triggering our monkey-patched navigation handler
                originalPushState(null, '', target)
                // Dispatch a popstate event to notify React Router of the navigation
                const popStateEvent = new PopStateEvent('popstate', { state: null })
                window.dispatchEvent(popStateEvent)
              } catch (error) {
                console.error('Failed to restore URL:', error)
              }
            }
          })

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
        } else if (event.data?.type === 'PREVIEW_THEME' && event.data.palette) {
          applyThemePreview(event.data.palette)
        } else if (event.data?.type === 'REVERT_THEME') {
          revertThemePreview()
        } else if (
          event.data?.type === 'PREVIEW_FONT' &&
          event.data.headerFont &&
          event.data.bodyFont
        ) {
          try {
            applyFontPreview({
              bodyFont: event.data.bodyFont as { name: string; weights: string[] },
              headerFont: event.data.headerFont as { name: string; weights: string[] },
            })
          } catch (fontError) {
            console.error('[DevTools] Font preview failed:', fontError)
          }
        } else if (event.data?.type === 'REVERT_FONT') {
          try {
            revertFontPreview()
          } catch (fontError) {
            console.error('[DevTools] Font revert failed:', fontError)
          }
        }
      } catch (error) {
        console.error('[DevTools] Message handler error:', error, 'Message type:', event.data?.type)

        // Send error response only for visual context requests (not font/theme preview errors)
        if (window.parent !== window && event.data?.type === 'REQUEST_VISUAL_CONTEXT') {
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
      if (mediaObserver) mediaObserver.disconnect()
      if (mediaVersionsCleanup) mediaVersionsCleanup()
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

  return (
    <div data-airo-dev-tools>
      {isEditModeActive && effectiveElement && !(isMultiSelectActive && effectiveElement.element.hasAttribute("data-ai-selected-num")) && (
        <ElementHoverBar
          hoveredElement={effectiveElement}
          isMultiSelectActive={isMultiSelectActive}
          onMouseEnter={handleBarMouseEnter}
          onMouseLeave={handleBarMouseLeave}
          onQuickEditModeChange={setQuickEditActive}
        />
      )}
    </div>
  )
}
