import { Link } from '../router';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';

/**
 * 404 Not Found page component
 *
 * Displays a user-friendly error page when a route is not found.
 * Includes navigation to available pages and a back button.
 * The layout (header/footer) is handled by RootLayout in App.tsx.
 */
export default function NotFoundPage() {
  return (
    <div className="bg-gradient-to-br from-red-50 to-orange-100 dark:from-gray-900 dark:to-red-900 flex items-center justify-center py-12">
      <div className="container mx-auto px-4 max-w-2xl text-center">
        <div className="space-y-8">
          <div className="space-y-4">
            <div className="text-8xl">🚫</div>
            <h1 className="text-6xl font-bold text-gray-900 dark:text-white">
              404
            </h1>
            <h2 className="text-2xl font-semibold text-gray-700 dark:text-gray-300">
              Page Not Found
            </h2>
            <p className="text-gray-600 dark:text-gray-400">
              Sorry, the page you're looking for doesn't exist or has been moved.
            </p>
          </div>

          <Card className="text-left">
            <CardHeader>
              <CardTitle>🗂️ Available Pages</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-2">
                <Link to="/">
                  <Button variant="ghost" size="sm" className="w-full justify-start">
                    🏠 Home - Main dashboard and API demo
                  </Button>
                </Link>
                <Link to="/about">
                  <Button variant="ghost" size="sm" className="w-full justify-start">
                    📋 About - Learn about the template
                  </Button>
                </Link>
                <Link to="/docs">
                  <Button variant="ghost" size="sm" className="w-full justify-start">
                    📚 Documentation - Setup and configuration
                  </Button>
                </Link>
                <Link to="/examples">
                  <Button variant="ghost" size="sm" className="w-full justify-start">
                    🎯 Examples - Interactive demos
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>

          <div className="flex justify-center gap-4">
            <Link to="/">
              <Button>🏠 Go Home</Button>
            </Link>
            <Button variant="outline" onClick={() => window.history.back()}>
              ← Go Back
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
