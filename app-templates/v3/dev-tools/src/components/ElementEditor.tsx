import { useState, useRef, useEffect, useCallback } from 'react'
import {
  FileText,
  Bold,
  Italic,
  ChevronDown,
  X
} from 'lucide-react'

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

interface ElementEditorProps {
  isOpen: boolean
  onClose: () => void
  position: { top: number; left: number } | null
  selectedElement: SelectedElement | null
  _onStyleApply?: (styles: Record<string, string>) => void
}

export default function ElementEditor({ 
  isOpen, 
  onClose, 
  position, 
  selectedElement
}: ElementEditorProps) {
  const [showFontSizeDropdown, setShowFontSizeDropdown] = useState(false)
  const [showColorDropdown, setShowColorDropdown] = useState(false)
  const [showSpacingDropdown, setShowSpacingDropdown] = useState(false)
  const [dropdownPositions, setDropdownPositions] = useState({
    fontSize: 'bottom',
    color: 'bottom',
    spacing: 'bottom'
  })

  const toolbarRef = useRef<HTMLDivElement>(null)

  // Current styles extracted from element classes
  const [currentStyles, setCurrentStyles] = useState({
    fontSize: 'text-base',
    fontWeight: 'font-normal',
    fontStyle: 'font-not-italic',
    color: '#374151',
    backgroundColor: 'transparent',
    marginBottom: '',
    padding: ''
  })

  // Extract current styles and dev context from element
  useEffect(() => {
    if (selectedElement) {
      const element = findElement(selectedElement)
      if (element) {
        const computedStyle = window.getComputedStyle(element)
        const classes = selectedElement.className.split(' ')
        
        setCurrentStyles({
          fontSize: classes.find(c => c.startsWith('text-') && (c.includes('sm') || c.includes('base') || c.includes('lg') || c.includes('xl'))) || 'text-base',
          fontWeight: classes.find(c => c.startsWith('font-') && c.includes('bold')) ? 'font-bold' : 'font-normal',
          fontStyle: classes.find(c => c.startsWith('italic')) ? 'italic' : 'font-not-italic',
          color: computedStyle.color || '#374151',
          backgroundColor: computedStyle.backgroundColor || 'transparent',
          marginBottom: classes.find(c => c.startsWith('mb-')) || '',
          padding: classes.find(c => c.startsWith('p-')) || ''
        })
        
        // Extract and update dev context if not already present
        if (!selectedElement.devContext) {
          const devContext = extractDevContext(element)
          if (devContext) {
            // Update the selected element with dev context
            selectedElement.devContext = devContext
            console.log('🎯 Dev context extracted:', devContext)
          } else {
            console.log('⚠️ No dev context found for element:', element)
          }
        }
      }
    }
  }, [selectedElement])

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (toolbarRef.current && !toolbarRef.current.contains(event.target as Node)) {
        setShowFontSizeDropdown(false)
        setShowColorDropdown(false)
        setShowSpacingDropdown(false)
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  // Calculate if dropdown should open upward or downward
  const calculateDropdownPosition = useCallback((dropdownType: 'fontSize' | 'color' | 'spacing') => {
    if (!toolbarRef.current || !position) return 'bottom'

    const toolbar = toolbarRef.current
    const toolbarRect = toolbar.getBoundingClientRect()
    const viewportHeight = window.innerHeight
    
    // Estimate dropdown heights
    const dropdownHeights = {
      fontSize: 200, // Font size dropdown
      color: 120,    // Color picker
      spacing: 180   // Spacing controls
    }

    const dropdownHeight = dropdownHeights[dropdownType]
    const spaceBelow = viewportHeight - toolbarRect.bottom
    
    if (spaceBelow < dropdownHeight && toolbarRect.top > dropdownHeight) {
      return 'top'
    }
    
    return 'bottom'
  }, [position])

  // Update dropdown positions when toolbar position changes
  useEffect(() => {
    if (isOpen && position) {
      setDropdownPositions({
        fontSize: calculateDropdownPosition('fontSize'),
        color: calculateDropdownPosition('color'),
        spacing: calculateDropdownPosition('spacing')
      })
    }
  }, [isOpen, position, calculateDropdownPosition])

  if (!isOpen || !position) return null

  const fontSizes = [
    { value: 'text-xs', label: '12px' },
    { value: 'text-sm', label: '14px' },
    { value: 'text-base', label: '16px' },
    { value: 'text-lg', label: '18px' },
    { value: 'text-xl', label: '20px' },
    { value: 'text-2xl', label: '24px' },
    { value: 'text-3xl', label: '30px' },
    { value: 'text-4xl', label: '36px' }
  ]

  const colors = [
    { value: '#111827', label: 'Black' },
    { value: '#4B5563', label: 'Gray' },
    { value: '#2563EB', label: 'Blue' },
    { value: '#9333EA', label: 'Purple' },
    { value: '#16A34A', label: 'Green' },
    { value: '#DC2626', label: 'Red' },
    { value: '#D97706', label: 'Orange' },
    { value: '#DB2777', label: 'Pink' }
  ]

  const backgroundColors = [
    { value: 'transparent', label: 'None' },
    { value: '#F3F4F6', label: 'Light Gray' },
    { value: '#DBEAFE', label: 'Light Blue' },
    { value: '#E9D5FF', label: 'Light Purple' },
    { value: '#DCFCE7', label: 'Light Green' },
    { value: '#FEE2E2', label: 'Light Red' },
    { value: '#FEF3C7', label: 'Light Yellow' },
    { value: '#FCE7F3', label: 'Light Pink' }
  ]

  const getCurrentFontSize = () => {
    return fontSizes.find(size => size.value === currentStyles.fontSize)?.label || '16px'
  }

  const getCurrentColor = () => {
    return currentStyles.color || '#374151'
  }

  const getCurrentBgColor = () => {
    return currentStyles.backgroundColor || 'transparent'
  }

  // Extract dev context from boundary wrapper
  const extractDevContext = (element: HTMLElement): SelectedElement['devContext'] | undefined => {
    // Check for boundary wrapper (for components)
    const boundary = element.closest('[data-dev-wrapper="true"]')
    if (boundary) {
      const boundaryFile = boundary.getAttribute('data-dev-file')
      const boundaryLine = boundary.getAttribute('data-dev-line')
      const boundaryComponent = boundary.getAttribute('data-dev-component')
      
      if (boundaryFile && boundaryLine && boundaryComponent) {
        // Clean up the file path for display
        const fileName = boundaryFile.replace(/.*\/src\//, 'src/').replace(/.*\/app\//, 'app/')
        
        return {
          fileName,
          lineNumber: parseInt(boundaryLine, 10),
          componentName: boundaryComponent
        }
      }
    }
    
    // Fallback: check for direct dev attributes on the element itself (for HTML elements)
    const elementFile = element.getAttribute('data-dev-file')
    const elementLine = element.getAttribute('data-dev-line')
    const elementComponent = element.getAttribute('data-dev-component')
    
    if (elementFile && elementLine && elementComponent) {
      // Clean up the file path for display
      const fileName = elementFile.replace(/.*\/src\//, 'src/').replace(/.*\/app\//, 'app/')
      
      return {
        fileName,
        lineNumber: parseInt(elementLine, 10),
        componentName: elementComponent
      }
    }
    
    // Additional fallback: check parent elements for dev attributes
    let currentElement = element.parentElement
    while (currentElement && currentElement !== document.body) {
      const parentFile = currentElement.getAttribute('data-dev-file')
      const parentLine = currentElement.getAttribute('data-dev-line')
      const parentComponent = currentElement.getAttribute('data-dev-component')
      
      if (parentFile && parentLine && parentComponent) {
        const fileName = parentFile.replace(/.*\/src\//, 'src/').replace(/.*\/app\//, 'app/')
        
        return {
          fileName,
          lineNumber: parseInt(parentLine, 10),
          componentName: parentComponent
        }
      }
      
      currentElement = currentElement.parentElement
    }
    
    return undefined
  }

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

  const updateStyle = (property: string, value: string) => {
    const newStyles = { ...currentStyles, [property]: value }
    setCurrentStyles(newStyles)
    
    // Apply the style immediately
    if (selectedElement) {
      const element = findElement(selectedElement)
      
      if (element) {
        // Apply CSS styles directly for colors, keep Tailwind for font sizes and spacing
        switch (property) {
          case 'fontSize':
            // Keep using Tailwind classes for font sizes
            const classes = element.className.split(' ')
            const filteredClasses = classes.filter(c => !c.match(/^text-(xs|sm|base|lg|xl|2xl|3xl|4xl)$/))
            if (value.trim()) {
              filteredClasses.push(value)
            }
            element.className = filteredClasses.join(' ')
            break
            
          case 'fontWeight':
            // Apply CSS style directly
            element.style.fontWeight = value === 'font-bold' ? 'bold' : 'normal'
            break
            
          case 'fontStyle':
            // Apply CSS style directly
            element.style.fontStyle = value === 'italic' ? 'italic' : 'normal'
            break
            
          case 'color':
            // Apply CSS style directly
            element.style.color = value
            break
            
          case 'backgroundColor':
            // Apply CSS style directly
            element.style.backgroundColor = value
            break
            
          case 'marginBottom':
          case 'padding':
            // Keep using Tailwind classes for spacing
            const spacingClasses = element.className.split(' ')
            const prefix = property === 'marginBottom' ? 'mb-' : 'p-'
            const filteredSpacingClasses = spacingClasses.filter(c => !c.startsWith(prefix))
            if (value.trim()) {
              filteredSpacingClasses.push(value)
            }
            element.className = filteredSpacingClasses.join(' ')
            break
        }
        
        // Send message to parent if in iframe
        if (window.parent !== window) {
          window.parent.postMessage({
            type: 'STYLE_UPDATED',
            data: {
              selector: selectedElement.selector,
              property,
              value,
              newClassName: element.className,
              newStyle: element.style.cssText
            }
          }, '*')
        }
      }
    }
  }

  return (
    <div 
      data-dev-tools="element-editor"
      style={{
        position: 'fixed',
        top: position.top,
        left: position.left,
        zIndex: 999997,
        pointerEvents: 'auto'
      }}
    >
      <div 
        ref={toolbarRef}
        style={{ 
          minWidth: '400px',
          backgroundColor: 'rgba(255, 255, 255, 0.98)',
          backdropFilter: 'blur(10px)',
          border: '1px solid rgba(209, 213, 219, 0.8)',
          borderRadius: '8px',
          boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
          padding: '8px',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px'
        }}
      >
        {/* Development Context Info */}
        {selectedElement?.devContext && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '4px 8px',
            fontSize: '12px',
            color: '#6b7280',
            backgroundColor: '#f9fafb',
            borderRadius: '6px',
            border: '1px solid #e5e7eb'
          }}>
            <span>📁</span>
            <span>{selectedElement.devContext.fileName}</span>
            <span>•</span>
            <span>{selectedElement.devContext.componentName}</span>
            <span>•</span>
            <span>L{selectedElement.devContext.lineNumber}</span>
          </div>
        )}
        
        {/* Toolbar Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        {/* Font Size */}
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => {
              setShowFontSizeDropdown(!showFontSizeDropdown)
              setShowColorDropdown(false)
              setShowSpacingDropdown(false)
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              padding: '6px 8px',
              fontSize: '14px',
              color: '#374151',
              backgroundColor: 'transparent',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer'
            }}
            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f3f4f6'}
            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
          >
            <FileText style={{ width: '16px', height: '16px' }} />
            <span>{getCurrentFontSize()}</span>
            <ChevronDown style={{ width: '12px', height: '12px' }} />
          </button>
          
          {showFontSizeDropdown && (
            <div 
              style={{
                position: 'absolute',
                left: '0',
                [dropdownPositions.fontSize === 'top' ? 'bottom' : 'top']: '100%',
                [dropdownPositions.fontSize === 'top' ? 'marginBottom' : 'marginTop']: '4px',
                width: '200px',
                backgroundColor: 'rgba(255, 255, 255, 0.98)',
                backdropFilter: 'blur(10px)',
                border: '1px solid rgba(209, 213, 219, 0.8)',
                borderRadius: '8px',
                boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)',
                zIndex: 10
              }}
            >
              <div style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {/* Size Presets */}
                <div style={{ display: 'flex', gap: '4px' }}>
                  {[
                    { label: 'Small', value: 'text-sm' },
                    { label: 'Medium', value: 'text-base' },
                    { label: 'Large', value: 'text-lg' }
                  ].map((preset) => (
                    <button
                      key={preset.value}
                      onClick={() => {
                        updateStyle('fontSize', preset.value)
                        setShowFontSizeDropdown(false)
                      }}
                      style={{
                        flex: 1,
                        padding: '4px 8px',
                        fontSize: '12px',
                        borderRadius: '4px',
                        border: '1px solid',
                        borderColor: currentStyles.fontSize === preset.value ? '#3b82f6' : '#d1d5db',
                        backgroundColor: currentStyles.fontSize === preset.value ? '#eff6ff' : '#ffffff',
                        color: currentStyles.fontSize === preset.value ? '#2563eb' : '#374151',
                        cursor: 'pointer'
                      }}
                      onMouseEnter={(e) => {
                        if (currentStyles.fontSize !== preset.value) {
                          e.currentTarget.style.backgroundColor = '#f9fafb'
                        }
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = currentStyles.fontSize === preset.value ? '#eff6ff' : '#ffffff'
                      }}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
                
                {/* Fine-tune Slider */}
                <div>
                  <label style={{ display: 'block', fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>Fine-tune</label>
                  <input
                    type="range"
                    min="0"
                    max="7"
                    value={fontSizes.findIndex(size => size.value === currentStyles.fontSize)}
                    onChange={(e) => {
                      const index = parseInt(e.target.value)
                      if (fontSizes[index]) {
                        updateStyle('fontSize', fontSizes[index].value)
                      }
                    }}
                    style={{
                      width: '100%',
                      height: '4px',
                      borderRadius: '8px',
                      appearance: 'none',
                      cursor: 'pointer',
                      background: `linear-gradient(to right, #3b82f6 0%, #3b82f6 ${(fontSizes.findIndex(size => size.value === currentStyles.fontSize) / 7) * 100}%, #e5e7eb ${(fontSizes.findIndex(size => size.value === currentStyles.fontSize) / 7) * 100}%, #e5e7eb 100%)`
                    }}
                  />
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#6b7280', marginTop: '4px' }}>
                    <span>12px</span>
                    <span>36px</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Font Weight */}
        <button
          onClick={() => {
            const newWeight = currentStyles.fontWeight === 'font-bold' ? 'font-normal' : 'font-bold'
            updateStyle('fontWeight', newWeight)
          }}
          style={{
            padding: '6px',
            borderRadius: '6px',
            border: 'none',
            backgroundColor: currentStyles.fontWeight === 'font-bold' ? '#3b82f6' : 'transparent',
            color: currentStyles.fontWeight === 'font-bold' ? 'white' : '#374151',
            cursor: 'pointer'
          }}
          onMouseEnter={(e) => {
            if (currentStyles.fontWeight !== 'font-bold') {
              e.currentTarget.style.backgroundColor = '#f3f4f6'
            }
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = currentStyles.fontWeight === 'font-bold' ? '#3b82f6' : 'transparent'
          }}
        >
          <Bold style={{ width: '16px', height: '16px' }} />
        </button>

        {/* Font Style (Italic) */}
        <button
          onClick={() => {
            const newStyle = currentStyles.fontStyle === 'italic' ? 'font-not-italic' : 'italic'
            updateStyle('fontStyle', newStyle)
          }}
          style={{
            padding: '6px',
            borderRadius: '6px',
            border: 'none',
            backgroundColor: currentStyles.fontStyle === 'italic' ? '#3b82f6' : 'transparent',
            color: currentStyles.fontStyle === 'italic' ? 'white' : '#374151',
            cursor: 'pointer'
          }}
          onMouseEnter={(e) => {
            if (currentStyles.fontStyle !== 'italic') {
              e.currentTarget.style.backgroundColor = '#f3f4f6'
            }
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = currentStyles.fontStyle === 'italic' ? '#3b82f6' : 'transparent'
          }}
        >
          <Italic style={{ width: '16px', height: '16px' }} />
        </button>

        {/* Color */}
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => {
              setShowColorDropdown(!showColorDropdown)
              setShowFontSizeDropdown(false)
              setShowSpacingDropdown(false)
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              padding: '6px 8px',
              fontSize: '14px',
              color: '#374151',
              backgroundColor: 'transparent',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer'
            }}
            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f3f4f6'}
            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
          >
            <div style={{
              width: '16px',
              height: '16px',
              borderRadius: '4px',
              border: '1px solid #d1d5db',
              backgroundColor: getCurrentColor()
            }}></div>
            <ChevronDown style={{ width: '12px', height: '12px' }} />
          </button>
          
          {showColorDropdown && (
            <div 
              style={{
                position: 'absolute',
                top: '100%',
                left: '0',
                marginTop: '4px',
                width: '200px',
                backgroundColor: 'rgba(255, 255, 255, 0.98)',
                backdropFilter: 'blur(10px)',
                border: '1px solid rgba(209, 213, 219, 0.8)',
                borderRadius: '8px',
                boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)',
                zIndex: 10,
                padding: '8px'
              }}
            >
              <div style={{ 
                display: 'grid', 
                gridTemplateColumns: 'repeat(6, 1fr)', 
                gap: '4px' 
              }}>
                {colors.map((colorOption) => (
                  <button
                    key={colorOption.value}
                    onClick={() => {
                      updateStyle('color', colorOption.value)
                      setShowColorDropdown(false)
                    }}
                    style={{
                      width: '24px',
                      height: '24px',
                      borderRadius: '4px',
                      border: '1px solid #d1d5db',
                      backgroundColor: colorOption.value,
                      cursor: 'pointer',
                      transition: 'transform 0.1s',
                      outline: currentStyles.color === colorOption.value ? '2px solid #3b82f6' : 'none',
                      outlineOffset: '1px'
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.1)'}
                    onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
                    title={colorOption.label}
                  ></button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Background/Spacing */}
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => {
              setShowSpacingDropdown(!showSpacingDropdown)
              setShowFontSizeDropdown(false)
              setShowColorDropdown(false)
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              padding: '6px 8px',
              fontSize: '14px',
              color: '#374151',
              backgroundColor: 'transparent',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer'
            }}
            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f3f4f6'}
            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
          >
            <div style={{
              width: '16px',
              height: '16px',
              borderRadius: '4px',
              border: '1px solid #d1d5db',
              backgroundColor: getCurrentBgColor()
            }}></div>
            <ChevronDown style={{ width: '12px', height: '12px' }} />
          </button>
          
          {showSpacingDropdown && (
            <div 
              style={{
                position: 'absolute',
                top: '100%',
                right: '0',
                marginTop: '4px',
                width: '280px',
                backgroundColor: 'rgba(255, 255, 255, 0.98)',
                backdropFilter: 'blur(10px)',
                border: '1px solid rgba(209, 213, 219, 0.8)',
                borderRadius: '8px',
                boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)',
                zIndex: 10,
                padding: '12px'
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: '500', color: '#374151', marginBottom: '4px' }}>Background</label>
                  <div style={{ 
                    display: 'grid', 
                    gridTemplateColumns: 'repeat(8, 1fr)', 
                    gap: '4px' 
                  }}>
                    {backgroundColors.map((bg) => (
                      <button
                        key={bg.value}
                        onClick={() => updateStyle('backgroundColor', bg.value)}
                        style={{
                          width: '24px',
                          height: '24px',
                          borderRadius: '4px',
                          border: '1px solid #d1d5db',
                          backgroundColor: bg.value === 'transparent' ? 'white' : bg.value,
                          backgroundImage: bg.value === 'transparent' ? 
                            'linear-gradient(45deg, #f3f4f6 25%, transparent 25%), linear-gradient(-45deg, #f3f4f6 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #f3f4f6 75%), linear-gradient(-45deg, transparent 75%, #f3f4f6 75%)' : 
                            'none',
                          backgroundSize: bg.value === 'transparent' ? '8px 8px' : 'auto',
                          backgroundPosition: bg.value === 'transparent' ? '0 0, 0 4px, 4px -4px, -4px 0px' : 'auto',
                          cursor: 'pointer',
                          transition: 'transform 0.1s',
                          outline: currentStyles.backgroundColor === bg.value ? '2px solid #3b82f6' : 'none',
                          outlineOffset: '1px'
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.1)'}
                        onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
                        title={bg.label}
                      ></button>
                    ))}
                  </div>
                </div>
                
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: '500', color: '#374151', marginBottom: '4px' }}>Margin</label>
                  <select
                    value={currentStyles.marginBottom}
                    onChange={(e) => updateStyle('marginBottom', e.target.value)}
                    style={{
                      width: '100%',
                      fontSize: '12px',
                      border: '1px solid #d1d5db',
                      borderRadius: '4px',
                      padding: '4px 8px',
                      backgroundColor: 'white'
                    }}
                  >
                    <option value="">None</option>
                    <option value="mb-2">Small (8px)</option>
                    <option value="mb-4">Medium (16px)</option>
                    <option value="mb-6">Large (24px)</option>
                  </select>
                </div>
                
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: '500', color: '#374151', marginBottom: '4px' }}>Padding</label>
                  <select
                    value={currentStyles.padding}
                    onChange={(e) => updateStyle('padding', e.target.value)}
                    style={{
                      width: '100%',
                      fontSize: '12px',
                      border: '1px solid #d1d5db',
                      borderRadius: '4px',
                      padding: '4px 8px',
                      backgroundColor: 'white'
                    }}
                  >
                    <option value="">None</option>
                    <option value="p-2">Small (8px)</option>
                    <option value="p-4">Medium (16px)</option>
                    <option value="p-6">Large (24px)</option>
                  </select>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Divider */}
        <div style={{ width: '1px', height: '24px', backgroundColor: '#d1d5db' }}></div>

        {/* Close Button */}
        <button
          onClick={onClose}
          style={{
            padding: '6px',
            borderRadius: '6px',
            border: 'none',
            backgroundColor: 'transparent',
            color: '#6b7280',
            cursor: 'pointer'
          }}
          onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f3f4f6'}
          onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
        >
          <X style={{ width: '16px', height: '16px' }} />
        </button>
        </div>
      </div>
    </div>
  )
}