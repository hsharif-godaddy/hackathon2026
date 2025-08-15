'use client'

import { useState, useRef, useEffect } from 'react'
import {
  DocumentTextIcon,
  BoldIcon,
  ItalicIcon,
  SwatchIcon,
  ChevronDownIcon,
  XMarkIcon
} from '@heroicons/react/24/outline'

interface ElementStyles {
  fontSize: string
  fontWeight: string
  color: string
  marginBottom: string
  padding: string
}

interface ElementEditorProps {
  isOpen: boolean
  onClose: () => void
  elementStyles: ElementStyles
  onStyleChange: (styles: ElementStyles) => void
}

export default function ElementEditor({ isOpen, onClose, elementStyles, onStyleChange }: ElementEditorProps) {
  const [showFontSizeDropdown, setShowFontSizeDropdown] = useState(false)
  const [showColorDropdown, setShowColorDropdown] = useState(false)
  const [showSpacingDropdown, setShowSpacingDropdown] = useState(false)
  const toolbarRef = useRef<HTMLDivElement>(null)

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

  if (!isOpen) return null

  const fontSizes = [
    { value: 'text-sm', label: '14px' },
    { value: 'text-base', label: '16px' },
    { value: 'text-lg', label: '18px' },
    { value: 'text-xl', label: '20px' },
    { value: 'text-2xl', label: '24px' },
    { value: 'text-3xl', label: '30px' },
    { value: 'text-4xl', label: '36px' }
  ]

  const colors = [
    { value: 'text-gray-900', color: '#111827', label: 'Black' },
    { value: 'text-gray-600', color: '#4B5563', label: 'Gray' },
    { value: 'text-blue-600', color: '#2563EB', label: 'Blue' },
    { value: 'text-purple-600', color: '#9333EA', label: 'Purple' },
    { value: 'text-green-600', color: '#16A34A', label: 'Green' },
    { value: 'text-red-600', color: '#DC2626', label: 'Red' }
  ]

  const getCurrentFontSize = () => {
    return fontSizes.find(size => size.value === elementStyles.fontSize)?.label || '16px'
  }

  const getCurrentColor = () => {
    return colors.find(color => color.value === elementStyles.color)?.color || '#111827'
  }

  return (
    <div className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-50">
      <div 
        ref={toolbarRef}
        className="bg-white border border-gray-300 rounded-lg shadow-lg p-1 flex items-center space-x-1"
        style={{ minWidth: '320px' }}
      >
        {/* Font Size Dropdown */}
        <div className="relative">
          <button
            onClick={() => {
              setShowFontSizeDropdown(!showFontSizeDropdown)
              setShowColorDropdown(false)
              setShowSpacingDropdown(false)
            }}
            className="flex items-center space-x-1 px-2 py-1.5 text-sm text-gray-700 hover:bg-gray-100 rounded border-r border-gray-200"
          >
            <DocumentTextIcon className="w-4 h-4" />
            <span>{getCurrentFontSize()}</span>
            <ChevronDownIcon className="w-3 h-3" />
          </button>
          
          {showFontSizeDropdown && (
            <div className="absolute top-full left-0 mt-1 w-20 bg-white border border-gray-300 rounded shadow-lg z-10">
              {fontSizes.map((size) => (
                <button
                  key={size.value}
                  onClick={() => {
                    onStyleChange({ ...elementStyles, fontSize: size.value })
                    setShowFontSizeDropdown(false)
                  }}
                  className={`w-full text-left px-3 py-1.5 text-sm hover:bg-gray-100 ${
                    elementStyles.fontSize === size.value ? 'bg-blue-50 text-blue-600' : 'text-gray-700'
                  }`}
                >
                  {size.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Font Weight Buttons */}
        <button
          onClick={() => onStyleChange({ 
            ...elementStyles, 
            fontWeight: elementStyles.fontWeight === 'font-bold' ? 'font-normal' : 'font-bold' 
          })}
          className={`p-1.5 rounded hover:bg-gray-100 ${
            elementStyles.fontWeight === 'font-bold' ? 'bg-gray-200 text-gray-900' : 'text-gray-600'
          }`}
          title="Bold"
        >
          <BoldIcon className="w-4 h-4" />
        </button>

        <button
          className="p-1.5 rounded hover:bg-gray-100 text-gray-600"
          title="Italic"
        >
          <ItalicIcon className="w-4 h-4" />
        </button>

        {/* Divider */}
        <div className="w-px h-6 bg-gray-300"></div>

        {/* Color Picker */}
        <div className="relative">
          <button
            onClick={() => {
              setShowColorDropdown(!showColorDropdown)
              setShowFontSizeDropdown(false)
              setShowSpacingDropdown(false)
            }}
            className="flex items-center space-x-1 px-2 py-1.5 text-sm text-gray-700 hover:bg-gray-100 rounded"
          >
            <div 
              className="w-4 h-4 rounded border border-gray-300"
              style={{ backgroundColor: getCurrentColor() }}
            ></div>
            <ChevronDownIcon className="w-3 h-3" />
          </button>
          
          {showColorDropdown && (
            <div className="absolute top-full left-0 mt-1 w-32 bg-white border border-gray-300 rounded shadow-lg z-10 p-2">
              <div className="grid grid-cols-3 gap-1">
                {colors.map((colorOption) => (
                  <button
                    key={colorOption.value}
                    onClick={() => {
                      onStyleChange({ ...elementStyles, color: colorOption.value })
                      setShowColorDropdown(false)
                    }}
                    className={`w-8 h-8 rounded border border-gray-300 hover:scale-110 transition-transform ${
                      elementStyles.color === colorOption.value ? 'ring-2 ring-blue-500' : ''
                    }`}
                    style={{ backgroundColor: colorOption.color }}
                    title={colorOption.label}
                  ></button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Spacing Dropdown */}
        <div className="relative">
          <button
            onClick={() => {
              setShowSpacingDropdown(!showSpacingDropdown)
              setShowFontSizeDropdown(false)
              setShowColorDropdown(false)
            }}
            className="flex items-center space-x-1 px-2 py-1.5 text-sm text-gray-700 hover:bg-gray-100 rounded"
          >
            <span>Spacing</span>
            <ChevronDownIcon className="w-3 h-3" />
          </button>
          
          {showSpacingDropdown && (
            <div className="absolute top-full right-0 mt-1 w-48 bg-white border border-gray-300 rounded shadow-lg z-10 p-3">
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Margin</label>
                  <select
                    value={elementStyles.marginBottom}
                    onChange={(e) => onStyleChange({ ...elementStyles, marginBottom: e.target.value })}
                    className="w-full text-xs border border-gray-300 rounded px-2 py-1"
                  >
                    <option value="">None</option>
                    <option value="mb-1">Small</option>
                    <option value="mb-2">Medium</option>
                    <option value="mb-4">Large</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Padding</label>
                  <select
                    value={elementStyles.padding}
                    onChange={(e) => onStyleChange({ ...elementStyles, padding: e.target.value })}
                    className="w-full text-xs border border-gray-300 rounded px-2 py-1"
                  >
                    <option value="">None</option>
                    <option value="p-1">Small</option>
                    <option value="p-2">Medium</option>
                    <option value="p-4">Large</option>
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
          <XMarkIcon className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}
