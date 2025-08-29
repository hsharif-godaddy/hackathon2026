'use client';

import { useState, useEffect } from 'react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { ColorPalette, ColorPaletteOption, ProjectAnswers } from './types';
import ProjectQuestionnaire from './ProjectQuestionnaire';
import ColorPaletteGrid from './ColorPaletteGrid';
import ColorSchemePreview from './ColorSchemePreview';
import { Button } from '@/components/ui/button';

interface ColorSchemeDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onComplete: (palette: ColorPalette) => void;
  appId: string;
}

type DrawerStep = 'questionnaire' | 'color-selection' | 'palette-options' | 'final-review';

export default function ColorSchemeDrawer({ 
  isOpen, 
  onClose, 
  onComplete, 
  appId 
}: ColorSchemeDrawerProps) {
  const [currentStep, setCurrentStep] = useState<DrawerStep>('questionnaire');
  const [projectAnswers, setProjectAnswers] = useState<ProjectAnswers | null>(null);
  const [selectedColor, setSelectedColor] = useState<string | null>(null);
  const [selectedColorName, setSelectedColorName] = useState<string | null>(null);
  const [paletteOptions, setPaletteOptions] = useState<ColorPaletteOption[]>([]);
  const [selectedPalette, setSelectedPalette] = useState<ColorPalette | null>(null);

  // Reset state when drawer opens
  useEffect(() => {
    if (isOpen) {
      setCurrentStep('questionnaire');
      setProjectAnswers(null);
      setSelectedColor(null);
      setSelectedColorName(null);
      setPaletteOptions([]);
      setSelectedPalette(null);
    }
  }, [isOpen]);

  const generatePaletteOptions = (baseColor: string, answers: ProjectAnswers): ColorPaletteOption[] => {
    // Simplified palette generation
    const options = [
      {
        id: 'professional',
        name: 'Professional',
        description: 'Clean and trustworthy',
        palette: {
          primary: baseColor,
          secondary: '#6b7280',
          accent: '#10b981',
          background: '#ffffff',
          surface: '#f9fafb',
          text: '#111827',
          textSecondary: '#6b7280',
          error: '#ef4444',
          warning: '#f59e0b',
          success: '#10b981',
          info: '#3b82f6',
          scheme: 'light' as const,
          name: 'Professional'
        }
      },
      {
        id: 'friendly',
        name: 'Warm & Friendly',
        description: 'Approachable and inviting',
        palette: {
          primary: baseColor,
          secondary: '#f97316',
          accent: '#06b6d4',
          background: '#fffbeb',
          surface: '#ffffff',
          text: '#1c1917',
          textSecondary: '#78716c',
          error: '#dc2626',
          warning: '#f59e0b',
          success: '#16a34a',
          info: '#0ea5e9',
          scheme: 'light' as const,
          name: 'Warm & Friendly'
        }
      },
      {
        id: 'modern',
        name: 'Modern',
        description: 'Contemporary and bold',
        palette: {
          primary: baseColor,
          secondary: '#8b5cf6',
          accent: '#ec4899',
          background: '#ffffff',
          surface: '#f8fafc',
          text: '#0f172a',
          textSecondary: '#64748b',
          error: '#e11d48',
          warning: '#f59e0b',
          success: '#059669',
          info: '#0284c7',
          scheme: 'light' as const,
          name: 'Modern'
        }
      },
      {
        id: 'minimal',
        name: 'Minimal',
        description: 'Clean and simple',
        palette: {
          primary: baseColor,
          secondary: '#94a3b8',
          accent: '#475569',
          background: '#ffffff',
          surface: '#f1f5f9',
          text: '#0f172a',
          textSecondary: '#64748b',
          error: '#dc2626',
          warning: '#d97706',
          success: '#059669',
          info: '#0284c7',
          scheme: 'light' as const,
          name: 'Minimal'
        }
      }
    ];

    return options;
  };

  const handleQuestionnaireComplete = (answers: ProjectAnswers) => {
    setProjectAnswers(answers);
    setCurrentStep('color-selection');
  };

  const handleColorSelection = (color: string, colorName: string) => {
    setSelectedColor(color);
    setSelectedColorName(colorName);
    
    if (projectAnswers) {
      const options = generatePaletteOptions(color, projectAnswers);
      setPaletteOptions(options);
      setCurrentStep('palette-options');
    }
  };

  const handlePaletteSelection = (palette: ColorPalette) => {
    setSelectedPalette(palette);
    setCurrentStep('final-review');
  };

  const handleComplete = () => {
    if (selectedPalette) {
      onComplete(selectedPalette);
      onClose();
    }
  };

  const handleBack = () => {
    switch (currentStep) {
      case 'color-selection':
        setCurrentStep('questionnaire');
        break;
      case 'palette-options':
        setCurrentStep('color-selection');
        break;
      case 'final-review':
        setCurrentStep('palette-options');
        break;
    }
  };

  const renderStepContent = () => {
    switch (currentStep) {
      case 'questionnaire':
        return (
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                Tell us about your project
              </h3>
              <p className="text-gray-600 text-sm">
                Quick questions to create the perfect color palette
              </p>
            </div>
            <ProjectQuestionnaire
              onComplete={handleQuestionnaireComplete}
            />
          </div>
        );

      case 'color-selection':
        return (
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                Choose Primary Color
              </h3>
              <p className="text-gray-600 text-sm">
                Select your main brand color
              </p>
            </div>
            <ColorPaletteGrid
              selectedColor={selectedColor}
              onColorSelect={handleColorSelection}
            />
          </div>
        );

      case 'palette-options':
        return (
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                Choose Color Palette
              </h3>
              <p className="text-gray-600 text-sm">
                Pick your favorite style
              </p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              {paletteOptions.map((option) => (
                <button
                  key={option.id}
                  onClick={() => handlePaletteSelection(option.palette)}
                  className="text-left border-2 border-gray-200 rounded-lg p-4 hover:border-blue-300 transition-all hover:shadow-md"
                >
                  <h4 className="font-semibold text-gray-900 mb-2">
                    {option.name}
                  </h4>
                  <p className="text-gray-600 text-sm mb-3">
                    {option.description}
                  </p>
                  
                  {/* Color swatches */}
                  <div className="flex space-x-2">
                    <div 
                      className="w-6 h-6 rounded border"
                      style={{ backgroundColor: option.palette.primary }}
                    />
                    <div 
                      className="w-6 h-6 rounded border"
                      style={{ backgroundColor: option.palette.secondary }}
                    />
                    <div 
                      className="w-6 h-6 rounded border"
                      style={{ backgroundColor: option.palette.accent }}
                    />
                    <div 
                      className="w-6 h-6 rounded border"
                      style={{ backgroundColor: option.palette.surface }}
                    />
                  </div>
                </button>
              ))}
            </div>
          </div>
        );

      case 'final-review':
        return selectedPalette ? (
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                Your Color Palette
              </h3>
              <p className="text-gray-600 text-sm">
                Review and confirm your selection
              </p>
            </div>
            <ColorSchemePreview palette={selectedPalette} />
            <div className="flex justify-center pt-4">
              <Button onClick={handleComplete} className="px-8">
                Use This Palette
              </Button>
            </div>
          </div>
        ) : null;

      default:
        return null;
    }
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black bg-opacity-50 z-40" onClick={onClose} />
      
      {/* Drawer */}
      <div className={`
        fixed top-0 right-0 h-full w-full max-w-4xl bg-white shadow-xl z-50 
        transform transition-transform duration-300 ease-in-out overflow-y-auto
        ${isOpen ? 'translate-x-0' : 'translate-x-full'}
      `}>
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">
              Color Scheme Designer
            </h2>
            <p className="text-gray-600 text-sm mt-1">
              Create beautiful colors for your app
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 transition-colors"
          >
            <XMarkIcon className="w-6 h-6" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          {renderStepContent()}
        </div>

        {/* Footer Navigation */}
        {currentStep !== 'questionnaire' && currentStep !== 'final-review' && (
          <div className="p-6 border-t border-gray-200 bg-gray-50">
            <div className="flex justify-between">
              <Button 
                variant="outline" 
                onClick={handleBack}
              >
                Back
              </Button>
              
              {selectedColor && currentStep === 'color-selection' && (
                <Button
                  onClick={() => {
                    if (projectAnswers && selectedColor && selectedColorName) {
                      const options = generatePaletteOptions(selectedColor, projectAnswers);
                      setPaletteOptions(options);
                      setCurrentStep('palette-options');
                    }
                  }}
                >
                  Continue
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
