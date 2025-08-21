'use client'

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
    isEnabled: false,
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
      document.body.removeChild(overlayEl)
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
    const borderColor = type === 'hover' ? '#3b82f6' : '#ef4444'
    const backgroundColor = type === 'hover' ? 'rgba(59, 130, 246, 0.1)' : 'transparent'

    overlay.innerHTML = `
      <div style="
        position: absolute;
        top: ${rect.top}px;
        left: ${rect.left}px;
        width: ${rect.width}px;
        height: ${rect.height}px;
        background: ${backgroundColor};
        border: 2px solid ${borderColor};
        pointer-events: none;
        box-sizing: border-box;
      "></div>
    `
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
    
    let top = rect.bottom + 10 // Default: below element
    let left = rect.left
    
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
    if (target.id === 'dev-mode-overlay' || target.closest('#dev-mode-overlay')) return
    
    setState(prev => ({ ...prev, hoveredElement: target }))
    highlightElement(target, 'hover')
  }, [state.isSelectMode, highlightElement])

  // Handle element click
  const handleClick = useCallback((e: MouseEvent) => {
    if (!state.isSelectMode) return
    
    e.preventDefault()
    e.stopPropagation()
    
    const target = e.target as HTMLElement
    if (target.id === 'dev-mode-overlay' || target.closest('#dev-mode-overlay')) return
    
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
    
    // Send selection to parent
    window.parent.postMessage({
      type: 'ELEMENT_SELECTED',
      data: elementInfo
    }, '*')
    
    // Element selected successfully
    void elementInfo
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

  // Setup event listeners
  useEffect(() => {
    if (!state.isSelectMode && !state.selectedElement) {
      document.removeEventListener('mouseover', handleMouseOver)
      document.removeEventListener('click', handleClick)
      document.removeEventListener('mouseleave', handleMouseLeave)
      clearHighlight()
      return
    }
    
    // Keep highlighting the selected element even when not in select mode
    if (state.selectedElement && !state.isSelectMode) {
      const element = findElement(state.selectedElement)
      if (element) {
        highlightElement(element, 'select')
      }
      return
    }

    if (!state.isSelectMode) {
      return
    }

    document.addEventListener('mouseover', handleMouseOver)
    document.addEventListener('click', handleClick)
    document.addEventListener('mouseleave', handleMouseLeave)

    return () => {
      document.removeEventListener('mouseover', handleMouseOver)
      document.removeEventListener('click', handleClick)
      document.removeEventListener('mouseleave', handleMouseLeave)
    }
  }, [state.isSelectMode, state.selectedElement, clearHighlight, handleMouseOver, handleClick, handleMouseLeave, highlightElement])

  // Listen for messages from parent
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

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [state.isSelectMode, state.selectedElement?.dataId, clearHighlight])

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
    clearSelection: () => {
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
    }
  }
}
