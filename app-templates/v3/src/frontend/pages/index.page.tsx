import GeometricSpinner from '../components/GeometricSpinner';

export default function HomePage() {
  return (
    <div className="min-h-screen">
      {/* Hero section with editable text */}
      <div className="bg-gradient-to-br from-background to-muted/20 py-20">
        <div className="container mx-auto px-4 text-center space-y-8">
          <h1 className="text-5xl font-bold text-foreground">
            Welcome to V3 App
          </h1>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            This is a modern web application built with Vite, React, and cutting-edge tools. 
            Click on any text to edit it inline!
          </p>
          <div className="flex justify-center">
            <GeometricSpinner size="hero" className="mx-auto" />
          </div>
        </div>
      </div>

    </div>
  );
}