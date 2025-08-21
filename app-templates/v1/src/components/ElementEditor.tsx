'use client'

import { useState, useRef, useEffect, useCallback } from 'react'

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
  _onStyleApply: (styles: Record<string, string>) => void
}

export default function ElementEditor({ 
  isOpen, 
  onClose, 
  position, 
  selectedElement,
  _onStyleApply 
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
    fontSize: '',
    fontWeight: '',
    color: '',
    marginBottom: '',
    padding: '',
    backgroundColor: ''
  })

  // Extract current Tailwind classes from element
  useEffect(() => {
    if (selectedElement && selectedElement.className) {
      const classes = selectedElement.className.split(' ')
      
      const styles = {
        fontSize: classes.find(c => c.startsWith('text-') && (c.includes('sm') || c.includes('base') || c.includes('lg') || c.includes('xl'))) || 'text-base',
        fontWeight: classes.find(c => c.startsWith('font-')) || 'font-normal',
        color: classes.find(c => c.startsWith('text-') && c.includes('-')) || 'text-gray-900',
        marginBottom: classes.find(c => c.startsWith('mb-')) || '',
        padding: classes.find(c => c.startsWith('p-')) || '',
        backgroundColor: classes.find(c => c.startsWith('bg-')) || ''
      }
      
      setCurrentStyles(styles)
    }
  }, [selectedElement])

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
    const spaceAbove = toolbarRect.top
    
    // If not enough space below and more space above, open upward
    if (spaceBelow < dropdownHeight && spaceAbove > dropdownHeight) {
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

  // Font weights array commented out as it's currently unused
  // const fontWeights = [
  //   { value: 'font-thin', label: 'Thin' },
  //   { value: 'font-light', label: 'Light' },
  //   { value: 'font-normal', label: 'Normal' },
  //   { value: 'font-medium', label: 'Medium' },
  //   { value: 'font-semibold', label: 'Semi Bold' },
  //   { value: 'font-bold', label: 'Bold' }
  // ]

  const colors = [
    { value: 'text-gray-900', color: '#111827', label: 'Black' },
    { value: 'text-gray-600', color: '#4B5563', label: 'Gray' },
    { value: 'text-blue-600', color: '#2563EB', label: 'Blue' },
    { value: 'text-purple-600', color: '#9333EA', label: 'Purple' },
    { value: 'text-green-600', color: '#16A34A', label: 'Green' },
    { value: 'text-red-600', color: '#DC2626', label: 'Red' },
    { value: 'text-yellow-600', color: '#D97706', label: 'Yellow' },
    { value: 'text-pink-600', color: '#DB2777', label: 'Pink' }
  ]

  const backgroundColors = [
    { value: '', color: 'transparent', label: 'None' },
    { value: 'bg-white', color: '#FFFFFF', label: 'White' },
    { value: 'bg-gray-100', color: '#F3F4F6', label: 'Gray 100' },
    { value: 'bg-blue-100', color: '#DBEAFE', label: 'Blue 100' },
    { value: 'bg-green-100', color: '#DCFCE7', label: 'Green 100' },
    { value: 'bg-yellow-100', color: '#FEF3C7', label: 'Yellow 100' },
    { value: 'bg-red-100', color: '#FEE2E2', label: 'Red 100' }
  ]

  const spacingOptions = [
    { value: '', label: 'None' },
    { value: '1', label: '0.25rem' },
    { value: '2', label: '0.5rem' },
    { value: '3', label: '0.75rem' },
    { value: '4', label: '1rem' },
    { value: '6', label: '1.5rem' },
    { value: '8', label: '2rem' }
  ]

  const getCurrentFontSize = () => {
    return fontSizes.find(size => size.value === currentStyles.fontSize)?.label || '16px'
  }

  const getCurrentColor = () => {
    return colors.find(color => color.value === currentStyles.color)?.color || '#111827'
  }

  const getCurrentBgColor = () => {
    return backgroundColors.find(bg => bg.value === currentStyles.backgroundColor)?.color || 'transparent'
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
        // Remove old class of the same type
        const classes = element.className.split(' ')
        let filteredClasses = classes
        
        switch (property) {
          case 'fontSize':
            filteredClasses = classes.filter(c => !c.match(/^text-(xs|sm|base|lg|xl|2xl|3xl|4xl)$/))
            break
          case 'fontWeight':
            filteredClasses = classes.filter(c => !c.startsWith('font-'))
            break
          case 'color':
            filteredClasses = classes.filter(c => !c.match(/^text-\w+-\d+$/))
            break
          case 'backgroundColor':
            filteredClasses = classes.filter(c => !c.startsWith('bg-'))
            break
          case 'marginBottom':
            filteredClasses = classes.filter(c => !c.startsWith('mb-'))
            break
          case 'padding':
            filteredClasses = classes.filter(c => !c.startsWith('p-'))
            break
        }
        
        // Add new class if not empty
        if (value) {
          filteredClasses.push(value)
        }
        
        element.className = filteredClasses.join(' ')
        
        // Send update to parent with development context for saving back to disk
        window.parent.postMessage({
          type: 'STYLE_UPDATED',
          data: {
            selector: selectedElement.selector,
            property,
            value,
            newClassName: element.className,
            devContext: selectedElement.devContext // Include development context for saving back to disk
          }
        }, '*')
      }
    }
  }

  return (
    <div 
      style={{
        position: 'fixed',
        top: position.top,
        left: position.left,
        zIndex: 10001
      }}
    >
      <div 
        ref={toolbarRef}
        className="bg-white border border-gray-300 rounded-lg shadow-lg p-2 flex flex-col space-y-2"
        style={{ minWidth: '400px' }}
      >
        {/* Development Context Info */}
        {selectedElement?.devContext && (
          <div className="flex items-center space-x-2 px-2 py-1 text-xs text-gray-500 bg-gray-50 rounded border">
            <span>📁</span>
            <span>{selectedElement.devContext.fileName}</span>
            <span>•</span>
            <span>{selectedElement.devContext.componentName}</span>
            <span>•</span>
            <span>L{selectedElement.devContext.lineNumber}</span>
          </div>
        )}
        
        {/* Toolbar Controls */}
        <div className="flex items-center space-x-2">
        {/* Font Size */}
        <div className="relative">
          <button
            onClick={() => {
              setShowFontSizeDropdown(!showFontSizeDropdown)
              setShowColorDropdown(false)
              setShowSpacingDropdown(false)
            }}
            className="flex items-center space-x-1 px-2 py-1.5 text-sm text-gray-700 hover:bg-gray-100 rounded"
          >
            <span>📝</span>
            <span>{getCurrentFontSize()}</span>
            <span>▼</span>
          </button>
          
          {showFontSizeDropdown && (
            <div className={`absolute left-0 w-24 bg-white border border-gray-300 rounded shadow-lg z-10 max-h-48 overflow-y-auto ${
              dropdownPositions.fontSize === 'top' 
                ? 'bottom-full mb-1' 
                : 'top-full mt-1'
            }`}>
              {fontSizes.map((size) => (
                <button
                  key={size.value}
                  onClick={() => {
                    updateStyle('fontSize', size.value)
                    setShowFontSizeDropdown(false)
                  }}
                  className={`w-full text-left px-3 py-1.5 text-sm hover:bg-gray-100 ${
                    currentStyles.fontSize === size.value ? 'bg-blue-50 text-blue-600' : 'text-gray-700'
                  }`}
                >
                  {size.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Font Weight */}
        <button
          onClick={() => {
            const currentWeight = currentStyles.fontWeight
            const newWeight = currentWeight === 'font-bold' ? 'font-normal' : 'font-bold'
            updateStyle('fontWeight', newWeight)
          }}
          className={`p-1.5 rounded hover:bg-gray-100 text-sm ${
            currentStyles.fontWeight === 'font-bold' ? 'bg-gray-200 text-gray-900' : 'text-gray-600'
          }`}
          title="Bold"
        >
          <strong>B</strong>
        </button>

        {/* Text Color */}
        <div className="relative">
          <button
            onClick={() => {
              setShowColorDropdown(!showColorDropdown)
              setShowFontSizeDropdown(false)
              setShowSpacingDropdown(false)
            }}
            className="flex items-center space-x-1 px-2 py-1.5 text-sm text-gray-700 hover:bg-gray-100 rounded"
          >
            <span>A</span>
            <div 
              className="w-4 h-4 rounded border border-gray-300"
              style={{ backgroundColor: getCurrentColor() }}
            ></div>
            <span>▼</span>
          </button>
          
          {showColorDropdown && (
            <div className="absolute top-full left-0 mt-1 w-36 bg-white border border-gray-300 rounded shadow-lg z-10 p-2">
              <div className="grid grid-cols-4 gap-1">
                {colors.map((colorOption) => (
                  <button
                    key={colorOption.value}
                    onClick={() => {
                      updateStyle('color', colorOption.value)
                      setShowColorDropdown(false)
                    }}
                    className={`w-6 h-6 rounded border border-gray-300 hover:scale-110 transition-transform ${
                      currentStyles.color === colorOption.value ? 'ring-2 ring-blue-500' : ''
                    }`}
                    style={{ backgroundColor: colorOption.color }}
                    title={colorOption.label}
                  ></button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Background Color */}
        <div className="relative">
          <button
            onClick={() => {
              setShowSpacingDropdown(!showSpacingDropdown)
              setShowFontSizeDropdown(false)
              setShowColorDropdown(false)
            }}
            className="flex items-center space-x-1 px-2 py-1.5 text-sm text-gray-700 hover:bg-gray-100 rounded"
          >
            <span>🎨</span>
            <div 
              className="w-4 h-4 rounded border border-gray-300"
              style={{ backgroundColor: getCurrentBgColor() }}
            ></div>
            <span>▼</span>
          </button>
          
          {showSpacingDropdown && (
            <div className="absolute top-full right-0 mt-1 w-48 bg-white border border-gray-300 rounded shadow-lg z-10 p-3">
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Background</label>
                  <div className="grid grid-cols-4 gap-1">
                    {backgroundColors.map((bg) => (
                      <button
                        key={bg.value}
                        onClick={() => updateStyle('backgroundColor', bg.value)}
                        className={`w-6 h-6 rounded border border-gray-300 hover:scale-110 transition-transform ${
                          currentStyles.backgroundColor === bg.value ? 'ring-2 ring-blue-500' : ''
                        }`}
                        style={{ backgroundColor: bg.color }}
                        title={bg.label}
                      ></button>
                    ))}
                  </div>
                </div>
                
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Margin</label>
                  <select
                    value={currentStyles.marginBottom.replace('mb-', '')}
                    onChange={(e) => updateStyle('marginBottom', e.target.value ? `mb-${e.target.value}` : '')}
                    className="w-full text-xs border border-gray-300 rounded px-2 py-1"
                  >
                    {spacingOptions.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </div>
                
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Padding</label>
                  <select
                    value={currentStyles.padding.replace('p-', '')}
                    onChange={(e) => updateStyle('padding', e.target.value ? `p-${e.target.value}` : '')}
                    className="w-full text-xs border border-gray-300 rounded px-2 py-1"
                  >
                    {spacingOptions.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Divider */}
        <div className="w-px h-6 bg-gray-300"></div>

        {/* Close Button */}
        <button
          onClick={onClose}
          className="p-1.5 rounded hover:bg-gray-100 text-gray-600"
          title="Close"
        >
          ✕
        </button>
        </div>
      </div>
    </div>
  )
}
