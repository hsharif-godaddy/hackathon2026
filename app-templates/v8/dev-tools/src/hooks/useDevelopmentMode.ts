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
  isInlineEditing: boolean
  editingElement: HTMLElement | null
}

export function useDevelopmentMode() {
  const [state, setState] = useState<DevelopmentModeState>({
    isEnabled: true, // Auto-enable in development
    isSelectMode: false,
    selectedElement: null,
    hoveredElement: null,
    showEditor: false,
    editorPosition: null,
    isInlineEditing: false,
    editingElement: null
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
    let devContext = element.hasAttribute('data-dev-file') ? {
      fileName: element.getAttribute('data-dev-file') || 'unknown',
      componentName: element.getAttribute('data-dev-component') || 'unknown',
      lineNumber: parseInt(element.getAttribute('data-dev-line') || '0', 10)
    } : undefined

    // Fallback: Check parent elements for dev context
    if (!devContext) {
      let parentElement = element.parentElement
      while (parentElement && parentElement !== document.body) {
        if (parentElement.hasAttribute('data-dev-file')) {
          devContext = {
            fileName: parentElement.getAttribute('data-dev-file') || 'unknown',
            componentName: parentElement.getAttribute('data-dev-component') || 'unknown',
            lineNumber: parseInt(parentElement.getAttribute('data-dev-line') || '0', 10)
          }
          console.log('🔍 Found dev context from parent element:', devContext)
          break
        }
        parentElement = parentElement.parentElement
      }
    }

    // Ultimate fallback: Provide default context for main page elements
    if (!devContext) {
      devContext = {
        fileName: 'src/frontend/pages/index.page.tsx',
        componentName: 'HomePage',
        lineNumber: 1
      }
      console.log('⚠️ Using fallback dev context for element:', element.tagName, element.className, devContext)
    }

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
    // Don't highlight during text editing or when not in select mode
    if (!state.isSelectMode || state.isInlineEditing) return

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
  }, [state.isSelectMode, state.isInlineEditing, highlightElement])

  // Handle element click
  const handleClick = useCallback((e: MouseEvent) => {
    // Don't handle clicks during text editing or when not in select mode
    if (!state.isSelectMode || state.isInlineEditing) return

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
  }, [state.isSelectMode, state.isInlineEditing, highlightElement, createElementInfo, calculateEditorPosition])

  // Handle mouse leave
  const handleMouseLeave = useCallback(() => {
    // Don't handle mouse leave during text editing or when not in select mode
    if (!state.isSelectMode || state.isInlineEditing) return
    setState(prev => ({ ...prev, hoveredElement: null }))
    if (state.selectedElement) {
      const element = document.querySelector(state.selectedElement.selector) as HTMLElement
      if (element) {
        highlightElement(element, 'select')
      }
    } else {
      clearHighlight()
    }
  }, [state.isSelectMode, state.isInlineEditing, state.selectedElement, clearHighlight, highlightElement])

  // Handle scroll events to update highlight position and editor position
  const handleScroll = useCallback(() => {
    if (state.selectedElement && !state.isInlineEditing) {
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
  }, [state.selectedElement, state.showEditor, state.isInlineEditing, highlightElement, calculateEditorPosition])

  // Setup event listeners
  useEffect(() => {
    // Always clean up existing listeners first
    document.removeEventListener('mouseover', handleMouseOver)
    document.removeEventListener('click', handleClick)
    document.removeEventListener('mouseleave', handleMouseLeave)
    window.removeEventListener('scroll', handleScroll)

    // Keep highlighting the selected element even when not in select mode
    // BUT NOT when inline editing is active (to avoid double boundary)
    if (state.selectedElement && !state.isSelectMode && !state.isInlineEditing) {
      const element = findElement(state.selectedElement)
      if (element) {
        highlightElement(element, 'select')
      }
      // Add scroll listener for selected element only
      window.addEventListener('scroll', handleScroll)
      return () => {
        window.removeEventListener('scroll', handleScroll)
      }
    }

    // Only add interactive event listeners when actively in select mode
    if (state.isSelectMode) {
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
    }

    // If not in select mode and no selected element, clear highlighting
    if (!state.selectedElement) {
      clearHighlight()
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
      editorPosition: null,
      isInlineEditing: false,
      editingElement: null
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

    // Stop inline editing if active
    if (state.isInlineEditing && state.editingElement) {
      const element = state.editingElement
      const originalText = element.getAttribute('data-original-text') || ''

      // Restore original text
      element.textContent = originalText

      // Remove editing styles and attributes
      element.contentEditable = 'false'
      element.style.outline = ''
      element.style.backgroundColor = ''
      element.removeAttribute('data-original-text')
      element.removeAttribute('data-inline-editing')

      // Remove event listeners by cloning the element
      const newElement = element.cloneNode(true) as HTMLElement
      element.parentNode?.replaceChild(newElement, element)
    }

    setState(prev => ({
      ...prev,
      selectedElement: null,
      showEditor: false,
      editorPosition: null,
      isInlineEditing: false,
      editingElement: null
    }))
    clearHighlight()
  }, [state.selectedElement?.dataId, state.isInlineEditing, state.editingElement, clearHighlight])

  // Check if element is suitable for text editing
  const isTextEditable = useCallback((element: HTMLElement): boolean => {
    const tagName = element.tagName.toLowerCase()
    const textContent = element.textContent?.trim() || ''

    // Suitable elements: text containers with actual text content
    const textTags = ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'span', 'div', 'a', 'button', 'label']
    const hasText = textContent.length > 0
    const hasOnlyText = element.children.length === 0 ||
      Array.from(element.children).every(child =>
        child.tagName.toLowerCase() === 'br' ||
        child.tagName.toLowerCase() === 'span'
      )

    return textTags.includes(tagName) && hasText && hasOnlyText
  }, [])

  // Start inline editing
  const startInlineEditing = useCallback(() => {
    if (!state.selectedElement) return

    const element = findElement(state.selectedElement)
    if (!element || !isTextEditable(element)) return

    console.log('🖊️ Starting inline editing for element:', element.tagName, element.textContent?.slice(0, 50))

    // Clear the selection highlight immediately and ensure it stays cleared
    clearHighlight()

    // Remove any existing selection highlighting from the element
    const devHighlight = document.getElementById('dev-highlight')
    if (devHighlight) {
      devHighlight.style.display = 'none'
    }

    // Store original text content
    const originalText = element.textContent || ''
    element.setAttribute('data-original-text', originalText)
    element.setAttribute('data-inline-editing', 'true')

    // Make element editable with distinct styling (no boundary overlap)
    element.contentEditable = 'true'
    element.style.outline = '2px solid #10b981'  // Green outline for text editing
    element.style.backgroundColor = 'rgba(16, 185, 129, 0.1)'  // Light green background
    element.style.borderRadius = '6px'
    element.style.padding = '6px 12px'
    element.style.boxShadow = '0 0 0 1px rgba(16, 185, 129, 0.2)'

    // Focus and select all text
    element.focus()

    // Select all text content
    const range = document.createRange()
    range.selectNodeContents(element)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)

    setState(prev => ({
      ...prev,
      isInlineEditing: true,
      editingElement: element,
      showEditor: false // Hide style editor during text editing
    }))

    // Define inline save function to avoid circular dependencies
    const saveInlineEdit = () => {
      console.log('💾 Saving inline edit changes')
      const currentText = element.textContent || ''
      const originalTextAttr = element.getAttribute('data-original-text') || ''

      // Remove all editing styles and attributes completely
      element.contentEditable = 'false'
      element.style.outline = ''
      element.style.backgroundColor = ''
      element.style.borderRadius = ''
      element.style.padding = ''
      element.style.boxShadow = ''
      element.removeAttribute('data-original-text')
      element.removeAttribute('data-inline-editing')

      // Clear any remaining inline styles to avoid JSX syntax issues
      if (element.style.cssText.trim()) {
        console.log('🧹 Clearing remaining inline styles to avoid JSX issues:', element.style.cssText)
        element.removeAttribute('style')
      }

      // Send text change message to parent if text actually changed
      if (currentText !== originalTextAttr) {
        console.log('📝 Text changed from:', originalTextAttr, 'to:', currentText)
        console.log('📤 Sending TEXT_UPDATED message with devContext:', state.selectedElement?.devContext)

        if (window.parent !== window) {
          window.parent.postMessage({
            type: 'TEXT_UPDATED',
            data: {
              selector: state.selectedElement?.selector,
              oldText: originalTextAttr,
              newText: currentText,
              devContext: state.selectedElement?.devContext
            }
          }, '*')
          console.log('✅ TEXT_UPDATED message sent successfully')
        } else {
          console.log('⚠️ Not in iframe context, cannot send message to parent')
        }
      } else {
        console.log('📝 No text changes detected')
      }

      setState(prev => ({
        ...prev,
        isInlineEditing: false,
        editingElement: null,
        showEditor: true // Show style editor again
      }))

      // Re-highlight the element after a brief delay to ensure clean transition
      setTimeout(() => {
        if (state.selectedElement) {
          const updatedElement = findElement(state.selectedElement)
          if (updatedElement) {
            highlightElement(updatedElement, 'select')
          }
        }
      }, 150)
    }

    // Define inline cancel function
    const cancelInlineEdit = () => {
      console.log('❌ Cancelling inline edit')
      const originalTextAttr = element.getAttribute('data-original-text') || ''

      // Restore original text
      element.textContent = originalTextAttr

      // Remove all editing styles and attributes completely
      element.contentEditable = 'false'
      element.style.outline = ''
      element.style.backgroundColor = ''
      element.style.borderRadius = ''
      element.style.padding = ''
      element.style.boxShadow = ''
      element.removeAttribute('data-original-text')
      element.removeAttribute('data-inline-editing')

      // Clear any remaining inline styles to avoid JSX syntax issues
      if (element.style.cssText.trim()) {
        console.log('🧹 Clearing remaining inline styles to avoid JSX issues:', element.style.cssText)
        element.removeAttribute('style')
      }

      setState(prev => ({
        ...prev,
        isInlineEditing: false,
        editingElement: null,
        showEditor: true // Show style editor again
      }))

      // Re-highlight the element after a brief delay to ensure clean transition
      setTimeout(() => {
        if (state.selectedElement) {
          const updatedElement = findElement(state.selectedElement)
          if (updatedElement) {
            highlightElement(updatedElement, 'select')
          }
        }
      }, 150)
    }

    // Add event listeners for saving changes
    const handleKeyDown = (e: KeyboardEvent) => {
      console.log('⌨️ Key pressed during inline editing:', e.key, 'Shift:', e.shiftKey)
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        e.stopPropagation()
        element.removeEventListener('keydown', handleKeyDown)
        element.removeEventListener('blur', handleBlur)
        saveInlineEdit()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        element.removeEventListener('keydown', handleKeyDown)
        element.removeEventListener('blur', handleBlur)
        cancelInlineEdit()
      }
    }

    const handleBlur = (e: FocusEvent) => {
      // Don't save on blur if user clicked on another dev tool element
      const relatedTarget = e.relatedTarget as HTMLElement
      if (relatedTarget && relatedTarget.closest('[data-dev-tools]')) {
        return
      }

      console.log('👁️ Element blurred, saving changes')
      element.removeEventListener('keydown', handleKeyDown)
      element.removeEventListener('blur', handleBlur)
      saveInlineEdit()
    }

    element.addEventListener('keydown', handleKeyDown)
    element.addEventListener('blur', handleBlur)

    // Store event listeners for cleanup
    element.setAttribute('data-inline-editing', 'true')
  }, [state.selectedElement, isTextEditable, highlightElement])

  // Stop inline editing and save changes (legacy - main logic moved to startInlineEditing)
  const stopInlineEditing = useCallback(() => {
    console.log('⚠️ Legacy stopInlineEditing called - this should not happen in normal flow')
    if (!state.isInlineEditing || !state.editingElement) return

    setState(prev => ({
      ...prev,
      isInlineEditing: false,
      editingElement: null,
      showEditor: true
    }))
  }, [state.isInlineEditing, state.editingElement])

  // Cancel inline editing (legacy - main logic moved to startInlineEditing)
  const cancelInlineEditing = useCallback(() => {
    console.log('⚠️ Legacy cancelInlineEditing called - this should not happen in normal flow')
    if (!state.isInlineEditing || !state.editingElement) return

    setState(prev => ({
      ...prev,
      isInlineEditing: false,
      editingElement: null,
      showEditor: true
    }))
  }, [state.isInlineEditing, state.editingElement])

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
            editorPosition: null,
            isInlineEditing: false,
            editingElement: null
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
            editorPosition: null,
            isInlineEditing: false,
            editingElement: null
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
    toggleSelectMode,
    isTextEditable,
    startInlineEditing,
    stopInlineEditing,
    cancelInlineEditing
  }
}
