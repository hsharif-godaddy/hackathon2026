import Link from 'next/link'
import {
  SparklesIcon,
  CodeBracketIcon,
  DocumentTextIcon
} from '@heroicons/react/24/outline'

export default function Documentation() {
  const techStack = [
    {
      category: "Frontend",
      technologies: [
        { name: "Next.js 14+", description: "App Router with React 18+", icon: "⚛️" },
        { name: "TypeScript", description: "Full type safety", icon: "🔷" },
        { name: "Tailwind CSS", description: "Utility-first styling", icon: "🎨" },
        { name: "shadcn/ui", description: "Beautiful component library", icon: "🧩" }
      ]
    },
    {
      category: "Backend",
      technologies: [
        { name: "Next.js API Routes", description: "Serverless API endpoints", icon: "🔗" },
        { name: "Server Actions", description: "Type-safe server functions", icon: "⚡" },
        { name: "Prisma ORM", description: "Type-safe database access", icon: "🗃️" },
        { name: "PostgreSQL", description: "Robust relational database", icon: "🐘" }
      ]
    },
    {
      category: "Authentication & Testing",
      technologies: [
        { name: "NextAuth.js", description: "Complete auth solution", icon: "🔐" },
        { name: "Vitest", description: "Fast unit testing", icon: "🧪" },
        { name: "React Testing Library", description: "Component testing", icon: "📋" },
        { name: "Playwright", description: "End-to-end testing", icon: "🎭" }
      ]
    },
    {
      category: "Development Tools",
      technologies: [
        { name: "ESLint", description: "Code linting", icon: "📏" },
        { name: "Prettier", description: "Code formatting", icon: "✨" },
        { name: "pnpm", description: "Fast package manager", icon: "📦" },
        { name: "TypeScript", description: "Static type checking", icon: "🔍" }
      ]
    }
  ]

  const templates = [
    {
      name: "Content Management System",
      description: "Built on Payload CMS - The most powerful open-source headless CMS with auto-generated admin interface",
      features: ["Visual content editing", "Auto-generated APIs", "Field-level permissions", "Code-first approach"],
      technologies: ["Payload CMS", "Next.js", "TypeScript", "PostgreSQL"],
      icon: DocumentTextIcon,
      href: "/docs/templates/cms",
      difficulty: "Beginner",
      highlight: "Built on Payload CMS"
    }
  ]

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-white to-blue-50">
      {/* Header */}
      <header className="border-b border-gray-100 bg-white/80 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <Link href="/" className="flex items-center space-x-3">
              <div className="w-8 h-8 bg-gradient-to-r from-purple-600 to-blue-600 rounded-lg flex items-center justify-center">
                <SparklesIcon className="w-5 h-5 text-white" />
              </div>
              <span className="text-xl font-bold bg-gradient-to-r from-purple-600 to-blue-600 bg-clip-text text-transparent">
                Airo
              </span>
            </Link>
            <nav className="hidden md:flex space-x-8">
              <Link href="/" className="text-gray-600 hover:text-gray-900 transition-colors">
                Home
              </Link>
              <Link href="/pricing" className="text-gray-600 hover:text-gray-900 transition-colors">
                Pricing
              </Link>
              <Link href="/team" className="text-gray-600 hover:text-gray-900 transition-colors">
                Meet the Agents
              </Link>
              <Link href="/docs" className="text-purple-600 font-medium">
                Documentation
              </Link>
            </nav>
            <div className="flex items-center space-x-4">
              <Link
                href="/app-plan"
                className="bg-gradient-to-r from-purple-600 to-blue-600 text-white px-6 py-2 rounded-lg font-semibold hover:shadow-lg transition-all duration-200 hover:scale-105"
              >
                Get Started
              </Link>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        {/* Hero Section */}
        <div className="text-center mb-16">
          <h1 className="text-4xl md:text-5xl font-bold text-gray-900 mb-6">
            <span className="bg-gradient-to-r from-purple-600 to-blue-600 bg-clip-text text-transparent">
              Airo
            </span>{' '}
            Documentation
          </h1>
          <p className="text-xl text-gray-600 mb-8 max-w-3xl mx-auto">
            Everything you need to know about our standardized tech stack and starter templates.
            Build production-ready applications with proven technologies and best practices.
          </p>
        </div>

        {/* Tech Stack Section */}
        <section className="mb-20">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-gray-900 mb-4">Our Standardized Tech Stack</h2>
            <p className="text-lg text-gray-600 max-w-2xl mx-auto">
              We use a curated, best-in-class TypeScript/React/Node.js stack that eliminates decision fatigue
              and ensures every application follows modern best practices.
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8">
            {techStack.map((category, index) => (
              <div key={index} className="bg-white rounded-xl border border-gray-200 p-6 hover:shadow-lg transition-shadow">
                <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
                  <CodeBracketIcon className="w-5 h-5 mr-2 text-purple-600" />
                  {category.category}
                </h3>
                <div className="space-y-3">
                  {category.technologies.map((tech, techIndex) => (
                    <div key={techIndex} className="flex items-start space-x-3">
                      <span className="text-lg">{tech.icon}</span>
                      <div>
                        <div className="font-medium text-gray-900 text-sm">{tech.name}</div>
                        <div className="text-xs text-gray-600">{tech.description}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-8 bg-gradient-to-r from-purple-50 to-blue-50 rounded-xl p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-3">Why This Stack?</h3>
            <div className="grid md:grid-cols-3 gap-4 text-sm text-gray-700">
              <div>
                <span className="font-medium">🚀 Performance:</span> Optimized for speed with SSR, SSG, and edge computing
              </div>
              <div>
                <span className="font-medium">🔒 Type Safety:</span> End-to-end TypeScript prevents runtime errors
              </div>
              <div>
                <span className="font-medium">🛠 Developer Experience:</span> Hot reload, excellent tooling, and great docs
              </div>
            </div>
          </div>
        </section>

        {/* Templates Section */}
        <section>
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-gray-900 mb-4">Featured Template</h2>
            <p className="text-lg text-gray-600 max-w-2xl mx-auto">
              Start with our Content Management System template, powered by Payload CMS - the most advanced 
              open-source headless CMS. Perfect for any content-driven application.
            </p>
          </div>

          <div className="max-w-2xl mx-auto">
            {templates.map((template, index) => (
              <div key={index} className="bg-white rounded-xl border border-gray-200 p-8 hover:shadow-lg transition-all duration-200">
                <div className="flex items-center mb-6">
                  <div className="w-16 h-16 bg-gradient-to-r from-purple-100 to-blue-100 rounded-xl flex items-center justify-center mr-4">
                    <template.icon className="w-8 h-8 text-purple-600" />
                  </div>
                  <div>
                    <h3 className="text-2xl font-semibold text-gray-900 mb-2">{template.name}</h3>
                    <div className="flex items-center space-x-3">
                      <span className="px-3 py-1 bg-green-100 text-green-700 text-sm font-medium rounded-full">
                        {template.difficulty}
                      </span>
                      <span className="px-3 py-1 bg-purple-100 text-purple-700 text-sm font-medium rounded-full">
                        {template.highlight}
                      </span>
                    </div>
                  </div>
                </div>

                <p className="text-gray-600 mb-6 text-lg leading-relaxed">{template.description}</p>

                <div className="mb-6">
                  <h4 className="text-lg font-medium text-gray-900 mb-3">What You Get:</h4>
                  <div className="grid grid-cols-2 gap-3">
                    {template.features.map((feature, featureIndex) => (
                      <div key={featureIndex} className="text-sm text-gray-700 flex items-center">
                        <div className="w-2 h-2 bg-purple-400 rounded-full mr-3"></div>
                        {feature}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="mb-8">
                  <h4 className="text-lg font-medium text-gray-900 mb-3">Built With:</h4>
                  <div className="flex flex-wrap gap-3">
                    {template.technologies.map((tech, techIndex) => (
                      <span key={techIndex} className="px-3 py-2 bg-gray-100 text-gray-700 text-sm rounded-lg font-medium">
                        {tech}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="flex gap-4">
                  <Link
                    href={template.href}
                    className="flex-1 inline-flex items-center justify-center px-6 py-3 bg-gradient-to-r from-purple-600 to-blue-600 text-white font-semibold rounded-lg hover:shadow-lg transition-all duration-200"
                  >
                    View Template Details
                    <CodeBracketIcon className="w-5 h-5 ml-2" />
                  </Link>
                  <Link
                    href="/app-plan"
                    className="flex-1 inline-flex items-center justify-center px-6 py-3 border-2 border-purple-600 text-purple-600 font-semibold rounded-lg hover:bg-purple-50 transition-all duration-200"
                  >
                    Start Building Now
                  </Link>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-12 text-center">
            <div className="bg-gradient-to-r from-purple-50 to-blue-50 rounded-xl p-6 max-w-2xl mx-auto">
              <h3 className="text-lg font-semibold text-gray-900 mb-2">More Templates Coming Soon</h3>
              <p className="text-gray-600 text-sm">
                We're working on additional templates including E-commerce, AI Chat Bots, and Analytics Dashboards. 
                Each will be built with the same attention to detail and powered by best-in-class open source solutions.
              </p>
            </div>
          </div>
        </section>

        {/* Getting Started CTA */}
        <section className="mt-20">
          <div className="bg-gradient-to-r from-purple-600 to-blue-600 rounded-2xl p-8 text-center text-white">
            <h2 className="text-3xl font-bold mb-4">Ready to Start Building?</h2>
            <p className="text-lg mb-8 opacity-90 max-w-2xl mx-auto">
              Choose a template and let our AI agents help you customize it for your specific needs.
              From concept to production in hours, not weeks.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link
                href="/app-plan"
                className="inline-flex items-center justify-center px-8 py-3 bg-white text-purple-600 font-semibold rounded-lg hover:bg-gray-50 transition-colors"
              >
                <SparklesIcon className="w-5 h-5 mr-2" />
                Start Building Now
              </Link>
              <Link
                href="/pricing"
                className="inline-flex items-center justify-center px-8 py-3 border-2 border-white text-white font-semibold rounded-lg hover:bg-white hover:text-purple-600 transition-colors"
              >
                View Pricing Plans
              </Link>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-200 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="text-center text-gray-600">
            <p>&copy; 2024 Airo AI Builder. Built with AI for the future.</p>
          </div>
        </div>
      </footer>
    </div>
  )
}
