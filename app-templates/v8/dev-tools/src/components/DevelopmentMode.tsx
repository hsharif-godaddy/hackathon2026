import { useState, useEffect, useRef } from 'react'
import { safePostMessage, isOriginAllowed } from '../utils/postMessage'
import { send } from '../utils/eventBus'
import { captureAndResizeScreenshot, captureViewportScreenshot } from '../utils/screenshot'
import { showSelectionOverlay } from '../utils/selection-overlay'
import { useEditMode } from "../hooks/useEditMode";
import { useComplianceFieldEditor } from "../hooks/useComplianceFieldEditor";
import AnnotationMode from "./AnnotationMode";
import ElementHoverBar from "./ElementHoverBar";
import { setTranslations } from "../utils/translations";
import { resolveRouteForModule } from "../route-discovery";
import { collectMediaSlotDomMatches } from "../utils/media-slot-dom";
import { isClickable, isInsideNavSurface, isDevToolsElement, isManagedPath, hasManagedDocMarkup, FORM_TAGS } from "../utils/element-detection";
import CarouselSlotEditNav from "./CarouselSlotEditNav";
import { setCarouselSlotEdit, setCarouselToolbarPause } from "../utils/carousel-slot-edit";
import { bindCarouselSlotPanelSync } from "../utils/carousel-slot-panel-sync";
import { pauseEditModeTimers, resumeEditModeTimers, advancePausedCarouselTimers, getPausedCarouselTimerCount } from "../utils/edit-mode-timer-pause";

