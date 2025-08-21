import GeometricSpinner from '../components/GeometricSpinner';

export default function HomePage() {
  return (
    <div className="min-h-screen">
      {/* Full-height spinner section */}
      <div className="h-screen flex items-center justify-center bg-gradient-to-br from-background to-muted/20">
        <div className="text-center space-y-8">
          <GeometricSpinner size="hero" className="mx-auto" />
        </div>
      </div>
    </div>
  );
}