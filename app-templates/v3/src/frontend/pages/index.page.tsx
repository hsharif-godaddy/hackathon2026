import { Link } from 'react-router-dom';
import GeometricSpinner from '../components/GeometricSpinner';

export default function HomePage() {
  return (
    <div className="max-w-2xl mx-auto text-center">
      <div className="mb-8">
        <GeometricSpinner size="lg" className="mx-auto mb-6" />
        
        <h1 className="text-4xl font-bold text-foreground mb-4">
          V3 App Template
        </h1>
        <p className="text-xl text-muted-foreground mb-8">
          A modern, type-safe React application template built with Vite, Hono, and shadcn/ui
        </p>
        
        <Link
          to="/about"
          className="bg-primary text-primary-foreground px-6 py-3 rounded-md hover:bg-primary/90 transition-colors font-medium"
        >
          Learn More
        </Link>
      </div>
    </div>
  );
}
