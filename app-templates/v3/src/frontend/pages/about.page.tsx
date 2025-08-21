export default function AboutPage() {
  return (
    <div className="max-w-3xl mx-auto prose prose-slate dark:prose-invert">
      <h1 className="text-3xl font-bold text-foreground mb-6">About V3 App Template</h1>
      
      <div className="space-y-6 text-muted-foreground">
        <p>
          The V3 App Template is a modern, production-ready web application starter that combines 
          the best tools and practices for building scalable, maintainable applications.
        </p>

        <section>
          <h2 className="text-2xl font-semibold text-foreground mb-3">Technology Stack</h2>
          <ul className="space-y-2">
            <li><strong>Frontend:</strong> React 19, TypeScript, Vite, Tailwind CSS</li>
            <li><strong>Backend:</strong> Hono, Node.js, Zod validation</li>
            <li><strong>UI Components:</strong> Ready for shadcn/ui, Radix UI, Lucide React</li>
            <li><strong>Routing:</strong> React Router DOM v7</li>
            <li><strong>Build Tool:</strong> Vite with custom plugins</li>
            <li><strong>Testing:</strong> Vitest, React Testing Library</li>
          </ul>
        </section>

        <section>
          <h2 className="text-2xl font-semibold text-foreground mb-3">Key Features</h2>
          <ul className="space-y-2">
            <li>🚀 Lightning-fast development with Vite</li>
            <li>🎯 Full TypeScript type safety</li>
            <li>🎨 Beautiful, accessible UI components ready for shadcn/ui</li>
            <li>🧠 AI-friendly development patterns with component introspection</li>
            <li>📱 Responsive, mobile-first design with Tailwind CSS</li>
            <li>⚡ Server-side rendering support with vite-plugin-ssr</li>
            <li>🔧 Custom Vite plugin for source mapping</li>
            <li>🧪 Testing setup ready with Vitest</li>
          </ul>
        </section>

        <section>
          <h2 className="text-2xl font-semibold text-foreground mb-3">AI Integration</h2>
          <p>
            This template is specifically designed for AI-assisted development. The custom Vite plugin 
            adds source information to components in development mode, making it easy for AI tools to 
            understand your application structure and provide accurate assistance.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-semibold text-foreground mb-3">Getting Started</h2>
          <p>
            Clone this template and run <code className="bg-muted px-2 py-1 rounded">npm install</code> 
            followed by <code className="bg-muted px-2 py-1 rounded">npm run dev</code> to start 
            developing your application.
          </p>
        </section>
      </div>
    </div>
  );
}
