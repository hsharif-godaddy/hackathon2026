import { Link } from "../router";
import { Button } from "@/components/ui/button";

export default function NotFoundPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-primary to-secondary">
      <div className="container mx-auto max-w-2xl px-4 text-center">
        <div className="space-y-8">
          <div className="space-y-4">
            <h1 className="text-6xl font-bold text-primary-foreground/90">404</h1>
            <h2 className="text-2xl font-semibold text-primary-foreground/90">Page Not Found</h2>
            <p className="text-primary-foreground/80">
              Sorry, the page you're looking for doesn't exist or has been moved.
            </p>
          </div>

          <div className="flex justify-center gap-4">
            <Button
              asChild
              variant="secondary"
              size="lg"
              className="font-semibold shadow-lg transition-all hover:scale-105 hover:shadow-xl"
            >
              <Link to="/">🏠 Go Home</Link>
            </Button>
            <Button
              variant="secondary"
              size="lg"
              className="font-semibold shadow-lg transition-all hover:scale-105 hover:shadow-xl"
              onClick={() => window.history.back()}
            >
              ← Go Back
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
