'use client';

import { useState } from 'react';
import { CheckIcon } from '@heroicons/react/24/outline';
import { ColorPaletteGridProps, ColorCategory, ColorOption } from './types';

const defaultColorCategories: ColorCategory[] = [
  {
    name: 'Blues',
    colors: [
      { name: 'Sky Blue', color: '#87CEEB', description: 'Light and airy' },
      { name: 'Ocean Blue', color: '#006BA6', description: 'Professional and trustworthy' },
      { name: 'Navy', color: '#1e3a8a', description: 'Strong and reliable' },
      { name: 'Teal', color: '#0891b2', description: 'Modern and fresh' },
    ]
  },
  {
    name: 'Greens',
    colors: [
      { name: 'Emerald', color: '#10b981', description: 'Growth and harmony' },
      { name: 'Forest', color: '#166534', description: 'Natural and stable' },
      { name: 'Mint', color: '#6ee7b7', description: 'Fresh and clean' },
      { name: 'Sage', color: '#84cc16', description: 'Calm and balanced' },
    ]
  },
  {
    name: 'Purples',
    colors: [
      { name: 'Violet', color: '#8b5cf6', description: 'Creative and innovative' },
      { name: 'Indigo', color: '#4338ca', description: 'Deep and thoughtful' },
      { name: 'Lavender', color: '#c084fc', description: 'Elegant and refined' },
      { name: 'Plum', color: '#7c3aed', description: 'Rich and luxurious' },
    ]
  },
  {
    name: 'Reds',
    colors: [
      { name: 'Crimson', color: '#dc2626', description: 'Bold and energetic' },
      { name: 'Rose', color: '#f43f5e', description: 'Warm and inviting' },
      { name: 'Coral', color: '#ff6b6b', description: 'Friendly and approachable' },
      { name: 'Burgundy', color: '#991b1b', description: 'Sophisticated and strong' },
    ]
  },
  {
    name: 'Oranges',
    colors: [
      { name: 'Orange', color: '#ea580c', description: 'Energetic and creative' },
      { name: 'Peach', color: '#fed7aa', description: 'Soft and welcoming' },
      { name: 'Amber', color: '#f59e0b', description: 'Warm and optimistic' },
      { name: 'Tangerine', color: '#fb923c', description: 'Vibrant and fun' },
    ]
  },
  {
    name: 'Neutrals',
    colors: [
      { name: 'Charcoal', color: '#374151', description: 'Professional and modern' },
      { name: 'Slate', color: '#64748b', description: 'Balanced and versatile' },
      { name: 'Stone', color: '#78716c', description: 'Natural and grounded' },
      { name: 'Warm Gray', color: '#a8a29e', description: 'Sophisticated and timeless' },
    ]
  }
];

export default function ColorPaletteGrid({
  categories = defaultColorCategories,
  selectedColor,
  onColorSelect,
  title = "Choose Your Primary Color",
  subtitle = "Select a color that represents your brand or the feeling you want to convey"
}: ColorPaletteGridProps) {
  const [hoveredColor, setHoveredColor] = useState<string | null>(null);

  const handleColorClick = (color: ColorOption) => {
    onColorSelect(color.color, color.name);
  };

  return (
    <div className="w-full max-w-4xl mx-auto">
      <div className="text-center mb-4">
        <h2 className="text-2xl font-bold text-gray-900 mb-1">{title}</h2>
        <p className="text-gray-600">{subtitle}</p>
      </div>

      <div className="grid grid-cols-3 md:grid-cols-6 lg:grid-cols-8 gap-1.5">
        {categories.flatMap((category) => 
          category.colors.map((colorOption) => (
            <button
              key={colorOption.name}
              onClick={() => handleColorClick(colorOption)}
              onMouseEnter={() => setHoveredColor(colorOption.color)}
              onMouseLeave={() => setHoveredColor(null)}
              className={`
                relative p-1.5 rounded-lg border-2 transition-all duration-200 hover:scale-105
                ${selectedColor === colorOption.color 
                  ? 'border-gray-900 shadow-lg' 
                  : 'border-gray-200 hover:border-gray-300'
                }
              `}
            >
              <div className="space-y-1">
                {/* Color Swatch */}
                <div className="relative">
                  <div 
                    className="w-6 h-6 rounded-full mx-auto shadow-md"
                    style={{ backgroundColor: colorOption.color }}
                  />
                  {selectedColor === colorOption.color && (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="bg-white rounded-full p-0.5">
                        <CheckIcon className="w-1.5 h-1.5 text-gray-900" />
                      </div>
                    </div>
                  )}
                </div>
                
                {/* Color Name - Fixed height to prevent jumping */}
                <div className="h-8 flex flex-col justify-start">
                  <p className="font-medium text-gray-900 text-xs text-center">
                    {colorOption.name}
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5 font-mono text-center">
                    {colorOption.color}
                  </p>
                  {/* Description with fixed space */}
                  <div className="h-4 flex items-start justify-center mt-0.5">
                    {(hoveredColor === colorOption.color || selectedColor === colorOption.color) && colorOption.description && (
                      <p className="text-xs text-gray-600 text-center leading-tight">
                        {colorOption.description}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </button>
          ))
        )}
      </div>

      {selectedColor && (
        <div className="mt-4 p-2 bg-gray-50 rounded-lg border">
          <div className="flex items-center space-x-1.5">
            <div 
              className="w-4 h-4 rounded-full shadow"
              style={{ backgroundColor: selectedColor }}
            />
            <div>
              <p className="text-sm font-medium text-gray-900">
                Selected: {categories
                  .flatMap(cat => cat.colors)
                  .find(color => color.color === selectedColor)?.name}
              </p>
              <p className="text-xs text-gray-600 font-mono">{selectedColor}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
