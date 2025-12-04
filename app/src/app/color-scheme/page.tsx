'use client';

import { useState } from 'react';
import { ColorDesignFlow, ColorPalette } from '../components/color';

export default function ColorSchemePage() {
  const [selectedPalette, setSelectedPalette] = useState<ColorPalette | null>(null);
  const [showFlow, setShowFlow] = useState(false);

  // Mock app ID - in real implementation this would come from the URL or context
  const appId = 'demo-app';

  const handlePaletteComplete = (palette: ColorPalette) => {
    setSelectedPalette(palette);
    setShowFlow(false);
    
    // Here you would typically save the palette using the app_plan tool
    console.log('Selected palette:', palette);
  };

  const handleStartDesign = () => {
    setShowFlow(true);
  };

  const handleCancel = () => {
    setShowFlow(false);
  };

  if (showFlow) {
    return (
      <ColorDesignFlow
        appId={appId}
        onComplete={handlePaletteComplete}
        onCancel={handleCancel}
      />
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto px-2 py-6">
        <div className="text-center mb-6">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">
            Color Scheme Designer
          </h1>
          <p className="text-xl text-gray-600 mb-4">
            Create beautiful, accessible color palettes for your applications with our AI-powered designer.
          </p>
          
          {!selectedPalette ? (
            <button
              onClick={handleStartDesign}
              className="bg-blue-600 text-white px-4 py-2 rounded-lg font-medium text-lg hover:bg-blue-700 transition-colors"
            >
              Start Designing Your Palette
            </button>
          ) : (
            <div className="space-y-3">
              <div className="bg-white rounded-lg border p-3">
                <h2 className="text-2xl font-semibold text-gray-900 mb-2">
                  Your Color Palette: {selectedPalette.name}
                </h2>
                
                {/* Color swatches */}
                <div className="flex justify-center space-x-2 mb-3">
                  <div className="text-center">
                    <div 
                      className="w-8 h-8 rounded-lg border shadow"
                      style={{ backgroundColor: selectedPalette.primary }}
                    />
                    <p className="text-xs text-gray-600 mt-1">Primary</p>
                    <p className="text-xs font-mono">{selectedPalette.primary}</p>
                  </div>
                  <div className="text-center">
                    <div 
                      className="w-8 h-8 rounded-lg border shadow"
                      style={{ backgroundColor: selectedPalette.secondary }}
                    />
                    <p className="text-xs text-gray-600 mt-1">Secondary</p>
                    <p className="text-xs font-mono">{selectedPalette.secondary}</p>
                  </div>
                  <div className="text-center">
                    <div 
                      className="w-8 h-8 rounded-lg border shadow"
                      style={{ backgroundColor: selectedPalette.accent }}
                    />
                    <p className="text-xs text-gray-600 mt-1">Accent</p>
                    <p className="text-xs font-mono">{selectedPalette.accent}</p>
                  </div>
                  <div className="text-center">
                    <div 
                      className="w-8 h-8 rounded-lg border shadow"
                      style={{ backgroundColor: selectedPalette.surface }}
                    />
                    <p className="text-xs text-gray-600 mt-1">Surface</p>
                    <p className="text-xs font-mono">{selectedPalette.surface}</p>
                  </div>
                </div>
                
                <div className="flex justify-center space-x-2">
                  <button
                    onClick={handleStartDesign}
                    className="px-3 py-1 border border-blue-600 text-blue-600 rounded-lg hover:bg-blue-50 transition-colors"
                  >
                    Design Another Palette
                  </button>
                  <button
                    onClick={() => {
                      // In a real app, this would integrate with the develop agent
                      alert('This would hand off to the development agent to implement the color scheme!');
                    }}
                    className="px-3 py-1 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                  >
                    Implement in App
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Features */}
        <div className="grid md:grid-cols-3 gap-4 mt-8">
          <div className="text-center">
            <div className="bg-blue-100 w-8 h-8 rounded-full flex items-center justify-center mx-auto mb-2">
              <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zM21 5a2 2 0 00-2-2h-4a2 2 0 00-2 2v12a4 4 0 004 4h4a4 4 0 004-4V5z" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-1">Guided Discovery</h3>
            <p className="text-gray-600">
              Answer a few questions about your project and brand to get personalized color recommendations.
            </p>
          </div>

          <div className="text-center">
            <div className="bg-green-100 w-8 h-8 rounded-full flex items-center justify-center mx-auto mb-2">
              <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-1">Accessibility First</h3>
            <p className="text-gray-600">
              All generated palettes meet WCAG AA standards for contrast and readability.
            </p>
          </div>

          <div className="text-center">
            <div className="bg-purple-100 w-8 h-8 rounded-full flex items-center justify-center mx-auto mb-2">
              <svg className="w-4 h-4 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-1">Ready to Implement</h3>
            <p className="text-gray-600">
              Get CSS variables, hex codes, and usage guidelines ready for development.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
