export default function HomePage() {
  return (
    <div className="min-h-screen">
      {/* Hero section with editable text */}
      <div className="bg-gradient-to-br from-background to-muted/20 py-20">
        <div className="container mx-auto px-4 text-center space-y-8">
          <h1 className="text-5xl font-bold text-foreground">
            Hello World
          </h1>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            This will update as Airo builds out the app.
          </p>
        </div>
      </div>

    </div>
  );
}