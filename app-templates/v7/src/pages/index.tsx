import React from 'react';

// Geometric pattern component
function GeometricPattern() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {/* Animated floating shapes */}
      <div className="absolute top-1/4 left-1/4 w-32 h-32 bg-blue-200/20 rounded-full animate-pulse"></div>
      <div className="absolute top-1/3 right-1/4 w-24 h-24 bg-purple-200/20 rotate-45 animate-bounce" style={{ animationDuration: '3s' }}></div>
      <div className="absolute bottom-1/4 left-1/3 w-20 h-20 bg-indigo-200/20 transform rotate-12 animate-spin" style={{ animationDuration: '8s' }}></div>
      <div className="absolute top-1/2 right-1/3 w-16 h-16 bg-cyan-200/20 rounded-lg animate-pulse" style={{ animationDelay: '1s' }}></div>
      
      {/* Grid pattern */}
      <div className="absolute inset-0 bg-gradient-to-br from-transparent via-gray-50/5 to-transparent">
        <svg className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M 40 0 L 0 0 0 40" fill="none" stroke="currentColor" strokeWidth="0.5" opacity="0.1"/>
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#grid)" />
        </svg>
      </div>
      
      {/* Hexagonal shapes */}
      <div className="absolute top-20 right-20">
        <svg width="80" height="80" viewBox="0 0 100 100" className="text-blue-300/30 animate-spin" style={{ animationDuration: '12s' }}>
          <polygon points="30,10 70,10 90,50 70,90 30,90 10,50" fill="currentColor" />
        </svg>
      </div>
      
      <div className="absolute bottom-20 left-20">
        <svg width="60" height="60" viewBox="0 0 100 100" className="text-purple-300/30 animate-pulse">
          <polygon points="20,15 80,15 95,50 80,85 20,85 5,50" fill="currentColor" />
        </svg>
      </div>
    </div>
  );
}

export default function HomePage() {

  return (
    <div className="min-h-screen relative bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-100 dark:from-slate-900 dark:via-slate-800 dark:to-indigo-900">
      <GeometricPattern />
      
      {/* Main content */}
      <div className="relative z-10 flex items-center justify-center min-h-screen px-4">
        <div className="text-center space-y-8 max-w-4xl mx-auto">
          {/* Main title */}
          <div className="space-y-4">
            <h1 className="text-6xl md:text-8xl font-bold bg-gradient-to-r from-blue-600 via-purple-600 to-indigo-600 bg-clip-text text-transparent">
              App
            </h1>
            <p className="text-2xl md:text-3xl font-light text-slate-600 dark:text-slate-300">
              Welcome
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}