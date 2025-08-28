export default function HomePage() {
  return (
    <div className="min-h-screen">
      {/* Hero section with editable text */}
      <div className="py-20">
        <div className="container mx-auto px-4 py-24 text-center flex flex-col items-center gap-12">
          <div className="animate-spin rounded-full h-24 w-24 border-b-4 border-purple-600" />
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            This will update as Airo builds out the app.
          </p>
        </div>
      </div>

    </div>
  );
}