import Link from 'next/link'
import {
  SparklesIcon,
  DocumentTextIcon,
  CodeBracketIcon,
  CubeTransparentIcon,
  ArrowLeftIcon,
  PlayIcon,
  CheckCircleIcon,
  ClockIcon,
  UserGroupIcon
} from '@heroicons/react/24/outline'

export default function CMSTemplate() {
  const features = [
    {
      title: "Visual Content Editing",
      description: "Intuitive admin panel that automatically adapts to your content structure with live preview",
      icon: DocumentTextIcon,
      details: ["Auto-generated admin UI", "Live preview editing", "Extensible rich text editor", "Visual field builder"]
    },
    {
      title: "Complete Content Control",
      description: "Manage any type of content with flexible field types and custom validation rules",
      icon: CubeTransparentIcon,
      details: ["Custom field types", "Content relationships", "File & media uploads", "Multi-language support"]
    },
    {
      title: "Instant APIs",
      description: "Get REST and GraphQL APIs automatically generated from your content structure",
      icon: CodeBracketIcon,
      details: ["Auto-generated REST APIs", "GraphQL support", "Real-time webhooks", "Custom API endpoints"]
    },
    {
      title: "Enterprise Security",
      description: "Granular access control with document and field-level permissions for teams",
      icon: UserGroupIcon,
      details: ["Field-level permissions", "Custom user roles", "Document-level access", "Authentication built-in"]
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

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Breadcrumb */}
        <div className="flex items-center space-x-2 text-sm text-gray-600 mb-8">
          <Link href="/docs" className="hover:text-purple-600 transition-colors">Documentation</Link>
          <span>/</span>
          <span>Templates</span>
          <span>/</span>
          <span className="text-gray-900 font-medium">Content Management System</span>
        </div>

        {/* Hero Section */}
        <div className="mb-16">
          <div className="flex items-center mb-6">
            <Link
              href="/docs"
              className="inline-flex items-center text-purple-600 hover:text-purple-700 transition-colors mr-6"
            >
              <ArrowLeftIcon className="w-4 h-4 mr-2" />
              Back to Documentation
            </Link>
            <div className="flex items-center space-x-3">
              <span className="px-3 py-1 bg-green-100 text-green-700 text-sm font-medium rounded-full">
                Beginner Friendly
              </span>
              <span className="flex items-center text-sm text-gray-600">
                <ClockIcon className="w-4 h-4 mr-1" />
                2-3 hours setup
              </span>
            </div>
          </div>

          <div className="flex items-center mb-6">
            <div className="w-16 h-16 bg-gradient-to-r from-purple-100 to-blue-100 rounded-xl flex items-center justify-center mr-6">
              <DocumentTextIcon className="w-8 h-8 text-purple-600" />
            </div>
            <div>
              <h1 className="text-4xl font-bold text-gray-900 mb-2">
                Content Management System
              </h1>
              <p className="text-xl text-gray-600">
                Built on Payload CMS - The most powerful open-source headless CMS
              </p>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <div className="grid md:grid-cols-3 gap-6">
              <div className="text-center">
                <div className="text-2xl font-bold text-purple-600 mb-1">Code-First</div>
                <div className="text-sm text-gray-600">Define content in TypeScript</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-blue-600 mb-1">Self-Hosted</div>
                <div className="text-sm text-gray-600">Complete data ownership</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-green-600 mb-1">Open Source</div>
                <div className="text-sm text-gray-600">MIT License, fully extensible</div>
              </div>
            </div>
          </div>
        </div>

        {/* Features Section */}
        <section className="mb-16">
          <h2 className="text-3xl font-bold text-gray-900 mb-8">Key Features</h2>
          <div className="grid md:grid-cols-2 gap-8">
            {features.map((feature, index) => (
              <div key={index} className="bg-white rounded-xl border border-gray-200 p-6 hover:shadow-lg transition-shadow">
                <div className="flex items-center mb-4">
                  <div className="w-10 h-10 bg-gradient-to-r from-purple-100 to-blue-100 rounded-lg flex items-center justify-center mr-4">
                    <feature.icon className="w-6 h-6 text-purple-600" />
                  </div>
                  <h3 className="text-lg font-semibold text-gray-900">{feature.title}</h3>
                </div>
                <p className="text-gray-600 mb-4">{feature.description}</p>
                <div className="grid grid-cols-2 gap-2">
                  {feature.details.map((detail, detailIndex) => (
                    <div key={detailIndex} className="flex items-center text-sm text-gray-700">
                      <CheckCircleIcon className="w-4 h-4 text-green-500 mr-2" />
                      {detail}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* What You Can Build Section */}
        <section className="mb-16">
          <h2 className="text-3xl font-bold text-gray-900 mb-8">What You Can Build</h2>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            <div className="bg-white rounded-xl border border-gray-200 p-6 hover:shadow-lg transition-shadow">
              <h3 className="text-lg font-semibold text-gray-900 mb-3">Marketing Websites</h3>
              <p className="text-gray-600 text-sm mb-4">Landing pages, company sites, portfolios with dynamic content management</p>
              <div className="text-xs text-purple-600 font-medium">Perfect for agencies & consultants</div>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-6 hover:shadow-lg transition-shadow">
              <h3 className="text-lg font-semibold text-gray-900 mb-3">Blog Platforms</h3>
              <p className="text-gray-600 text-sm mb-4">Multi-author blogs with categories, tags, and publishing workflows</p>
              <div className="text-xs text-purple-600 font-medium">Ideal for content creators</div>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-6 hover:shadow-lg transition-shadow">
              <h3 className="text-lg font-semibold text-gray-900 mb-3">E-commerce Backends</h3>
              <p className="text-gray-600 text-sm mb-4">Product catalogs, inventory management, and order processing</p>
              <div className="text-xs text-purple-600 font-medium">Great for online stores</div>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-6 hover:shadow-lg transition-shadow">
              <h3 className="text-lg font-semibold text-gray-900 mb-3">Documentation Sites</h3>
              <p className="text-gray-600 text-sm mb-4">Knowledge bases, API docs, and help centers with search</p>
              <div className="text-xs text-purple-600 font-medium">Essential for SaaS companies</div>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-6 hover:shadow-lg transition-shadow">
              <h3 className="text-lg font-semibold text-gray-900 mb-3">News & Media</h3>
              <p className="text-gray-600 text-sm mb-4">Editorial workflows, breaking news, and multimedia content</p>
              <div className="text-xs text-purple-600 font-medium">Built for publishers</div>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-6 hover:shadow-lg transition-shadow">
              <h3 className="text-lg font-semibold text-gray-900 mb-3">Enterprise Intranets</h3>
              <p className="text-gray-600 text-sm mb-4">Internal communications, document management, and team collaboration</p>
              <div className="text-xs text-purple-600 font-medium">Perfect for large teams</div>
            </div>
          </div>
        </section>

        {/* Why Payload CMS Section */}
        <section className="mb-16">
          <h2 className="text-3xl font-bold text-gray-900 mb-8">Why Choose Payload CMS?</h2>
          <div className="grid md:grid-cols-2 gap-8">
            <div className="space-y-6">
              <div className="bg-gradient-to-r from-green-50 to-emerald-50 rounded-xl p-6 border border-green-200">
                <h3 className="text-lg font-semibold text-gray-900 mb-3 flex items-center">
                  <CheckCircleIcon className="w-5 h-5 text-green-600 mr-2" />
                  Developer-Friendly
                </h3>
                <p className="text-gray-600 text-sm">
                  Code-first approach means your content structure lives in version control. 
                  No more clicking through admin interfaces to set up fields.
                </p>
              </div>
              <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl p-6 border border-blue-200">
                <h3 className="text-lg font-semibold text-gray-900 mb-3 flex items-center">
                  <CheckCircleIcon className="w-5 h-5 text-blue-600 mr-2" />
                  Enterprise Ready
                </h3>
                <p className="text-gray-600 text-sm">
                  Built-in authentication, role-based permissions, and field-level access control. 
                  Scale from startup to enterprise without changing platforms.
                </p>
              </div>
              <div className="bg-gradient-to-r from-purple-50 to-violet-50 rounded-xl p-6 border border-purple-200">
                <h3 className="text-lg font-semibold text-gray-900 mb-3 flex items-center">
                  <CheckCircleIcon className="w-5 h-5 text-purple-600 mr-2" />
                  Complete Control
                </h3>
                <p className="text-gray-600 text-sm">
                  Self-hosted means you own your data. No vendor lock-in, no usage limits, 
                  and complete customization freedom.
                </p>
              </div>
            </div>
            <div className="space-y-6">
              <div className="bg-gradient-to-r from-orange-50 to-amber-50 rounded-xl p-6 border border-orange-200">
                <h3 className="text-lg font-semibold text-gray-900 mb-3 flex items-center">
                  <CheckCircleIcon className="w-5 h-5 text-orange-600 mr-2" />
                  Performance First
                </h3>
                <p className="text-gray-600 text-sm">
                  Built on Next.js with automatic optimizations. Your content loads fast 
                  and your admin interface is lightning quick.
                </p>
              </div>
              <div className="bg-gradient-to-r from-teal-50 to-cyan-50 rounded-xl p-6 border border-teal-200">
                <h3 className="text-lg font-semibold text-gray-900 mb-3 flex items-center">
                  <CheckCircleIcon className="w-5 h-5 text-teal-600 mr-2" />
                  Future Proof
                </h3>
                <p className="text-gray-600 text-sm">
                  Open source with MIT license means the community drives development. 
                  Integrate with any frontend framework or mobile app.
                </p>
              </div>
              <div className="bg-gradient-to-r from-rose-50 to-pink-50 rounded-xl p-6 border border-rose-200">
                <h3 className="text-lg font-semibold text-gray-900 mb-3 flex items-center">
                  <CheckCircleIcon className="w-5 h-5 text-rose-600 mr-2" />
                  Cost Effective
                </h3>
                <p className="text-gray-600 text-sm">
                  No per-user pricing or content limits. Pay for hosting, not for features. 
                  Perfect for growing teams and high-traffic sites.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Getting Started Section */}
        <section className="mb-16">
          <h2 className="text-3xl font-bold text-gray-900 mb-8">How Airo Sets This Up For You</h2>
          <div className="bg-gradient-to-r from-purple-50 to-blue-50 rounded-2xl p-8 mb-8">
            <div className="text-center mb-6">
              <h3 className="text-xl font-semibold text-gray-900 mb-3">AI-Powered Setup</h3>
              <p className="text-gray-600">
                Our AI agents handle all the technical complexity. You focus on your content strategy, 
                we handle the implementation.
              </p>
            </div>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center mb-4">
                <span className="text-purple-600 font-bold">1</span>
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-3">Tell Us Your Needs</h3>
              <p className="text-gray-600 text-sm mb-4">
                Describe your content structure, user roles, and workflow requirements. 
                Our Product Manager agent will ask the right questions.
              </p>
              <div className="text-xs text-gray-500">
                "I need a blog with author profiles, categories, and an approval workflow"
              </div>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center mb-4">
                <span className="text-blue-600 font-bold">2</span>
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-3">AI Builds Your CMS</h3>
              <p className="text-gray-600 text-sm mb-4">
                Our Development agents configure Payload CMS with your exact content models, 
                permissions, and admin interface.
              </p>
              <div className="text-xs text-gray-500">
                Custom fields, relationships, and validation rules automatically generated
              </div>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center mb-4">
                <span className="text-green-600 font-bold">3</span>
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-3">Start Creating Content</h3>
              <p className="text-gray-600 text-sm mb-4">
                Your CMS is deployed and ready. Invite your team, set permissions, 
                and start managing content immediately.
              </p>
              <div className="text-xs text-gray-500">
                Full admin panel, APIs, and frontend integration included
              </div>
            </div>
          </div>

          <div className="mt-8 bg-white rounded-xl border border-gray-200 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">What Our AI Team Handles For You:</h3>
            <div className="grid md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <div className="flex items-center text-sm text-gray-700">
                  <CheckCircleIcon className="w-4 h-4 text-green-500 mr-2" />
                  Content schema design and validation
                </div>
                <div className="flex items-center text-sm text-gray-700">
                  <CheckCircleIcon className="w-4 h-4 text-green-500 mr-2" />
                  User authentication and role setup
                </div>
                <div className="flex items-center text-sm text-gray-700">
                  <CheckCircleIcon className="w-4 h-4 text-green-500 mr-2" />
                  API configuration and documentation
                </div>
                <div className="flex items-center text-sm text-gray-700">
                  <CheckCircleIcon className="w-4 h-4 text-green-500 mr-2" />
                  Database optimization and indexing
                </div>
              </div>
              <div className="space-y-2">
                <div className="flex items-center text-sm text-gray-700">
                  <CheckCircleIcon className="w-4 h-4 text-green-500 mr-2" />
                  Admin interface customization
                </div>
                <div className="flex items-center text-sm text-gray-700">
                  <CheckCircleIcon className="w-4 h-4 text-green-500 mr-2" />
                  Security hardening and best practices
                </div>
                <div className="flex items-center text-sm text-gray-700">
                  <CheckCircleIcon className="w-4 h-4 text-green-500 mr-2" />
                  Performance optimization and caching
                </div>
                <div className="flex items-center text-sm text-gray-700">
                  <CheckCircleIcon className="w-4 h-4 text-green-500 mr-2" />
                  Backup and deployment configuration
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* CTA Section */}
        <section>
          <div className="bg-gradient-to-r from-purple-600 to-blue-600 rounded-2xl p-8 text-center text-white">
            <h2 className="text-3xl font-bold mb-4">Ready to Build Your CMS?</h2>
            <p className="text-lg mb-8 opacity-90 max-w-2xl mx-auto">
              Let our AI agents help you customize this template for your specific content needs.
              Get a production-ready CMS in hours, not weeks.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link
                href="/builder"
                className="inline-flex items-center justify-center px-8 py-3 bg-white text-purple-600 font-semibold rounded-lg hover:bg-gray-50 transition-colors"
              >
                <PlayIcon className="w-5 h-5 mr-2" />
                Start Building CMS
              </Link>
              <Link
                href="/docs"
                className="inline-flex items-center justify-center px-8 py-3 border-2 border-white text-white font-semibold rounded-lg hover:bg-white hover:text-purple-600 transition-colors"
              >
                View All Templates
              </Link>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-200 bg-white mt-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="text-center text-gray-600">
            <p>&copy; 2024 Airo AI Builder. Built with AI for the future.</p>
          </div>
        </div>
      </footer>
    </div>
  )
}
