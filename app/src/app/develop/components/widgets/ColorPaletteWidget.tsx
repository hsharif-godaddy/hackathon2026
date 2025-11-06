'use client'

import { useState } from 'react'
import { postMessageToIframe } from '@/utils/postMessage'

/**
 * Color data structure
 */
export interface ColorInfo {
    name: string
    hex: string
    role?: string
}

/**
 * Color palette widget props
 */
export interface ColorPaletteWidgetProps {
    name?: string
    colors: ColorInfo[]
    className?: string
    isSelected?: boolean
}

/**
 * Color Palette Widget
 * 
 * Displays a color palette with image preview:
 * - Square-ish container (14rem wide)
 * - Image preview at top
 * - 5 color bars at bottom
 * - All bars expand to full height on hover
 */
export default function ColorPaletteWidget({ name, colors, className = '', isSelected = false }: ColorPaletteWidgetProps) {
    const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)
    const safeColors = colors.slice(0, 5) // Take only first 5 colors

    if (safeColors.length === 0) {
        return (
            <div className={`rounded-lg border bg-white p-4 shadow-sm w-56 ${className}`}>
                <p className="text-gray-500 text-sm">No colors to display</p>
            </div>
        )
    }

    // Pad to 5 colors if needed
    while (safeColors.length < 5) {
        safeColors.push({ name: '', hex: '#E5E7EB', role: '' })
    }

    /**
     * Handle click on palette - send preview message to iframe
     */
    function handleClick() {
        if (!name) return

        // Get the iframe element
        const iframe = document.getElementById('preview-iframe') as HTMLIFrameElement
        if (!iframe || !iframe.contentWindow) {
            console.error('Could not find preview iframe')
            return
        }

        // Create palette data from colors
        const paletteData = {
            name,
            primary: colors[0]?.hex || '#007bff',
            secondary: colors[1]?.hex || '#6c757d',
            accent: colors[2]?.hex || '#17a2b8',
            background: colors[3]?.hex || '#ffffff',
            surface: colors[4]?.hex || '#f8f9fa',
        }

        // Post message to iframe to preview theme
        postMessageToIframe(iframe, {
            type: 'PREVIEW_THEME',
            palette: paletteData
        })

        // Emit custom event to notify grid of selection
        const event = new CustomEvent('palette-preview', {
            detail: paletteData
        })
        window.dispatchEvent(event)

        console.log('🎨 Theme preview requested:', name)
    }

    return (
        <div className={`w-[10rem] h-[5rem] ${className}`}>
            <div 
                className={`w-[10rem] h-[3rem] rounded-sm overflow-hidden shadow-lg relative cursor-pointer transition-all hover:scale-105 ${
                    isSelected ? 'ring-4 ring-blue-500 ring-offset-2' : ''
                }`}
                onClick={handleClick}
            >
                {/* Color bars */}
                <div className="absolute inset-x-0 flex">
                    {safeColors.map((color, index) => (
                        <div
                            key={index}
                            className="flex-1 h-[3rem] transition-all duration-200"
                            style={{ 
                                backgroundColor: color.hex,
                                transform: hoveredIndex === index ? 'scale(1.1)' : 'scale(1)',
                                zIndex: hoveredIndex === index ? 10 : 1,
                            }}
                            onMouseEnter={() => setHoveredIndex(index)}
                            onMouseLeave={() => setHoveredIndex(null)}
                        />
                    ))}
                </div>
                
                {/* Selected indicator checkmark */}
                {isSelected && (
                    <div className="absolute top-1 right-1 bg-blue-500 rounded-full w-5 h-5 flex items-center justify-center z-20">
                        <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                        </svg>
                    </div>
                )}
            </div>

            {/* Palette name below widget */}
            {name && (
                <div className="mt-3 text-center">
                    <h3 className={`text-sm font-semibold ${isSelected ? 'text-blue-600' : 'text-gray-800'}`}>{name}</h3>
                </div>
            )}
        </div>
    )
}

