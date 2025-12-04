'use client';

import { useState } from 'react';
import { ColorDesignFlowProps, ProjectAnswers, ColorPalette, ColorPaletteOption } from './types';
import ProjectQuestionnaire from './ProjectQuestionnaire';
import ColorPaletteGrid from './ColorPaletteGrid';
import ColorSchemePreview from './ColorSchemePreview';
import { ArrowRightIcon, ArrowLeftIcon, CheckIcon } from '@heroicons/react/24/outline';

type FlowStep = 'questionnaire' | 'color-selection' | 'palette-options' | 'final-review';

export default function ColorDesignFlow({
  onComplete,
  onCancel
}: ColorDesignFlowProps) {
  const [currentStep, setCurrentStep] = useState<FlowStep>('questionnaire');
  const [projectAnswers, setProjectAnswers] = useState<ProjectAnswers | null>(null);
  const [selectedColor, setSelectedColor] = useState<string | null>(null);
  const [selectedColorName, setSelectedColorName] = useState<string | null>(null);
  const [paletteOptions, setPaletteOptions] = useState<ColorPaletteOption[]>([]);
  const [selectedPalette, setSelectedPalette] = useState<ColorPalette | null>(null);

  const steps = [
    { id: 'questionnaire', label: 'Project Details', description: 'Tell us about your project' },
    { id: 'color-selection', label: 'Primary Color', description: 'Choose your main color' },
    { id: 'palette-options', label: 'Palette Options', description: 'Select your favorite scheme' },
    { id: 'final-review', label: 'Review & Finalize', description: 'Confirm your choice' },
  ];

  const currentStepIndex = steps.findIndex(step => step.id === currentStep);

  const generatePaletteOptions = (baseColor: string, answers: ProjectAnswers): ColorPaletteOption[] => {
    // Always generate exactly 4 palette options
    const options: ColorPaletteOption[] = [];

    // Option 1: Professional palette
    options.push({
      id: 'professional',
      name: 'Professional Suite',
      description: 'Clean, trustworthy, and business-appropriate',
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
        name: 'Professional Suite'
      }
    });

    // Option 2: Warm & friendly palette
    options.push({
      id: 'friendly',
      name: 'Warm & Welcoming',
      description: 'Approachable, warm, and inviting',
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
        name: 'Warm & Welcoming'
      }
    });

    // Option 3: Modern/Bold palette
    options.push({
      id: 'modern',
      name: 'Modern Edge',
      description: 'Contemporary, bold, and forward-thinking',
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
        name: 'Modern Edge'
      }
    });

    // Option 4: Dark theme (conditional) or Minimalist
    if (answers.brandPersonality.includes('bold') || answers.brandPersonality.includes('innovative')) {
      options.push({
        id: 'dark',
        name: 'Dark Professional',
        description: 'Sophisticated dark theme with high contrast',
        palette: {
          primary: baseColor,
          secondary: '#6b7280',
          accent: '#10b981',
          background: '#0f172a',
          surface: '#1e293b',
          text: '#f1f5f9',
          textSecondary: '#94a3b8',
          error: '#ef4444',
          warning: '#f59e0b',
          success: '#22c55e',
          info: '#3b82f6',
          scheme: 'dark' as const,
          name: 'Dark Professional'
        }
      });
    } else {
      options.push({
        id: 'minimalist',
        name: 'Clean Minimal',
        description: 'Simple, uncluttered, and elegant',
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
          name: 'Clean Minimal'
        }
      });
    }

    return options; // Always return exactly 4 options
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
      default:
        if (onCancel) onCancel();
    }
  };

  const renderStep = () => {
    switch (currentStep) {
      case 'questionnaire':
        return (
          <ProjectQuestionnaire
            onComplete={handleQuestionnaireComplete}
            onBack={onCancel}
          />
        );

      case 'color-selection':
        return (
          <ColorPaletteGrid
            selectedColor={selectedColor}
            onColorSelect={handleColorSelection}
            title="Choose Your Primary Color"
            subtitle="This will be the main color that represents your brand"
          />
        );

      case 'palette-options':
        return (
          <div className="space-y-4">
            <div className="text-center">
              <h2 className="text-2xl font-bold text-gray-900 mb-1">
                Choose Your Color Palette
              </h2>
              <p className="text-gray-600">
                Based on your preferences, here are 4 carefully crafted color schemes
              </p>
            </div>

            <div className="grid md:grid-cols-2 gap-3">
              {paletteOptions.map((option) => (
                <button
                  key={option.id}
                  onClick={() => handlePaletteSelection(option.palette)}
                  className="text-left border-2 border-gray-200 rounded-lg p-2 hover:border-blue-300 transition-all hover:shadow-md"
                >
                  <h3 className="font-semibold text-lg text-gray-900 mb-1">
                    {option.name}
                  </h3>
                  <p className="text-gray-600 text-sm mb-2">
                    {option.description}
                  </p>

                  {/* Color swatches */}
                  <div className="flex space-x-1 mb-1.5">
                    <div
                      className="w-4 h-4 rounded border"
                      style={{ backgroundColor: option.palette.primary }}
                    />
                    <div
                      className="w-4 h-4 rounded border"
                      style={{ backgroundColor: option.palette.secondary }}
                    />
                    <div
                      className="w-4 h-4 rounded border"
                      style={{ backgroundColor: option.palette.accent }}
                    />
                    <div
                      className="w-4 h-4 rounded border"
                      style={{ backgroundColor: option.palette.surface }}
                    />
                  </div>

                  <div className="text-xs text-gray-500">
                    Primary: {option.palette.primary} •
                    Scheme: {option.palette.scheme}
                  </div>
                </button>
              ))}
            </div>
          </div>
        );

      case 'final-review':
        return selectedPalette ? (
          <div className="space-y-4">
            <div className="text-center">
              <h2 className="text-2xl font-bold text-gray-900 mb-1">
                Review Your Color Palette
              </h2>
              <p className="text-gray-600">
                Take a final look at your color scheme and make sure you&apos;re happy with it
              </p>
            </div>

            <ColorSchemePreview
              palette={selectedPalette}
            />

            <div className="flex justify-center">
              <button
                onClick={handleComplete}
                className="flex items-center space-x-1 px-4 py-1.5 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 transition-colors"
              >
                <CheckIcon className="w-2.5 h-2.5" />
                <span>Finalize This Palette</span>
              </button>
            </div>
          </div>
        ) : null;

      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 py-4">
      <div className="max-w-6xl mx-auto px-2">
        {/* Header */}
        <div className="text-center mb-6">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            Color Scheme Designer
          </h1>
          <p className="text-gray-600 mb-4">
            Let&apos;s create the perfect color palette for your {projectAnswers?.projectType || 'project'}
          </p>

          {/* Progress Steps */}
          <div className="flex justify-center mb-4">
            <div className="flex space-x-4">
              {steps.map((step, index) => (
                <div
                  key={step.id}
                  className={`flex items-center space-x-1 ${
                    index <= currentStepIndex ? 'text-blue-600' : 'text-gray-400'
                  }`}
                >
                  <div className={`
                    w-4 h-4 rounded-full border-2 flex items-center justify-center text-sm font-medium
                    ${index < currentStepIndex
                      ? 'bg-blue-600 border-blue-600 text-white'
                      : index === currentStepIndex
                      ? 'border-blue-600 text-blue-600 bg-white'
                      : 'border-gray-300 text-gray-400 bg-white'
                    }
                  `}>
                    {index < currentStepIndex ? <CheckIcon className="w-2 h-2" /> : index + 1}
                  </div>
                  <div className="text-sm font-medium hidden md:block">
                    {step.label}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Main Content */}
        <div className="bg-white rounded-lg shadow-sm border p-4">
          {renderStep()}
        </div>

        {/* Navigation Footer */}
        {currentStep !== 'questionnaire' && currentStep !== 'final-review' && (
          <div className="mt-4 flex justify-between">
            <button
              onClick={handleBack}
              className="flex items-center space-x-1 px-2 py-1 text-gray-600 hover:text-gray-900 transition-colors"
            >
              <ArrowLeftIcon className="w-2 h-2" />
              <span>Back</span>
            </button>

            {selectedColor && currentStep === 'color-selection' && (
              <button
                onClick={() => {
                  if (projectAnswers && selectedColor && selectedColorName) {
                    const options = generatePaletteOptions(selectedColor, projectAnswers);
                    setPaletteOptions(options);
                    setCurrentStep('palette-options');
                  }
                }}
                className="flex items-center space-x-1 px-3 py-1 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors"
              >
                <span>Continue</span>
                <ArrowRightIcon className="w-2 h-2" />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
