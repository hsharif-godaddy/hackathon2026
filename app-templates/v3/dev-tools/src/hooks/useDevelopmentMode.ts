import { useEffect, useState, useCallback } from 'react'

interface SelectedElement {
  tagName: string
  className: string
  id: string
  textContent: string
  computedStyles: Record<string, string>
  rect: {
    top: number
    left: number
    width: number
    height: number
  }
  selector: string
  dataId?: string
  // Development context for saving changes back to disk
  devContext?: {
    fileName: string
    componentName: string
    lineNumber: number
  }
}

interface DevelopmentModeState {
  isEnabled: boolean
  isSelectMode: boolean
  selectedElement: SelectedElement | null
  hoveredElement: HTMLElement | null
  showEditor: boolean
  editorPosition: { top: number; left: number } | null
}

export function useDevelopmentMode() {
  const [state, setState] = useState<DevelopmentModeState>({
    isEnabled: true, // Auto-enable in development
    isSelectMode: false,
    selectedElement: null,
    hoveredElement: null,
    showEditor: false,
    editorPosition: null
  })

  const [overlay, setOverlay] = useState<HTMLDivElement | null>(null)

  // Initialize overlay element
  useEffect(() => {
    const overlayEl = document.createElement('div')
    overlayEl.id = 'dev-mode-overlay'
    overlayEl.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: 9999;
      background: transparent;
    `
    document.body.appendChild(overlayEl)
    setOverlay(overlayEl)

    return () => {
      if (document.body.contains(overlayEl)) {
        document.body.removeChild(overlayEl)
      }
    }
  }, [])

  // Generate CSS selector for element
  const generateSelector = (element: HTMLElement): string => {
    if (element.id) {
      return `#${element.id}`
    }
    
    let selector = element.tagName.toLowerCase()
    
    if (element.className) {
      // Filter out pseudo-class prefixes and only keep valid CSS class names
      const classes = element.className.split(' ')
        .filter(c => c.trim())
        .filter(c => !c.includes(':')) // Remove Tailwind pseudo-classes like hover:, focus:, etc.
        .map(c => c.replace(/[^\w-]/g, '')) // Remove any invalid characters
        .filter(c => c.length > 0)
      
      if (classes.length > 0) {
        selector += '.' + classes.join('.')
      }
    }
    
    // Add position if needed to make it unique
    const parent = element.parentElement
    if (parent) {
      const siblings = Array.from(parent.children).filter(
        child => child.tagName === element.tagName
      )
      if (siblings.length > 1) {
        const index = siblings.indexOf(element) + 1
        selector += `:nth-of-type(${index})`
      }
    }
    
    return selector
  }

  // Get computed styles for element
  const getRelevantStyles = (element: HTMLElement): Record<string, string> => {
    const computed = window.getComputedStyle(element)
    const relevantProps = [
      'color', 'backgroundColor', 'fontSize', 'fontFamily', 'fontWeight',
      'margin', 'padding', 'border', 'borderRadius', 'width', 'height',
      'display', 'position', 'top', 'left', 'right', 'bottom',
      'flexDirection', 'justifyContent', 'alignItems', 'gap'
    ]
    
    const styles: Record<string, string> = {}
    relevantProps.forEach(prop => {
      styles[prop] = computed.getPropertyValue(prop)
    })
    
    return styles
  }

  // Create element info from DOM element
  const createElementInfo = useCallback((element: HTMLElement): SelectedElement => {
    const rect = element.getBoundingClientRect()
    
    // Add a unique data attribute for reliable tracking
    const uniqueId = `dev-selected-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    element.setAttribute('data-dev-selected', uniqueId)
    
    // Extract development context from compile-time injected data attributes
    const devContext = element.hasAttribute('data-dev-file') ? {
      fileName: element.getAttribute('data-dev-file') || 'unknown',
      componentName: element.getAttribute('data-dev-component') || 'unknown',
      lineNumber: parseInt(element.getAttribute('data-dev-line') || '0', 10)
    } : undefined
    
    const elementInfo = {
      tagName: element.tagName.toLowerCase(),
      className: element.className,
      id: element.id,
      textContent: element.textContent?.slice(0, 100) || '',
      computedStyles: getRelevantStyles(element),
      rect: {
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height
      },
      selector: generateSelector(element),
      dataId: uniqueId, // Store the unique ID for reliable element finding
      devContext // Include development context for saving changes back to disk
    }
    
    return elementInfo
  }, [])

  // Highlight element with overlay
  const highlightElement = useCallback((element: HTMLElement, type: 'hover' | 'select') => {
    if (!overlay) return

    const rect = element.getBoundingClientRect()
    
    const borderColor = type === 'hover' ? '#3b82f6' : '#000000'
    const backgroundColor = type === 'hover' ? 'rgba(59, 130, 246, 0.1)' : 'transparent'
    const borderStyle = type === 'select' ? 'dashed' : 'solid'

    // Use fixed positioning relative to viewport since overlay is fixed
    overlay.innerHTML = `
      <div id="dev-highlight-box" style="
        position: fixed;
        top: ${rect.top}px;
        left: ${rect.left}px;
        width: ${rect.width}px;
        height: ${rect.height}px;
        background: ${backgroundColor};
        border: 2px ${borderStyle} ${borderColor};
        pointer-events: none;
        box-sizing: border-box;
        transition: border-color 2s ease-in-out;
      "></div>
    `

    // If this is a selection, start the fade animation
    if (type === 'select') {
      setTimeout(() => {
        const highlightBox = document.getElementById('dev-highlight-box')
        if (highlightBox) {
          highlightBox.style.borderColor = '#9ca3af' // lighter gray
        }
      }, 100) // Small delay to ensure the element is rendered
    }
  }, [overlay])

  // Clear overlay
  const clearHighlight = useCallback(() => {
    if (overlay) {
      overlay.innerHTML = ''
    }
  }, [overlay])

  // Calculate editor position based on element location and viewport
  const calculateEditorPosition = useCallback((element: HTMLElement) => {
    const rect = element.getBoundingClientRect()
    const viewportHeight = window.innerHeight
    const viewportWidth = window.innerWidth
    const editorHeight = 60 // Approximate editor height
    const editorWidth = 400 // Approximate editor width
    
    let top = rect.bottom + 10 // Default: below element (viewport relative)
    let left = rect.left // Align with element left (viewport relative)
    
    // If editor would go below viewport, place above element
    if (top + editorHeight > viewportHeight) {
      top = rect.top - editorHeight - 10
    }
    
    // Ensure editor doesn't go off the right edge
    if (left + editorWidth > viewportWidth) {
      left = viewportWidth - editorWidth - 10
    }
    
    // Ensure editor doesn't go off the left edge
    if (left < 10) {
      left = 10
    }
    
    // Ensure editor doesn't go above viewport
    if (top < 10) {
      top = 10
    }
    
    return { top, left }
  }, [])

  // Find element using multiple strategies
  const findElement = (elementInfo: SelectedElement): HTMLElement | null => {
    // First try the data attribute (most reliable)
    if (elementInfo.dataId) {
      const element = document.querySelector(`[data-dev-selected="${elementInfo.dataId}"]`) as HTMLElement
      if (element) return element
    }
    
    // Fallback to ID
    if (elementInfo.id) {
      const element = document.getElementById(elementInfo.id)
      if (element) return element
    }
    
    // Fallback to clean selector
    try {
      if (elementInfo.selector) {
        const element = document.querySelector(elementInfo.selector) as HTMLElement
        if (element) return element
      }
    } catch (_e) {
      console.warn('Invalid selector:', elementInfo.selector)
    }
    
    // Last resort: find by tag and clean classes
    if (elementInfo.className) {
      const cleanClasses = elementInfo.className.split(' ')
        .filter(c => c.trim() && !c.includes(':'))
        .join('.')
      if (cleanClasses) {
        try {
          const element = document.querySelector(`${elementInfo.tagName}.${cleanClasses}`) as HTMLElement
          if (element) return element
        } catch (_e) {
          console.warn('Could not find element with clean classes')
        }
      }
    }
    
    return null
  }

  // Handle element hover
  const handleMouseOver = useCallback((e: MouseEvent) => {
    if (!state.isSelectMode) return
    
    const target = e.target as HTMLElement
    
    // Ignore dev tools elements
    if (target.id === 'dev-mode-overlay' || 
        target.closest('#dev-mode-overlay') ||
        target.closest('[data-dev-tools]') ||
        target.hasAttribute('data-dev-tools')) {
      return
    }
    
    setState(prev => ({ ...prev, hoveredElement: target }))
    highlightElement(target, 'hover')
  }, [state.isSelectMode, highlightElement])

  // Handle element click
  const handleClick = useCallback((e: MouseEvent) => {
    if (!state.isSelectMode) return
    
    const target = e.target as HTMLElement
    
    // Ignore dev tools elements
    if (target.id === 'dev-mode-overlay' || 
        target.closest('#dev-mode-overlay') ||
        target.closest('[data-dev-tools]') ||
        target.hasAttribute('data-dev-tools')) {
      return
    }
    
    e.preventDefault()
    e.stopPropagation()
    
    const elementInfo = createElementInfo(target)
    const editorPosition = calculateEditorPosition(target)
    
    setState(prev => ({ 
      ...prev, 
      selectedElement: elementInfo,
      isSelectMode: false, // Auto-disable select mode after selection
      showEditor: true,
      editorPosition
    }))
    
    highlightElement(target, 'select')
    
    // Send selection to parent (for iframe context)
    if (window.parent !== window) {
      window.parent.postMessage({
        type: 'ELEMENT_SELECTED',
        data: elementInfo
      }, '*')
    }
  }, [state.isSelectMode, highlightElement, createElementInfo, calculateEditorPosition])

  // Handle mouse leave
  const handleMouseLeave = useCallback(() => {
    if (!state.isSelectMode) return
    setState(prev => ({ ...prev, hoveredElement: null }))
    if (state.selectedElement) {
      const element = document.querySelector(state.selectedElement.selector) as HTMLElement
      if (element) {
        highlightElement(element, 'select')
      }
    } else {
      clearHighlight()
    }
  }, [state.isSelectMode, state.selectedElement, clearHighlight, highlightElement])

  // Handle scroll events to update highlight position and editor position
  const handleScroll = useCallback(() => {
    if (state.selectedElement) {
      const element = findElement(state.selectedElement)
      if (element) {
        highlightElement(element, 'select')
        
        // Also update editor position if it's showing
        if (state.showEditor) {
          const newEditorPosition = calculateEditorPosition(element)
          setState(prev => ({ 
            ...prev, 
            editorPosition: newEditorPosition
          }))
        }
      }
    }
  }, [state.selectedElement, state.showEditor, highlightElement, calculateEditorPosition])

  // Setup event listeners
  useEffect(() => {
    if (!state.isSelectMode && !state.selectedElement) {
      document.removeEventListener('mouseover', handleMouseOver)
      document.removeEventListener('click', handleClick)
      document.removeEventListener('mouseleave', handleMouseLeave)
      window.removeEventListener('scroll', handleScroll)
      clearHighlight()
      return
    }
    
    // Keep highlighting the selected element even when not in select mode
    if (state.selectedElement && !state.isSelectMode) {
      const element = findElement(state.selectedElement)
      if (element) {
        highlightElement(element, 'select')
      }
      // Add scroll listener for selected element
      window.addEventListener('scroll', handleScroll)
      return () => {
        window.removeEventListener('scroll', handleScroll)
      }
    }

    if (!state.isSelectMode) {
      return
    }

    document.addEventListener('mouseover', handleMouseOver)
    document.addEventListener('click', handleClick)
    document.addEventListener('mouseleave', handleMouseLeave)
    window.addEventListener('scroll', handleScroll)

    return () => {
      document.removeEventListener('mouseover', handleMouseOver)
      document.removeEventListener('click', handleClick)
      document.removeEventListener('mouseleave', handleMouseLeave)
      window.removeEventListener('scroll', handleScroll)
    }
  }, [state.isSelectMode, state.selectedElement, clearHighlight, handleMouseOver, handleClick, handleMouseLeave, handleScroll, highlightElement])

  // Public API for direct control (non-iframe usage)
  const enableDevelopmentMode = useCallback(() => {
    setState(prev => ({ ...prev, isEnabled: true }))
  }, [])

  const disableDevelopmentMode = useCallback(() => {
    setState(prev => ({ 
      ...prev, 
      isEnabled: false, 
      isSelectMode: false, 
      selectedElement: null,
      hoveredElement: null,
      showEditor: false,
      editorPosition: null
    }))
    clearHighlight()
  }, [clearHighlight])

  const toggleSelectMode = useCallback(() => {
    setState(prev => ({ 
      ...prev, 
      isSelectMode: !prev.isSelectMode,
      isEnabled: true,
      showEditor: false // Hide editor when entering select mode
    }))
    if (state.isSelectMode) {
      clearHighlight()
    }
  }, [state.isSelectMode, clearHighlight])

  const clearSelection = useCallback(() => {
    // Remove data attribute from previously selected element
    if (state.selectedElement?.dataId) {
      const element = document.querySelector(`[data-dev-selected="${state.selectedElement.dataId}"]`)
      if (element) {
        element.removeAttribute('data-dev-selected')
      }
    }
    
    setState(prev => ({ 
      ...prev, 
      selectedElement: null,
      showEditor: false,
      editorPosition: null
    }))
    clearHighlight()
  }, [state.selectedElement?.dataId, clearHighlight])

  // Listen for messages from parent (for iframe context) and custom events
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      // Only accept messages from parent window in iframe context
      if (window.parent === window) return
      
      switch (event.data.type) {
        case 'TOGGLE_SELECT_MODE':
          setState(prev => ({ 
            ...prev, 
            isSelectMode: !prev.isSelectMode,
            isEnabled: true,
            showEditor: false // Hide editor when entering select mode
          }))
          if (state.isSelectMode) {
            clearHighlight()
          }
          break
          
        case 'ENABLE_DEV_MODE':
          setState(prev => ({ ...prev, isEnabled: true }))
          break
          
        case 'DISABLE_DEV_MODE':
          setState(prev => ({ 
            ...prev, 
            isEnabled: false, 
            isSelectMode: false, 
            selectedElement: null,
            hoveredElement: null,
            showEditor: false,
            editorPosition: null
          }))
          clearHighlight()
          break
          
        case 'CLEAR_SELECTION':
          // Remove data attribute from previously selected element
          if (state.selectedElement?.dataId) {
            const element = document.querySelector(`[data-dev-selected="${state.selectedElement.dataId}"]`)
            if (element) {
              element.removeAttribute('data-dev-selected')
            }
          }
          
          setState(prev => ({ 
            ...prev, 
            selectedElement: null,
            showEditor: false,
            editorPosition: null
          }))
          clearHighlight()
          break
      }
    }

    // Handle custom events for direct mode (non-iframe)
    const handleToggleSelectMode = () => {
      toggleSelectMode()
    }

    window.addEventListener('message', handleMessage)
    window.addEventListener('toggleDevSelectMode', handleToggleSelectMode)
    
    return () => {
      window.removeEventListener('message', handleMessage)
      window.removeEventListener('toggleDevSelectMode', handleToggleSelectMode)
    }
  }, [state.isSelectMode, state.selectedElement?.dataId, clearHighlight, toggleSelectMode])

  // Add visual indicator when in select mode
  useEffect(() => {
    if (state.isSelectMode) {
      document.body.style.cursor = 'crosshair'
      document.body.style.userSelect = 'none'
    } else {
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [state.isSelectMode])

  return {
    ...state,
    clearSelection,
    enableDevelopmentMode,
    disableDevelopmentMode,
    toggleSelectMode
  }
}
