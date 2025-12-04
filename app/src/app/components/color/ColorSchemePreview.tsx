'use client';

import { useState } from 'react';
import { ColorSchemePreviewProps } from './types';
import { ClipboardIcon, CheckIcon } from '@heroicons/react/24/outline';
import { Button } from '@/lib/shadcn/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/lib/shadcn/card';

export default function ColorSchemePreview({ 
  palette 
}: ColorSchemePreviewProps) {
  const [copiedColor, setCopiedColor] = useState<string | null>(null);

  const copyToClipboard = (color: string, colorName: string) => {
    navigator.clipboard.writeText(color);
    setCopiedColor(colorName);
    setTimeout(() => setCopiedColor(null), 2000);
  };

  const colorEntries = [
    { name: 'Primary', value: palette.primary, description: 'Main brand color, buttons, links' },
    { name: 'Secondary', value: palette.secondary, description: 'Supporting elements, borders' },
    { name: 'Accent', value: palette.accent, description: 'Highlights, call-to-actions' },
    { name: 'Background', value: palette.background, description: 'Page background' },
    { name: 'Surface', value: palette.surface, description: 'Cards, panels, dialogs' },
    { name: 'Text', value: palette.text, description: 'Primary text content' },
    { name: 'Text Secondary', value: palette.textSecondary, description: 'Secondary text, captions' },
    { name: 'Success', value: palette.success, description: 'Success states, confirmations' },
    { name: 'Warning', value: palette.warning, description: 'Warning states, alerts' },
    { name: 'Error', value: palette.error, description: 'Error states, validations' },
    { name: 'Info', value: palette.info, description: 'Information, tips' },
  ];

  return (
    <div className="w-full max-w-6xl mx-auto space-y-4">
      {/* Palette Header */}
      <div className="text-center">
        <h3 className="text-2xl font-bold text-gray-900 mb-1">
          {palette.name || 'Color Palette Preview'}
        </h3>
        <p className="text-gray-600">
          See how your colors work together in a real interface
        </p>
      </div>

      {/* UI Preview */}
      <div 
        className="rounded-lg border shadow-lg overflow-hidden"
        style={{ backgroundColor: palette.background }}
      >
        {/* Header */}
        <div 
          className="px-3 py-2 border-b"
          style={{ 
            backgroundColor: palette.surface,
            borderColor: palette.secondary + '20'
          }}
        >
          <div className="flex items-center justify-between">
            <h2 
              className="text-lg font-semibold"
              style={{ color: palette.text }}
            >
              Sample Application
            </h2>
            <Button 
              style={{ 
                backgroundColor: palette.primary,
                color: palette.background,
                borderColor: palette.primary
              }}
            >
              Get Started
            </Button>
          </div>
        </div>

        {/* Content Area */}
        <div className="p-3 space-y-3">
          {/* Hero Section */}
          <div className="text-center py-4">
            <h1 
              className="text-3xl font-bold mb-2"
              style={{ color: palette.text }}
            >
              Welcome to Your App
            </h1>
            <p 
              className="text-lg mb-3"
              style={{ color: palette.textSecondary }}
            >
              This preview shows how your chosen colors work together in a real interface.
            </p>
            <div className="space-x-2">
              <Button
                style={{ 
                  backgroundColor: palette.accent,
                  color: palette.background,
                  borderColor: palette.accent
                }}
              >
                Primary Action
              </Button>
              <Button
                variant="outline"
                style={{ 
                  color: palette.primary,
                  borderColor: palette.primary
                }}
              >
                Secondary Action
              </Button>
            </div>
          </div>

          {/* Cards */}
          <div className="grid md:grid-cols-3 gap-2">
            {/* Success Card */}
            <Card 
              style={{ 
                backgroundColor: palette.surface,
                borderColor: palette.success + '30'
              }}
            >
              <CardHeader className="pb-1.5">
                <div 
                  className="w-6 h-6 rounded-full mb-1 flex items-center justify-center"
                  style={{ backgroundColor: palette.success + '20' }}
                >
                  <CheckIcon 
                    className="w-3 h-3"
                    style={{ color: palette.success }} 
                  />
                </div>
                <CardTitle 
                  className="text-base"
                  style={{ color: palette.text }}
                >
                  Success State
                </CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription 
                  style={{ color: palette.textSecondary }}
                >
                  Your action was completed successfully.
                </CardDescription>
              </CardContent>
            </Card>

            {/* Warning Card */}
            <Card 
              style={{ 
                backgroundColor: palette.surface,
                borderColor: palette.warning + '30'
              }}
            >
              <CardHeader className="pb-1.5">
                <div 
                  className="w-6 h-6 rounded-full mb-1 flex items-center justify-center"
                  style={{ backgroundColor: palette.warning + '20' }}
                >
                  <span 
                    className="text-lg font-bold"
                    style={{ color: palette.warning }}
                  >
                    !
                  </span>
                </div>
                <CardTitle 
                  className="text-base"
                  style={{ color: palette.text }}
                >
                  Warning State
                </CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription 
                  style={{ color: palette.textSecondary }}
                >
                  Please review this information carefully.
                </CardDescription>
              </CardContent>
            </Card>

            {/* Info Card */}
            <Card 
              style={{ 
                backgroundColor: palette.surface,
                borderColor: palette.info + '30'
              }}
            >
              <CardHeader className="pb-1.5">
                <div 
                  className="w-6 h-6 rounded-full mb-1 flex items-center justify-center"
                  style={{ backgroundColor: palette.info + '20' }}
                >
                  <span 
                    className="text-lg font-bold"
                    style={{ color: palette.info }}
                  >
                    i
                  </span>
                </div>
                <CardTitle 
                  className="text-base"
                  style={{ color: palette.text }}
                >
                  Information
                </CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription 
                  style={{ color: palette.textSecondary }}
                >
                  Here&apos;s some helpful information for you.
                </CardDescription>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      {/* Color Palette Details */}
      <div className="w-full max-w-3xl mx-auto">
        <h4 className="text-lg font-semibold text-gray-900 mb-2">Color Values</h4>
        <div className="grid md:grid-cols-2 gap-1">
          {colorEntries.map((color) => (
            <div 
              key={color.name}
              className="flex items-center space-x-1.5 p-1 rounded-lg border hover:bg-gray-50 transition-colors cursor-pointer"
              onClick={() => copyToClipboard(color.value, color.name)}
            >
              <div 
                className="w-3 h-3 rounded border flex-shrink-0"
                style={{ backgroundColor: color.value }}
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-gray-900 truncate">
                    {color.name}
                  </p>
                  {copiedColor === color.name ? (
                    <CheckIcon className="w-2 h-2 text-green-500 flex-shrink-0" />
                  ) : (
                    <ClipboardIcon className="w-2 h-2 text-gray-400 flex-shrink-0" />
                  )}
                </div>
                <div className="flex items-center justify-between">
                  <p className="text-xs text-gray-600 font-mono">{color.value}</p>
                  <p className="text-xs text-gray-500 truncate ml-1">{color.description}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