export default function DevelopmentMode() {
  const [isEditModeActive, setIsEditModeActive] = useState(false); // off by default, parent enables via EDIT_MODE_ENABLED message
  const [cmsInlineEditEnabled, setCmsInlineEditEnabled] = useState(false); // off by default, parent sets via EDIT_MODE_ENABLED message payload
  const [isMultiSelectActive, setIsMultiSelectActive] = useState(false); // off by default, parent enables via MULTI_SELECT_ENABLED message
  const [isAnnotationModeActive, setIsAnnotationModeActive] = useState(false); // off by default, parent enables via ANNOTATION_MODE_ENABLED message
  const [pausedCarouselCount, setPausedCarouselCount] = useState(0); // count of paused carousel-shaped timers — drives the edit-mode "Next slide" overlay
  const [, setTranslationsLoaded] = useState(0); // counter that always changes to force re-render
  const [pathname, setPathname] = useState(() => window.location.pathname); // updated synchronously on SPA navigation (see onNavigate)
  const [hasManagedMarkup, setHasManagedMarkup] = useState(false); // true once compliance markup is detected on the page (see effect below)

  // A "managed doc" is a /privacy or /terms page that actually carries the
  // compliance markup (data-editable / data-section). On those, the only editable
  // content is the annotated compliance fields (handled by useComplianceFieldEditor),
  // so the general inline editor must stand down. A plain pre-existing privacy/terms
  // page without the markup is NOT managed and keeps full inline editing.
  const isManagedDoc = isManagedPath(pathname) && hasManagedMarkup

  const { hoveredElement, toolbarMode, setToolbarMode, handleBarMouseEnter, handleBarMouseLeave } = useEditMode(isEditModeActive && !isManagedDoc, cmsInlineEditEnabled, isMultiSelectActive)

  // Compliance docs: highlight + inline-edit field values and toggle boolean
  // sections, gated to edit mode like every other inline-editing affordance.
  // Self-managing; only acts on /privacy and /terms pages with the annotated
  // markup, and tears its affordances down when edit mode is switched off.
  useComplianceFieldEditor(isEditModeActive)
  const [quickEditActive, setQuickEditActive] = useState(false)
  const frozenElementRef = useRef(hoveredElement)

  // Keep the frozen ref up to date whenever hover/toolbar state changes, except
  // during quick-edit input where the anchor must stay on the clicked element.
  if (!quickEditActive && hoveredElement) {
    frozenElementRef.current = hoveredElement
  }

  // Freeze the anchor while the toolbar or quick-edit UI is open so hover drift
  // over nearby elements does not retarget the bar mid-interaction.
  const effectiveElement = (toolbarMode || quickEditActive) ? frozenElementRef.current : hoveredElement

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
    // Use a single mutable state object to avoid closure-capture drift when async callbacks update values
    const mediaState = { versions: {} as Record<string, string>, types: {} as Record<string, string>, captions: {} as Record<string, string> }
    // Track slots recently updated by RELOAD_MEDIA_SLOT to prevent HMR-driven patchAllImages
    // from reverting them with stale manifest data (race between postMessage and file-watcher)
    const recentSlotOverrides: Record<string, number> = {}
    let mediaObserver: MutationObserver | null = null

    const SLOT_URL_PREFIX = '/airo-assets/images/'
    const SLOT_URL_PREFIX_VIDEOS = '/airo-assets/videos/'

    /** Extract the slot path from an /airo-assets/images/ or /airo-assets/videos/ URL */
    function extractSlotPath(url: string): { slotPath: string; prefix: string } | null {
      for (const prefix of [SLOT_URL_PREFIX, SLOT_URL_PREFIX_VIDEOS]) {
        const prefixIdx = url.indexOf(prefix)
        if (prefixIdx !== -1) {
          const afterPrefix = url.substring(prefixIdx + prefix.length)
          return { slotPath: afterPrefix.split('?')[0], prefix }
        }
      }
      return null
    }

    function applyVersionToUrl(url: string): string | null {
      const extracted = extractSlotPath(url)
      if (!extracted) return null

      const version = mediaState.versions[extracted.slotPath]
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

      // Apply caption as alt text if the image doesn't already have meaningful alt
      const extracted = extractSlotPath(img.src)
      if (extracted) {
        const caption = mediaState.captions[extracted.slotPath]
        if (caption && (!img.alt || img.alt === '' || img.alt === 'image')) {
          img.alt = caption
        }
      }

      // Check if this image's slot has mediaType 'video' — if so, add a <video> sibling
      if (extracted && mediaState.types[extracted.slotPath] === 'video') {
        if (img.getAttribute('data-airo-video-patched')) return
        const videoUrl = new URL(window.location.origin + SLOT_URL_PREFIX_VIDEOS + extracted.slotPath)
        const version = mediaState.versions[extracted.slotPath]
        if (version) videoUrl.searchParams.set('_v', version)
        videoUrl.searchParams.set('_t', String(Date.now()))
        insertVideoSibling(img, videoUrl.toString(), extracted.slotPath)
      }
    }

    /** Create a <video> element and insert it after the given <img>, hiding the img.
     *  Removes any existing sibling video for this slot first to prevent orphans
     *  if React re-renders the <img> without removing the previous <video>. */
    function insertVideoSibling(img: HTMLImageElement, videoSrc: string, slotPath: string) {
      // Clean up any existing video for this slot to prevent duplicates
      const existing = img.parentNode?.querySelector(`video[data-slot="${slotPath}"]`) as HTMLVideoElement | null
      if (existing) existing.remove()

      const video = document.createElement('video')
      video.src = videoSrc
      video.autoplay = true
      video.muted = true
      video.loop = true
      video.playsInline = true
      video.className = img.className
      video.style.cssText = img.style.cssText
      if (img.width) video.width = img.width
      if (img.height) video.height = img.height
      // Apply caption as accessible label
      const caption = mediaState.captions[slotPath]
      if (caption) video.setAttribute('aria-label', caption)
      video.setAttribute('data-airo-video', '')
      video.setAttribute('data-slot', slotPath)
      img.setAttribute('data-airo-video-patched', 'true')
      img.style.display = 'none'
      img.parentNode?.insertBefore(video, img.nextSibling)
    }

    /** Patch <video> elements: apply version params, or remove if slot changed to image */
    function patchVideoElement(video: HTMLVideoElement) {
      if (!video.src) return
      // Skip our own injected video siblings
      if (!video.hasAttribute('data-airo-video')) return
      const slotPath = video.getAttribute('data-slot')
      if (!slotPath) return
      if (mediaState.types[slotPath] !== 'video') {
        // Slot reverted to image — remove video, un-hide img
        const prevImg = video.previousElementSibling as HTMLElement | null
        if (prevImg?.tagName === 'IMG') {
          prevImg.removeAttribute('data-airo-video-patched')
          prevImg.style.display = ''
        }
        video.remove()
        return
      }
      const version = mediaState.versions[slotPath]
      if (!version) return
      try {
        const parsed = new URL(video.src, window.location.origin)
        if (parsed.searchParams.get('_v') === version) return
        parsed.searchParams.set('_v', version)
        video.src = parsed.toString()
      } catch {
        // ignore
      }
    }

    function patchBackgroundImage(el: HTMLElement) {
      // Check inline style first, then fall back to computed style for CSS-class backgrounds
      let bgImage = el.style.backgroundImage
      if (!bgImage || bgImage === 'none' || (!bgImage.includes(SLOT_URL_PREFIX) && !bgImage.includes(SLOT_URL_PREFIX_VIDEOS))) {
        bgImage = window.getComputedStyle(el).backgroundImage
      }
      if (!bgImage || bgImage === 'none') return
      if (!bgImage.includes(SLOT_URL_PREFIX) && !bgImage.includes(SLOT_URL_PREFIX_VIDEOS)) return
      const urlMatch = bgImage.match(/url\(["']?([^"')]+)["']?\)/)
      if (!urlMatch?.[1]) return

      // Check if this background slot is a video — if so, insert a video element
      const extracted = extractSlotPath(urlMatch[1])
      if (extracted && mediaState.types[extracted.slotPath] === 'video') {
        if (el.getAttribute('data-airo-video-bg-patched') === extracted.slotPath) return
        const existingBgVideo = el.querySelector<HTMLVideoElement>('video[data-airo-bg-video]')
        if (existingBgVideo) existingBgVideo.remove()
        el.style.backgroundImage = 'none'
        el.setAttribute('data-airo-video-bg-patched', extracted.slotPath)
        const videoUrl = new URL(window.location.origin + SLOT_URL_PREFIX_VIDEOS + extracted.slotPath)
        const version = mediaState.versions[extracted.slotPath]
        if (version) videoUrl.searchParams.set('_v', version)
        videoUrl.searchParams.set('_t', String(Date.now()))
        const video = document.createElement('video')
        video.src = videoUrl.toString()
        video.autoplay = true
        video.muted = true
        video.loop = true
        video.playsInline = true
        video.setAttribute('data-airo-bg-video', '')
        video.setAttribute('data-slot', extracted.slotPath)
        video.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:-1;'
        const pos = window.getComputedStyle(el).position
        if (pos === 'static') el.style.position = 'relative'
        el.insertBefore(video, el.firstChild)
        return
      }

      const patched = applyVersionToUrl(urlMatch[1])
      if (patched) el.style.backgroundImage = `url("${patched}")`
    }

    function patchAllImages() {
      document.querySelectorAll<HTMLImageElement>('img').forEach(patchImageElement)
      document.querySelectorAll<HTMLVideoElement>('video').forEach(patchVideoElement)
      // Use getComputedStyle for full scan to catch CSS-applied backgrounds,
      // not just inline styles (the MutationObserver can only detect inline changes)
      document.querySelectorAll<HTMLElement>('*').forEach((el) => {
        const bgImage = window.getComputedStyle(el).backgroundImage
        if (!bgImage || bgImage === 'none' || (!bgImage.includes(SLOT_URL_PREFIX) && !bgImage.includes(SLOT_URL_PREFIX_VIDEOS))) return
        const urlMatch = bgImage.match(/url\(["']?([^"')]+)["']?\)/)
        if (!urlMatch?.[1]) return

        // Check if this background slot is a video — if so, insert a video element
        const extracted = extractSlotPath(urlMatch[1])
        if (extracted && mediaState.types[extracted.slotPath] === 'video') {
          if (el.getAttribute('data-airo-video-bg-patched') === extracted.slotPath) return
          const existingBgVideo = el.querySelector<HTMLVideoElement>('video[data-airo-bg-video]')
          if (existingBgVideo) existingBgVideo.remove()
          el.style.backgroundImage = 'none'
          el.setAttribute('data-airo-video-bg-patched', extracted.slotPath)
          const videoUrl = new URL(window.location.origin + SLOT_URL_PREFIX_VIDEOS + extracted.slotPath)
          const version = mediaState.versions[extracted.slotPath]
          if (version) videoUrl.searchParams.set('_v', version)
          videoUrl.searchParams.set('_t', String(Date.now()))
          const video = document.createElement('video')
          video.src = videoUrl.toString()
          video.autoplay = true
          video.muted = true
          video.loop = true
          video.playsInline = true
          video.setAttribute('data-airo-bg-video', '')
          video.setAttribute('data-slot', extracted.slotPath)
          video.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:-1;'
          const pos = window.getComputedStyle(el).position
          if (pos === 'static') el.style.position = 'relative'
          el.insertBefore(video, el.firstChild)
          return
        }

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
            // Check added element and descendants for background-images (inline or CSS-class)
            patchBackgroundImage(node)
            node.querySelectorAll<HTMLElement>('[style*="background"], section, div, header, main').forEach(patchBackgroundImage)
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

    // Load initial media state from manifest and subscribe to live HMR updates.
    // Uses fetch + import.meta.hot directly instead of the virtual module (which
    // never resolved through the dev-supervisor proxy, always hitting a CORS error).
    if (import.meta.env.MODE === 'development') {
      fetch('/airo-media.json')
        .then(r => r.ok ? r.json() : {})
        .then((manifest: Record<string, { lastUpdated?: string; mediaType?: string; caption?: string }>) => {
          for (const [slot, data] of Object.entries(manifest)) {
            if (data.lastUpdated) mediaState.versions[slot] = String(new Date(data.lastUpdated).getTime())
            if (data.mediaType) mediaState.types[slot] = data.mediaType
            if (data.caption) mediaState.captions[slot] = data.caption
          }
          patchAllImages()
        })
        .catch((err) => { console.warn('[DevTools] media manifest fetch failed', err) })

      if (import.meta.hot) {
        const handleMediaVersionsUpdate = (data: { versions: Record<string, string>; mediaTypes: Record<string, string>; captions?: Record<string, string> }) => {
          mediaState.versions = data.versions
          // Apply new captions but preserve recent RELOAD_MEDIA_SLOT overrides
          if (data.captions) {
            const now = Date.now()
            for (const [slot, cap] of Object.entries(data.captions)) {
              const overrideTime = recentSlotOverrides[slot]
              if (overrideTime && now - overrideTime < 5000) continue
              mediaState.captions[slot] = cap
            }
            for (const slot of Object.keys(mediaState.captions)) {
              if (!(slot in data.captions!) && !recentSlotOverrides[slot]) {
                delete mediaState.captions[slot]
              }
            }
          }
          // Apply new mediaTypes but preserve recent RELOAD_MEDIA_SLOT overrides
          if (data.mediaTypes) {
            const now = Date.now()
            for (const [slot, type] of Object.entries(data.mediaTypes)) {
              const overrideTime = recentSlotOverrides[slot]
              if (overrideTime && now - overrideTime < 5000) continue
              mediaState.types[slot] = type
            }
            for (const slot of Object.keys(mediaState.types)) {
              if (!(slot in data.mediaTypes) && !recentSlotOverrides[slot]) {
                delete mediaState.types[slot]
              }
            }
          }
          patchAllImages()
        }
        import.meta.hot.on('media-versions-update', handleMediaVersionsUpdate)
        import.meta.hot.dispose(() => {
          import.meta.hot!.off('media-versions-update', handleMediaVersionsUpdate)
        })
      }
    }

    // Reload images for a specific media slot by adding cache-busting timestamp.
    // When isVideo is true, replace <img> elements with <video> elements.
    // Check if an element matches a media slot by src URL or data-slot attribute
    function matchesMediaSlot(src: string, el: HTMLElement, imagePattern: string, videoPattern: string): boolean {
      if (src.includes(imagePattern) || src.includes(videoPattern)) return true
      // Also check the raw attribute (property .src is resolved to absolute but getAttribute preserves original)
      const rawSrc = el.getAttribute('src') || ''
      if (rawSrc.includes(imagePattern) || rawSrc.includes(videoPattern)) return true
      // Also match elements created by airo-video-slots.js (direct CDN URLs with data-slot)
      const dataSlot = el.getAttribute('data-slot')
      if (dataSlot === imagePattern.replace('/airo-assets/images/', '')) return true
      if (dataSlot === videoPattern.replace('/airo-assets/videos/', '')) return true
      return false
    }

    function reloadMediaSlot(slotPath: string, isVideo?: boolean) {
      const timestamp = Date.now()
      const imageSlotPattern = `/airo-assets/images/${slotPath}`
      const videoSlotPattern = `/airo-assets/videos/${slotPath}`

      // Mark this slot as explicitly updated to prevent HMR file-watcher from reverting it
      recentSlotOverrides[slotPath] = timestamp

      // Update mediaTypes immediately so future MutationObserver patches use the right type.
      // This is critical for carousel slides that aren't in the DOM yet — when the user
      // navigates to them, React creates a new <img> and the observer calls patchImageElement,
      // which checks mediaTypes to decide whether to add a video sibling.
      if (isVideo) {
        mediaState.types[slotPath] = 'video'
      } else if (mediaState.types[slotPath] === 'video') {
        mediaState.types[slotPath] = 'image'
      }

      // Reload <img> elements — or add <video> sibling for video slots
      document.querySelectorAll<HTMLImageElement>('img').forEach((img) => {
        if (matchesMediaSlot(img.src, img, imageSlotPattern, videoSlotPattern)) {
          if (isVideo) {
            // Remove existing video sibling if any
            const existingVideo = img.nextElementSibling
            if (existingVideo?.hasAttribute('data-airo-video')) {
              existingVideo.remove()
            }
            img.removeAttribute('data-airo-video-patched')
            img.style.display = ''
            // Create video sibling
            const videoUrl = new URL(window.location.origin + videoSlotPattern)
            videoUrl.searchParams.set('_t', String(timestamp))
            insertVideoSibling(img, videoUrl.toString(), slotPath)
          } else {
            // Un-hide img if it was patched, remove video sibling
            if (img.getAttribute('data-airo-video-patched')) {
              const videoSibling = img.nextElementSibling
              if (videoSibling?.hasAttribute('data-airo-video')) {
                videoSibling.remove()
              }
              img.removeAttribute('data-airo-video-patched')
              img.style.display = ''
            }
            // Remove ?src= so the proxy resolves from the manifest's updated currentUrl
            // instead of re-serving the old URL that was baked into the DOM by React.
            const url = new URL(img.src)
            url.searchParams.delete('src')
            url.searchParams.set('_t', String(timestamp))
            img.src = url.toString()
          }
        }
      })

      // Reload <video> elements
      document.querySelectorAll<HTMLVideoElement>('video').forEach((video) => {
        if (matchesMediaSlot(video.src || '', video, imageSlotPattern, videoSlotPattern)) {
          if (!isVideo) {
            // Slot changed from video to image — remove video, un-hide img if present
            const prevImg = video.previousElementSibling as HTMLElement | null
            if (prevImg?.tagName === 'IMG' && prevImg.getAttribute('data-airo-video-patched')) {
              prevImg.removeAttribute('data-airo-video-patched')
              prevImg.style.display = ''
              const url = new URL(prevImg.getAttribute('src') || window.location.origin + imageSlotPattern)
              url.searchParams.set('_t', String(timestamp))
              ;(prevImg as HTMLImageElement).src = url.toString()
            } else if (!video.hasAttribute('data-airo-bg-video')) {
              // Agent wrote <video> directly (no hidden img sibling) — replace with <img>
              const img = document.createElement('img')
              const imgUrl = new URL(window.location.origin + imageSlotPattern)
              imgUrl.searchParams.set('_t', String(timestamp))
              img.src = imgUrl.toString()
              img.className = video.className
              img.style.cssText = video.style.cssText
              img.alt = video.getAttribute('aria-label') || ''
              video.parentNode?.replaceChild(img, video)
              return // skip video.remove() below since replaceChild already removed it
            }
            video.remove()
          } else {
            const url = new URL(video.src)
            url.pathname = videoSlotPattern
            url.searchParams.set('_t', String(timestamp))
            video.src = url.toString()
            video.load()
          }
        }
      })

      // Reload CSS background images — or replace with video for video slots
      // Query inline-style backgrounds + already-patched elements + common structural elements
      // (covers CSS-class-based background-images that don't appear in inline style attributes)
      const bgCandidates = new Set<HTMLElement>()
      document.querySelectorAll<HTMLElement>('[style*="background"], [data-airo-video-bg-patched]').forEach((el) => bgCandidates.add(el))
      if (isVideo) {
        document.querySelectorAll<HTMLElement>('section, div, header, main, [class*="hero"], [class*="banner"], [class*="background"]').forEach((el) => {
          if (!bgCandidates.has(el)) bgCandidates.add(el)
        })
      }
      bgCandidates.forEach((el) => {
        const bgImage = window.getComputedStyle(el).backgroundImage
        const wasBgPatched = el.getAttribute('data-airo-video-bg-patched') === slotPath
        if (!wasBgPatched && !(bgImage && (bgImage.includes(imageSlotPattern) || bgImage.includes(videoSlotPattern)))) return

        if (isVideo) {
          // Replace background-image with a <video> element filling the container
          const existingBgVideo = el.querySelector<HTMLVideoElement>('video[data-airo-bg-video]')
          if (existingBgVideo) existingBgVideo.remove()
          el.style.backgroundImage = 'none'
          el.setAttribute('data-airo-video-bg-patched', slotPath)
          const videoUrl = new URL(window.location.origin + videoSlotPattern)
          videoUrl.searchParams.set('_t', String(timestamp))
          const video = document.createElement('video')
          video.src = videoUrl.toString()
          video.autoplay = true
          video.muted = true
          video.loop = true
          video.playsInline = true
          video.setAttribute('data-airo-bg-video', '')
          video.setAttribute('data-slot', slotPath)
          video.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:-1;'
          // Ensure parent is positioned so the video fills it
          const pos = window.getComputedStyle(el).position
          if (pos === 'static') el.style.position = 'relative'
          el.insertBefore(video, el.firstChild)
        } else {
          // Remove bg video if slot changed back to image
          const bgVideo = el.querySelector<HTMLVideoElement>('video[data-airo-bg-video]')
          if (bgVideo) {
            bgVideo.remove()
            el.removeAttribute('data-airo-video-bg-patched')
            // Restore background-image with the image slot URL (inline style was set to 'none' during patching)
            const imgUrl = new URL(window.location.origin + imageSlotPattern)
            imgUrl.searchParams.set('_t', String(timestamp))
            el.style.backgroundImage = `url("${imgUrl.toString()}")`
          } else if (wasBgPatched) {
            // Element was marked as patched but video already gone — just restore bg
            el.removeAttribute('data-airo-video-bg-patched')
            const imgUrl = new URL(window.location.origin + imageSlotPattern)
            imgUrl.searchParams.set('_t', String(timestamp))
            el.style.backgroundImage = `url("${imgUrl.toString()}")`
          } else {
            // Normal image bg reload — just cache-bust the URL
            const urlMatch = bgImage.match(/url\(["']?([^"')]+)["']?\)/)
            if (urlMatch?.[1]) {
              const url = new URL(urlMatch[1], window.location.origin)
              url.searchParams.delete('src')
              url.searchParams.set('_t', String(timestamp))
              el.style.backgroundImage = `url("${url.toString()}")`
            }
          }
        }
      })
    }

    // ── Scroll-to-media timing ────────────────────────────────────────────────
    // Single animation-settle constant used for all carousel/scroll waits.
    const ANIMATION_SETTLE_MS = 400

    // Generation token: incremented on every new scrollToMediaSlot call.
    // In-flight timers check this to avoid highlighting for a stale request.
    let scrollGeneration = 0

    /**
     * For state-driven carousels (React state + AnimatePresence) that only render
     * the active slide's image: find a sibling image from the same directory, locate
     * nearby navigation dots/buttons, and click through them until our target appears.
     * Returns true if a carousel was found and navigation was attempted.
     */
    function navigateStateDrivenCarousel(slotPath: string, imagePattern: string, videoPattern: string, gen: number): boolean {
      // Determine the "group prefix" — e.g. "pages/about/portrait-2" → "/airo-assets/images/pages/about/"
      const parts = slotPath.split('/')
      const groupPrefix = `/airo-assets/images/${parts.slice(0, -1).join('/')}/`

      // Find a currently-visible image from the same group
      const siblingImg = Array.from(document.querySelectorAll<HTMLImageElement>('img')).find((img) => {
        const src = img.src || img.getAttribute('src') || ''
        return src.includes(groupPrefix) && !src.includes(imagePattern)
      }) || null

      if (!siblingImg) {
        return false
      }


      // Walk up from the sibling to find the carousel container (look for navigation buttons)
      let carouselContainer: HTMLElement | null = null
      let ancestor: HTMLElement | null = siblingImg.parentElement
      for (let depth = 0; depth < 10 && ancestor && ancestor !== document.body; depth++) {
        // Look for a container that has slide-navigation buttons
        const dots = ancestor.querySelectorAll('button[aria-label^="Slide"]')
        if (dots.length > 1) {
          carouselContainer = ancestor
          break
        }
        // Also look for "Previous"/"Next" button patterns
        const prevNext = ancestor.querySelectorAll('button[aria-label="Previous"], button[aria-label="Next"]')
        if (prevNext.length >= 2) {
          carouselContainer = ancestor
          break
        }
        ancestor = ancestor.parentElement
      }

      if (!carouselContainer) {
        return false
      }

      // Find dot buttons (prefer aria-label="Slide N" pattern)
      const dots = Array.from(carouselContainer.querySelectorAll<HTMLButtonElement>('button[aria-label^="Slide"]'))

      if (dots.length > 0) {
        // Click each dot sequentially until our target image appears
        clickDotsSequentially(dots, 0, imagePattern, videoPattern, slotPath, gen)
        return true
      }

      // Fallback: use Next button repeatedly
      const nextBtn = carouselContainer.querySelector<HTMLButtonElement>('button[aria-label="Next"]')
      if (nextBtn) {
        clickNextRepeatedly(nextBtn, 0, 10, imagePattern, videoPattern, slotPath, gen)
        return true
      }

      return false
    }

    /** Click dot buttons one by one until the target image appears in the DOM */
    function clickDotsSequentially(
      dots: HTMLButtonElement[], dotIndex: number,
      imagePattern: string, videoPattern: string, slotPath: string, gen: number
    ) {
      if (dotIndex >= dots.length) {
        // Exhausted all dots without finding target — send terminal result
        if (window.parent !== window) {
          send({ type: 'MEDIA_SLOT_SCROLL_RESULT', slotPath, totalMatches: 0, currentIndex: -1 })
        }
        return
      }

      dots[dotIndex].click()

      // Wait for animation, then check if target appeared
      setTimeout(() => {
        if (gen !== scrollGeneration) return
        const found = findTargetElement(imagePattern, videoPattern)
        if (found) {
          highlightElement(found, slotPath, 1, 0, gen)
        } else {
          clickDotsSequentially(dots, dotIndex + 1, imagePattern, videoPattern, slotPath, gen)
        }
      }, ANIMATION_SETTLE_MS)
    }

    /** Click Next button repeatedly until target appears or max attempts reached */
    function clickNextRepeatedly(
      btn: HTMLButtonElement, attempt: number, maxAttempts: number,
      imagePattern: string, videoPattern: string, slotPath: string, gen: number
    ) {
      if (attempt >= maxAttempts) {
        // Exhausted max attempts without finding target — send terminal result
        if (window.parent !== window) {
          send({ type: 'MEDIA_SLOT_SCROLL_RESULT', slotPath, totalMatches: 0, currentIndex: -1 })
        }
        return
      }

      btn.click()
      setTimeout(() => {
        if (gen !== scrollGeneration) return
        const found = findTargetElement(imagePattern, videoPattern)
        if (found) {
          highlightElement(found, slotPath, 1, 0, gen)
        } else {
          clickNextRepeatedly(btn, attempt + 1, maxAttempts, imagePattern, videoPattern, slotPath, gen)
        }
      }, ANIMATION_SETTLE_MS)
    }

    /** Check if the target image/video is currently in the DOM */
    function findTargetElement(imagePattern: string, videoPattern: string): HTMLElement | null {
      for (const img of document.querySelectorAll<HTMLImageElement>('img')) {
        if (img.getAttribute('data-airo-video-patched')) continue
        const src = img.src || img.getAttribute('src') || ''
        if (src.includes(imagePattern) || src.includes(videoPattern)) {
          return img
        }
      }
      for (const video of document.querySelectorAll<HTMLVideoElement>('video')) {
        const src = video.src || video.getAttribute('src') || ''
        if (src.includes(imagePattern) || src.includes(videoPattern)) {
          return video
        }
      }
      return null
    }

    /** Scroll to element, show overlay and toolbar */
    function highlightElement(el: HTMLElement, slotPath: string, totalMatches = 1, currentIndex = 0, gen?: number) {
      // Stale request guard: if a newer scroll was triggered, bail out
      if (gen !== undefined && gen !== scrollGeneration) return
      // Report to parent
      if (window.parent !== window) {
        send({ type: 'MEDIA_SLOT_SCROLL_RESULT', slotPath, totalMatches, currentIndex })
      }
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      setTimeout(() => {
        if (gen !== undefined && gen !== scrollGeneration) return
        showSelectionOverlay(el)
        // Synthetic click triggers ElementHoverBar via useImageHoverDetection.
        // bubbles:false prevents the event from reaching <a> wrappers (SPA navigation),
        // but document capture-phase listeners (useImageHoverDetection) still fire.
        el.dispatchEvent(new MouseEvent('click', { bubbles: false, cancelable: true }))
      }, ANIMATION_SETTLE_MS)
    }

    /**
     * Scroll to a media slot element in the preview and highlight it.
     * Handles: <img>, <video>, data-slot video siblings, background-image elements,
     * and elements inside carousels (navigates to the correct slide first).
     */
    function scrollToMediaSlot(slotPath: string, index: number) {
      // Increment generation to invalidate any in-flight timers from prior calls
      const gen = ++scrollGeneration
      const imagePattern = `/airo-assets/images/${slotPath}`
      const videoPattern = `/airo-assets/videos/${slotPath}`

      const matches = collectMediaSlotDomMatches(slotPath)

      if (matches.length === 0) {
        // The element isn't in the DOM. Two possible reasons:
        // 1. Page still loading after navigation (retry once)
        // 2. State-driven carousel (AnimatePresence) only renders the active slide
        //
        // Don't send MEDIA_SLOT_SCROLL_RESULT yet — async carousel/retry will
        // send the definitive result (avoids a brief "0 of 0" flash).
        //
        // For case 2: find a "sibling" image from the same directory (e.g. another
        // pages/about/* image) and click carousel navigation dots near it until
        // our target appears.
        if (index >= 0) {
          // First retry: try navigating a state-driven carousel
          const navigated = navigateStateDrivenCarousel(slotPath, imagePattern, videoPattern, gen)
          if (!navigated) {
            // No sibling carousel found — just retry after delay (case 1)
            setTimeout(() => {
              if (gen !== scrollGeneration) return
              scrollToMediaSlot(slotPath, -1)
            }, ANIMATION_SETTLE_MS)
          }
        } else {
          // Final retry also found nothing — send terminal "not found" result
          if (window.parent !== window) {
            send({ type: 'MEDIA_SLOT_SCROLL_RESULT', slotPath, totalMatches: 0, currentIndex: -1 })
          }
        }
        return
      }

      // Report count back to parent (only when we found matches —
      // the 0-match case is handled by carousel exhaustion or retry)
      if (window.parent !== window) {
        send({
          type: 'MEDIA_SLOT_SCROLL_RESULT',
          slotPath,
          totalMatches: matches.length,
          currentIndex: index,
        })
      }

      // Clamp index to valid range (use 0 for retry attempts where index is -1)
      const targetIndex = Math.max(0, Math.min(index < 0 ? 0 : index, matches.length - 1))
      const targetEl = matches[targetIndex]

      // Handle carousel: if the element is inside an Embla carousel, navigate to its slide
      const isInCarousel = activateCarouselSlide(targetEl)

      // Scroll into view after a delay (longer for carousels to let animation settle)
      setTimeout(() => {
        if (gen !== scrollGeneration) return
        targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' })

        // Apply the selection overlay and trigger toolbar after scrolling settles
        setTimeout(() => {
          if (gen !== scrollGeneration) return
          showSelectionOverlay(targetEl)
          // Synthetic click triggers ElementHoverBar via useImageHoverDetection.
          // bubbles:false prevents the event from reaching <a> wrappers (SPA navigation),
          // but document capture-phase listeners (useImageHoverDetection) still fire.
          targetEl.dispatchEvent(new MouseEvent('click', { bubbles: false, cancelable: true }))
        }, ANIMATION_SETTLE_MS)
      }, isInCarousel ? ANIMATION_SETTLE_MS : 100)
    }

    /**
     * If the target element is inside an Embla carousel, programmatically
     * navigate the carousel to the slide containing this element.
     * Returns true if the element was inside a carousel.
     * Uses direct transform manipulation — no click simulation.
     */
    function activateCarouselSlide(el: HTMLElement): boolean {
      // DOM structure (from carousel.tsx):
      //   <div role="region" aria-roledescription="carousel">  ← root
      //     <div class="overflow-hidden" ref={carouselRef}>    ← viewport (Embla attaches here)
      //       <div class="flex">                               ← container (slides parent)
      //         <div>slide 1</div>                             ← CarouselItem (direct child)
      //           <div><img .../></div>                        ← nested content


      // Find the carousel viewport by walking UP from the element looking for
      // overflow:hidden that has a direct flex child (Embla's structure)
      let viewport: HTMLElement | null = null
      let container: HTMLElement | null = null
      let ancestor: HTMLElement | null = el.parentElement

      while (ancestor && ancestor !== document.body) {
        const style = window.getComputedStyle(ancestor)
        const overflow = style.overflow
        const overflowX = style.overflowX
        if (overflow === 'hidden' || overflowX === 'hidden') {
          // Check if first child element is a flex container (Embla's scroll container)
          const firstChild = ancestor.firstElementChild as HTMLElement | null
          if (firstChild && window.getComputedStyle(firstChild).display === 'flex') {
            viewport = ancestor
            container = firstChild
            break
          }
        }
        ancestor = ancestor.parentElement
      }

      if (!viewport || !container) {
        return false
      }

      // Find which DIRECT child of the container holds our target element
      const slides = Array.from(container.children) as HTMLElement[]
      let slideIndex = -1
      for (let i = 0; i < slides.length; i++) {
        if (slides[i] === el || slides[i].contains(el)) {
          slideIndex = i
          break
        }
      }


      if (slideIndex < 0) {
        return false
      }

      const targetSlide = slides[slideIndex]
      const viewportRect = viewport.getBoundingClientRect()
      const slideRect = targetSlide.getBoundingClientRect()
      const slideCenter = slideRect.left + slideRect.width / 2
      const viewportCenter = viewportRect.left + viewportRect.width / 2
      // Already showing this slide — skip transform reset (avoids a visible jump to slide 0).
      if (Math.abs(slideCenter - viewportCenter) <= Math.max(2, slideRect.width * 0.05)) {
        return true
      }

      // Calculate transform by measuring actual slide positions.
      // Reset transform momentarily to get accurate measurements,
      // since getBoundingClientRect is affected by the current transform.
      // Note: we don't restore previous values — Embla's JS will reclaim
      // transform control on the next user interaction (drag, resize).
      container.style.transition = 'none'
      container.style.transform = 'translate3d(0px, 0px, 0px)'
      // Force reflow so measurements are accurate
      void container.offsetHeight

      // Now measure the target slide's offset from the container's left edge
      const containerRect = container.getBoundingClientRect()
      const measuredSlideRect = targetSlide.getBoundingClientRect()
      const targetX = -(measuredSlideRect.left - containerRect.left)

      // Apply transform with smooth transition (Embla uses CSS transforms internally)
      container.style.transition = `transform ${ANIMATION_SETTLE_MS}ms ease-out`
      container.style.transform = `translate3d(${targetX}px, 0px, 0px)`

      // Clean up transition property after animation
      setTimeout(() => {
        if (container) container.style.transition = ''
      }, ANIMATION_SETTLE_MS)

      return true
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

    // Sync the compliance-page gate immediately on navigation (NOT inside the
    // debounce): if it lagged, navigating into /privacy or /terms while in edit
    // mode would leave a window where isManagedDoc is still false and the general
    // editor could fire on the surrounding prose. The markup half (hasManagedMarkup)
    // is updated by its own MutationObserver as the new page renders.
    const onNavigate = () => {
      setPathname(window.location.pathname)
      handleNavigation()
    }

    // Intercept pushState/replaceState for SPA navigation detection
    // React Router uses pushState for <Link> clicks, which doesn't fire popstate
    const originalPushState = history.pushState.bind(history)
    const originalReplaceState = history.replaceState.bind(history)
    history.pushState = (...args: Parameters<typeof history.pushState>) => {
      originalPushState(...args)
      onNavigate()
    }
    history.replaceState = (...args: Parameters<typeof history.replaceState>) => {
      originalReplaceState(...args)
      onNavigate()
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
    window.addEventListener('popstate', onNavigate)

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
          setCmsInlineEditEnabled(event.data.cmsInlineEditEnabled === true);
          setIsEditModeActive(true);
          setIsAnnotationModeActive(false);
          window.__airoEditModeActive = true;
          window.dispatchEvent(new CustomEvent('airo:edit-mode-change', { detail: { active: true } }));
          return;
        }
        if (event.data && event.data.type === 'EDIT_MODE_DISABLED') {
          setIsEditModeActive(false);
          window.__airoEditModeActive = false;
          window.dispatchEvent(new CustomEvent('airo:edit-mode-change', { detail: { active: false } }));
          setCarouselSlotEdit(false);
          setCarouselToolbarPause(false);
          resumeEditModeTimers();
          setPausedCarouselCount(0);
          return;
        }
        if (event.data?.type === 'CAROUSEL_SLOT_EDIT') {
          setCarouselSlotEdit(event.data.active === true);
          return;
        }
        if (event.data && event.data.type === 'ANNOTATION_MODE_ENABLED') {
          setIsAnnotationModeActive(true);
          setIsEditModeActive(false);
          window.__airoEditModeActive = false;
          window.dispatchEvent(new CustomEvent('airo:edit-mode-change', { detail: { active: false } }));
          setCarouselSlotEdit(false);
          setCarouselToolbarPause(false);
          resumeEditModeTimers();
          setPausedCarouselCount(0);
          return;
        }
        if (event.data && event.data.type === 'ANNOTATION_MODE_DISABLED') {
          setIsAnnotationModeActive(false);
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
        // Must match SET_SCROLL_GUTTER_MESSAGE_TYPE and coerceScrollGutterPaddingBottom in
        // app/src/app/[market]/commander/components/commanderMobileScroll.ts
        // (dev-tools cannot import from the builder app).
        if (event.data && event.data.type === 'SET_SCROLL_GUTTER') {
          const paddingBottom = typeof event.data.paddingBottom === 'number' ? event.data.paddingBottom : 0;
          document.body.style.paddingBottom = paddingBottom > 0 ? `${paddingBottom}px` : '';
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
            send({
              type: 'VISUAL_CONTEXT_RESPONSE',
              context: cachedContext
            })
          }
        } else if (event.data && event.data.type === 'REQUEST_SCREENSHOT') {
          // Capture and resize screenshot
          captureAndResizeScreenshot().then(screenshot => {
            if (screenshot && window.parent !== window) {
              send({
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
              send({
                type: 'VIEWPORT_SCREENSHOT_RESPONSE',
                screenshot: screenshot
              })
            }
          }).catch((error) => {
            console.error('Viewport eval screenshot: Error capturing:', error)
          })
        } else if (event.data?.type === 'REQUEST_AUDIT') {
          import('../utils/domAudit').then(({ runDomAudit }) => {
            const validRoutes: string[] = event.data.validRoutes ?? []
            const issues = runDomAudit(validRoutes)
            if (window.parent !== window) {
              send({ type: 'AUDIT_RESPONSE', issues })
            }
          }).catch((error) => {
            console.error('Audit: Error running:', error)
            if (window.parent !== window) {
              send({ type: 'AUDIT_RESPONSE', issues: [] })
            }
          })
        } else if (event.data?.type === 'RELOAD_MEDIA_SLOT' && event.data.slotPath) {
          reloadMediaSlot(event.data.slotPath, event.data.isVideo)
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
        } else if (event.data?.type === 'SCROLL_TO_MEDIA_SLOT' && event.data.slotPath) {
          scrollToMediaSlot(event.data.slotPath, event.data.index ?? 0)
        }
      } catch (error) {
        console.error('[DevTools] Message handler error:', error, 'Message type:', event.data?.type)

        // Send error response only for visual context requests (not font/theme preview errors)
        if (window.parent !== window && event.data?.type === 'REQUEST_VISUAL_CONTEXT') {
          send({
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
      window.removeEventListener('popstate', onNavigate)
      document.removeEventListener('DOMContentLoaded', setupSectionObserver)
      if (scrollTimeout) clearTimeout(scrollTimeout)
      if (resizeTimeout) clearTimeout(resizeTimeout)
      if (navigationTimeout) clearTimeout(navigationTimeout)
    }
  }, [])

  useEffect(() => {
    if (isEditModeActive) return

    const handlePreviewClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null
      if (!target) return
      // Managed compliance docs restrict editing to compliance fields; don't
      // prompt the builder to enter general edit mode from a click here.
      if (isManagedPath() && hasManagedDocMarkup()) return
      if (isClickable(target)) return
      if (isInsideNavSurface(target)) return
      if (isDevToolsElement(target)) return
      if (FORM_TAGS.has(target.tagName.toLowerCase())) return
      if (window.parent === window) return
      send({ type: 'EDITABLE_ELEMENT_CLICKED_IN_PREVIEW', tagName: target.tagName.toLowerCase() })
    }

    document.addEventListener('click', handlePreviewClick, true)
    return () => document.removeEventListener('click', handlePreviewClick, true)
  }, [isEditModeActive])

  // Track whether the current page is a real managed compliance doc (carries the
  // compliance markup). Re-checked on every DOM mutation so it stays correct
  // across SPA navigation and async/HMR renders.
  useEffect(() => {
    const check = () => setHasManagedMarkup(hasManagedDocMarkup())
    check()
    const observer = new MutationObserver(check)
    observer.observe(document.body, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [])

  useEffect(function syncPausedCarouselCountOnSlotEdit() {
    const refresh = (): void => {
      setPausedCarouselCount(getPausedCarouselTimerCount())
    }
    window.addEventListener('airo:carousel-slot-edit', refresh)
    return () => window.removeEventListener('airo:carousel-slot-edit', refresh)
  }, [])

  useEffect(function bindCarouselSlotPanelSyncOnMount() {
    return bindCarouselSlotPanelSync()
  }, [])

  return (
    <div data-airo-dev-tools>
      {isEditModeActive && !isManagedDoc && effectiveElement && !(isMultiSelectActive && effectiveElement.element.hasAttribute("data-ai-selected-num")) && (
        <ElementHoverBar
          hoveredElement={effectiveElement}
          isMultiSelectActive={isMultiSelectActive}
          toolbarMode={toolbarMode}
          setToolbarMode={setToolbarMode}
          onMouseEnter={handleBarMouseEnter}
          onMouseLeave={handleBarMouseLeave}
          onQuickEditModeChange={setQuickEditActive}
        />
      )}
      <AnnotationMode isActive={isAnnotationModeActive} />
      {isEditModeActive && <CarouselSlotEditNav />}
      {isEditModeActive && pausedCarouselCount > 0 && (
        <button
          type="button"
          data-airo-non-editable=""
          onClick={() => advancePausedCarouselTimers()}
          aria-label="Advance auto-rotating carousels by one slide"
          style={{
            position: 'fixed',
            bottom: 24,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 2147483647,
            pointerEvents: 'auto',
            padding: '8px 16px',
            borderRadius: 9999,
            background: 'rgba(0, 0, 0, 0.78)',
            color: '#fff',
            border: 'none',
            font: '500 13px system-ui, -apple-system, sans-serif',
            boxShadow: '0 6px 20px rgba(0,0,0,0.25)',
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <span>Next slide</span>
          <span aria-hidden="true">›</span>
        </button>
      )}
    </div>
  )
}
