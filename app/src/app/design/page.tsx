'use client';

import { useState } from 'react';
import { ColorSchemeDrawer, ColorPalette } from '../components/color';
import { Button } from '@/lib/shadcn/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/lib/shadcn/card';

export default function DesignPage() {
  const [isColorDrawerOpen, setIsColorDrawerOpen] = useState(false);
  const [currentPalette, setCurrentPalette] = useState<ColorPalette | null>(null);

  const handleColorSchemeComplete = (palette: ColorPalette) => {
    setCurrentPalette(palette);
    console.log('Selected color palette:', palette);
    // Here you would save the palette using the app_plan tool
  };

  return (
    <div className="min-h-screen">
      <div className="max-w-6xl mx-auto px-2 py-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-3xl font-bold">Design Your App</h1>
            <p className="mt-1">
              Customize the look and feel of your application
            </p>
          </div>
          
          <Button 
            onClick={() => setIsColorDrawerOpen(true)}
            className="bg-blue-600 hover:bg-blue-700"
          >
            Choose Colors
          </Button>
        </div>

        {/* Design Options */}
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
          {/* Color Scheme Card */}
          <Card className="cursor-pointer hover:shadow-md transition-shadow">
            <CardHeader>
              <CardTitle className="flex items-center space-x-1">
                <div className="w-2.5 h-2.5 rounded-full" />
                <span>Color Scheme</span>
              </CardTitle>
              <CardDescription>
                Choose colors that represent your brand
              </CardDescription>
            </CardHeader>
            <CardContent>
              {currentPalette ? (
                <div className="space-y-1.5">
                  <p className="text-sm font-medium">
                    Current: {currentPalette.name}
                  </p>
                  <div className="flex space-x-1">
                    <div 
                      className="w-4 h-4 rounded border shadow-sm"
                      style={{ backgroundColor: currentPalette.primary }}
                    />
                    <div 
                      className="w-4 h-4 rounded border shadow-sm"
                      style={{ backgroundColor: currentPalette.secondary }}
                    />
                    <div 
                      className="w-4 h-4 rounded border shadow-sm"
                      style={{ backgroundColor: currentPalette.accent }}
                    />
                    <div 
                      className="w-4 h-4 rounded border shadow-sm"
                      style={{ backgroundColor: currentPalette.surface }}
                    />
                  </div>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={() => setIsColorDrawerOpen(true)}
                    className="w-full"
                  >
                    Change Colors
                  </Button>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <p className="text-sm">
                    No color scheme selected
                  </p>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={() => setIsColorDrawerOpen(true)}
                    className="w-full"
                  >
                    Choose Colors
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Typography Card */}
          <Card className="cursor-pointer hover:shadow-md transition-shadow">
            <CardHeader>
              <CardTitle className="flex items-center space-x-1">
                <div className="w-2.5 h-2.5 rounded-full" />
                <span>Typography</span>
              </CardTitle>
              <CardDescription>
                Select fonts and text styles
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm mb-1.5">
                Coming soon
              </p>
              <Button variant="outline" size="sm" disabled className="w-full">
                Choose Fonts
              </Button>
            </CardContent>
          </Card>

          {/* Layout Card */}
          <Card className="cursor-pointer hover:shadow-md transition-shadow">
            <CardHeader>
              <CardTitle className="flex items-center space-x-1">
                <div className="w-2.5 h-2.5 rounded-full" />
                <span>Layout</span>
              </CardTitle>
              <CardDescription>
                Configure layout and spacing
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm mb-1.5">
                Coming soon
              </p>
              <Button variant="outline" size="sm" disabled className="w-full">
                Choose Layout
              </Button>
            </CardContent>
          </Card>

          {/* Components Card */}
          <Card className="cursor-pointer hover:shadow-md transition-shadow">
            <CardHeader>
              <CardTitle className="flex items-center space-x-1">
                <div className="w-2.5 h-2.5 rounded-full" />
                <span>Components</span>
              </CardTitle>
              <CardDescription>
                Customize UI components
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm mb-1.5">
                Coming soon
              </p>
              <Button variant="outline" size="sm" disabled className="w-full">
                Customize
              </Button>
            </CardContent>
          </Card>

          {/* Themes Card */}
          <Card className="cursor-pointer hover:shadow-md transition-shadow">
            <CardHeader>
              <CardTitle className="flex items-center space-x-1">
                <div className="w-2.5 h-2.5 rounded-full" />
                <span>Themes</span>
              </CardTitle>
              <CardDescription>
                Apply pre-made themes
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm mb-1.5">
                Coming soon
              </p>
              <Button variant="outline" size="sm" disabled className="w-full">
                Browse Themes
              </Button>
            </CardContent>
          </Card>

          {/* Export Card */}
          <Card className="cursor-pointer hover:shadow-md transition-shadow">
            <CardHeader>
              <CardTitle className="flex items-center space-x-1">
                <div className="w-2.5 h-2.5 rounded-full" />
                <span>Export</span>
              </CardTitle>
              <CardDescription>
                Export your design system
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm mb-1.5">
                Export CSS, Figma tokens, etc.
              </p>
              <Button variant="outline" size="sm" disabled className="w-full">
                Export Design
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* Preview Section */}
        {currentPalette && (
          <div className="mt-6">
            <h2 className="text-2xl font-bold mb-3">Preview</h2>
            <Card>
              <CardContent className="p-3">
                <div 
                  className="rounded-lg border p-3"
                  style={{ backgroundColor: currentPalette.background }}
                >
                  <div className="flex items-center justify-between mb-3">
                    <h3 
                      className="text-lg font-semibold"
                      style={{ color: currentPalette.text }}
                    >
                      Sample Application
                    </h3>
                    <Button
                      style={{ 
                        backgroundColor: currentPalette.primary,
                        borderColor: currentPalette.primary,
                        color: currentPalette.background
                      }}
                    >
                      Get Started
                    </Button>
                  </div>
                  
                  <div className="grid md:grid-cols-3 gap-2">
                    <div 
                      className="p-2 rounded border"
                      style={{ 
                        backgroundColor: currentPalette.surface,
                        borderColor: currentPalette.secondary + '30'
                      }}
                    >
                      <h4 
                        className="font-medium mb-1"
                        style={{ color: currentPalette.text }}
                      >
                        Sample Card
                      </h4>
                      <p 
                        className="text-sm"
                        style={{ color: currentPalette.textSecondary }}
                      >
                        This shows how your colors work together in a real interface.
                      </p>
                    </div>
                    
                    <div 
                      className="p-2 rounded border"
                      style={{ 
                        backgroundColor: currentPalette.surface,
                        borderColor: currentPalette.accent + '30'
                      }}
                    >
                      <div 
                        className="w-4 h-4 rounded mb-1"
                        style={{ backgroundColor: currentPalette.accent }}
                      />
                      <h4 
                        className="font-medium mb-1"
                        style={{ color: currentPalette.text }}
                      >
                        Accent Color
                      </h4>
                      <p 
                        className="text-sm"
                        style={{ color: currentPalette.textSecondary }}
                      >
                        Used for highlights and call-to-actions.
                      </p>
                    </div>
                    
                    <div 
                      className="p-2 rounded border"
                      style={{ 
                        backgroundColor: currentPalette.surface,
                        borderColor: currentPalette.success + '30'
                      }}
                    >
                      <div 
                        className="w-4 h-4 rounded mb-1"
                        style={{ backgroundColor: currentPalette.success }}
                      />
                      <h4 
                        className="font-medium mb-1"
                        style={{ color: currentPalette.text }}
                      >
                        Success State
                      </h4>
                      <p 
                        className="text-sm"
                        style={{ color: currentPalette.textSecondary }}
                      >
                        Positive feedback and confirmations.
                      </p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>

      {/* Color Scheme Drawer */}
      <ColorSchemeDrawer
        isOpen={isColorDrawerOpen}
        onClose={() => setIsColorDrawerOpen(false)}
        onComplete={handleColorSchemeComplete}
        appId="demo-app"
      />
    </div>
  );
}
