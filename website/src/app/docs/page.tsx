import Link from 'next/link'
import {
  SparklesIcon,
  CodeBracketIcon,
  CubeTransparentIcon,
  DocumentTextIcon,
  ChatBubbleLeftRightIcon,
  ShoppingCartIcon,
  AcademicCapIcon,
  UserGroupIcon,
  ChartBarIcon,
  GlobeAltIcon
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
      description: "Headless CMS with admin interface and content API",
      features: ["Rich text editor", "Media management", "API-first architecture", "Role-based access"],
      technologies: ["Next.js", "Prisma", "PostgreSQL", "shadcn/ui"],
      icon: DocumentTextIcon,
      href: "/docs/templates/cms",
      difficulty: "Beginner",
      timeEstimate: "2-3 hours"
    },
    {
      name: "AI Support Chat Bot",
      description: "LLM-powered customer service agent with knowledge base",
      features: ["Real-time chat", "Vector search", "Context awareness", "Multi-language support"],
      technologies: ["Next.js", "Anthropic Claude", "Vector DB", "WebSockets"],
      icon: ChatBubbleLeftRightIcon,
      href: "/docs/templates/chatbot",
      difficulty: "Intermediate",
      timeEstimate: "4-5 hours"
    },
    {
      name: "E-commerce Platform",
      description: "Full-featured online store with payments and inventory",
      features: ["Product catalog", "Shopping cart", "Payment processing", "Order management"],
      technologies: ["Next.js", "Stripe", "Prisma", "Redis"],
      icon: ShoppingCartIcon,
      href: "/docs/templates/ecommerce",
      difficulty: "Advanced",
      timeEstimate: "6-8 hours"
    },
    {
      name: "Learning Management System",
      description: "Course platform with progress tracking and assessments",
      features: ["Course creation", "Progress tracking", "Video streaming", "Certificates"],
      technologies: ["Next.js", "Prisma", "S3", "Video API"],
      icon: AcademicCapIcon,
      href: "/docs/templates/lms",
      difficulty: "Advanced",
      timeEstimate: "8-10 hours"
    },
    {
      name: "Social Media Platform",
      description: "Social networking with posts, comments, and real-time features",
      features: ["User profiles", "Real-time feeds", "Media sharing", "Social interactions"],
      technologies: ["Next.js", "WebSockets", "Redis", "Image CDN"],
      icon: UserGroupIcon,
      href: "/docs/templates/social",
      difficulty: "Advanced",
      timeEstimate: "10-12 hours"
    },
    {
      name: "Analytics Dashboard",
      description: "Business intelligence platform with charts and reports",
      features: ["Data visualization", "Custom dashboards", "Real-time metrics", "Export tools"],
      technologies: ["Next.js", "Chart.js", "ClickHouse", "WebSockets"],
      icon: ChartBarIcon,
      href: "/docs/templates/analytics",
      difficulty: "Intermediate",
      timeEstimate: "5-6 hours"
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
                href="/builder"
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
            <h2 className="text-3xl font-bold text-gray-900 mb-4">Starter Templates</h2>
            <p className="text-lg text-gray-600 max-w-2xl mx-auto">
              Jump-start your development with our pre-built templates. Each template uses our standardized 
              tech stack and includes best practices for security, performance, and scalability.
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            {templates.map((template, index) => (
              <div key={index} className="bg-white rounded-xl border border-gray-200 p-6 hover:shadow-lg transition-all duration-200 hover:scale-105">
                <div className="flex items-center mb-4">
                  <div className="w-10 h-10 bg-gradient-to-r from-purple-100 to-blue-100 rounded-lg flex items-center justify-center mr-3">
                    <template.icon className="w-6 h-6 text-purple-600" />
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900">{template.name}</h3>
                    <div className="flex items-center space-x-2 text-sm">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                        template.difficulty === 'Beginner' ? 'bg-green-100 text-green-700' :
                        template.difficulty === 'Intermediate' ? 'bg-yellow-100 text-yellow-700' :
                        'bg-red-100 text-red-700'
                      }`}>
                        {template.difficulty}
                      </span>
                      <span className="text-gray-500">•</span>
                      <span className="text-gray-600">{template.timeEstimate}</span>
                    </div>
                  </div>
                </div>

                <p className="text-gray-600 mb-4">{template.description}</p>

                <div className="mb-4">
                  <h4 className="text-sm font-medium text-gray-900 mb-2">Key Features:</h4>
                  <div className="grid grid-cols-2 gap-1">
                    {template.features.map((feature, featureIndex) => (
                      <div key={featureIndex} className="text-xs text-gray-600 flex items-center">
                        <div className="w-1 h-1 bg-purple-400 rounded-full mr-2"></div>
                        {feature}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="mb-6">
                  <h4 className="text-sm font-medium text-gray-900 mb-2">Technologies:</h4>
                  <div className="flex flex-wrap gap-2">
                    {template.technologies.map((tech, techIndex) => (
                      <span key={techIndex} className="px-2 py-1 bg-gray-100 text-gray-700 text-xs rounded-md">
                        {tech}
                      </span>
                    ))}
                  </div>
                </div>

                <Link
                  href={template.href}
                  className="inline-flex items-center justify-center w-full px-4 py-2 bg-gradient-to-r from-purple-600 to-blue-600 text-white text-sm font-medium rounded-lg hover:shadow-lg transition-all duration-200"
                >
                  View Template Details
                  <CodeBracketIcon className="w-4 h-4 ml-2" />
                </Link>
              </div>
            ))}
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
                href="/builder"
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
