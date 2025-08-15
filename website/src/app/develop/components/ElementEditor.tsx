'use client'

import { useState } from 'react'

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
  if (!isOpen) return null

  const handleReset = () => {
    onStyleChange({
      fontSize: 'text-xl',
      fontWeight: 'font-bold',
      color: 'text-gray-900',
      marginBottom: 'mb-1',
      padding: ''
    })
  }

  const handleApply = () => {
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-80 mx-4 overflow-hidden border border-gray-100">
        {/* Header */}
        <div className="bg-gradient-to-r from-gray-50 to-gray-100 px-6 py-4 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 bg-blue-500 rounded-lg flex items-center justify-center shadow-sm">
                <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                </svg>
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Edit Element</h3>
                <p className="text-sm font-medium text-gray-700">Welcome Title</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-lg bg-white hover:bg-gray-50 transition-colors flex items-center justify-center border border-gray-200"
            >
              <svg className="w-4 h-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-6">

        {/* Controls */}
        <div className="space-y-5">
          {/* Font Size */}
          <div>
            <label className="block text-sm font-semibold text-gray-900 mb-3">Font Size</label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { value: 'text-sm', label: 'SM' },
                { value: 'text-base', label: 'MD' },
                { value: 'text-lg', label: 'LG' },
                { value: 'text-xl', label: 'XL' },
                { value: 'text-2xl', label: '2XL' },
                { value: 'text-3xl', label: '3XL' }
              ].map((size) => (
                <button
                  key={size.value}
                  onClick={() => onStyleChange({ ...elementStyles, fontSize: size.value })}
                  className={`px-3 py-2.5 text-sm font-medium rounded-xl border-2 transition-all ${
                    elementStyles.fontSize === size.value
                      ? 'bg-blue-500 border-blue-500 text-white shadow-md'
                      : 'bg-white border-gray-200 text-gray-800 hover:border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  {size.label}
                </button>
              ))}
            </div>
          </div>

          {/* Font Weight */}
          <div>
            <label className="block text-sm font-semibold text-gray-900 mb-3">Font Weight</label>
            <div className="grid grid-cols-2 gap-2">
              {[
                { value: 'font-normal', label: 'Regular' },
                { value: 'font-medium', label: 'Medium' },
                { value: 'font-semibold', label: 'Semibold' },
                { value: 'font-bold', label: 'Bold' }
              ].map((weight) => (
                <button
                  key={weight.value}
                  onClick={() => onStyleChange({ ...elementStyles, fontWeight: weight.value })}
                  className={`px-3 py-2.5 text-sm font-medium rounded-xl border-2 transition-all ${
                    elementStyles.fontWeight === weight.value
                      ? 'bg-blue-500 border-blue-500 text-white shadow-md'
                      : 'bg-white border-gray-200 text-gray-800 hover:border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  {weight.label}
                </button>
              ))}
            </div>
          </div>

          {/* Text Color */}
          <div>
            <label className="block text-sm font-semibold text-gray-900 mb-3">Text Color</label>
            <div className="flex flex-wrap gap-2.5">
              {[
                { value: 'text-gray-900', color: 'bg-gray-900', label: 'Dark' },
                { value: 'text-gray-600', color: 'bg-gray-600', label: 'Gray' },
                { value: 'text-blue-600', color: 'bg-blue-600', label: 'Blue' },
                { value: 'text-purple-600', color: 'bg-purple-600', label: 'Purple' },
                { value: 'text-green-600', color: 'bg-green-600', label: 'Green' },
                { value: 'text-red-600', color: 'bg-red-600', label: 'Red' }
              ].map((colorOption) => (
                <button
                  key={colorOption.value}
                  onClick={() => onStyleChange({ ...elementStyles, color: colorOption.value })}
                  className={`w-10 h-10 rounded-xl border-2 transition-all relative ${
                    elementStyles.color === colorOption.value
                      ? 'border-blue-500 ring-2 ring-blue-200 shadow-md'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                  title={colorOption.label}
                >
                  <div className={`w-full h-full rounded-lg ${colorOption.color}`}></div>
                  {elementStyles.color === colorOption.value && (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Spacing */}
          <div className="grid grid-cols-2 gap-4">
            {/* Margin */}
            <div>
              <label className="block text-sm font-semibold text-gray-900 mb-3">Margin</label>
              <select
                value={elementStyles.marginBottom}
                onChange={(e) => onStyleChange({ ...elementStyles, marginBottom: e.target.value })}
                className="w-full text-sm border-2 border-gray-200 rounded-xl px-3 py-2.5 bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-medium text-gray-800"
              >
                <option value="">None</option>
                <option value="mb-1">Small</option>
                <option value="mb-2">Medium</option>
                <option value="mb-4">Large</option>
                <option value="mb-6">X-Large</option>
              </select>
            </div>

            {/* Padding */}
            <div>
              <label className="block text-sm font-semibold text-gray-900 mb-3">Padding</label>
              <select
                value={elementStyles.padding}
                onChange={(e) => onStyleChange({ ...elementStyles, padding: e.target.value })}
                className="w-full text-sm border-2 border-gray-200 rounded-xl px-3 py-2.5 bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-medium text-gray-800"
              >
                <option value="">None</option>
                <option value="p-1">Small</option>
                <option value="p-2">Medium</option>
                <option value="p-4">Large</option>
                <option value="p-6">X-Large</option>
              </select>
            </div>
          </div>
        </div>

        </div>

        {/* Footer Actions */}
        <div className="bg-gray-50 px-6 py-4 border-t border-gray-200 flex space-x-3">
          <button
            onClick={handleReset}
            className="flex-1 px-4 py-2.5 text-sm bg-white text-gray-800 rounded-xl hover:bg-gray-100 transition-colors font-semibold border-2 border-gray-200"
          >
            Reset
          </button>
          <button
            onClick={handleApply}
            className="flex-1 px-4 py-2.5 text-sm bg-blue-500 text-white rounded-xl hover:bg-blue-600 transition-colors font-semibold shadow-md"
          >
            Apply Changes
          </button>
        </div>
      </div>
    </div>
  )
}
