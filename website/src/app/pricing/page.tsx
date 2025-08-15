import Link from 'next/link'
import { CheckIcon, SparklesIcon, XMarkIcon } from '@heroicons/react/24/outline'

export default function Pricing() {
  const plans = [
    {
      name: "Starter",
      price: "$14",
      period: "/month",
      description: "Perfect for trying out AIRO and building simple applications",
      tokens: "500 AI tokens/month",
      features: [
        "1 active application",
        "Product Manager agent",
        "Lead Developer agent",
        "Basic templates (CMS, Blog)",
        "Community support",
        "2GB storage",
        "SSL certificates",
        "Basic analytics"
      ],
      limitations: [
        "No advanced datastores",
        "No Security Analyst",
        "No SRE monitoring"
      ],
      cta: "Start Free Trial",
      popular: false
    },
    {
      name: "Pro",
      price: "$29",
      period: "/month",
      description: "Best for growing businesses and complex applications",
      tokens: "1,000 AI tokens/month",
      features: [
        "3 active applications",
        "Full agent team (6 agents)",
        "All datastores (PostgreSQL, Redis, Vector DB)",
        "Advanced templates",
        "Priority support",
        "10GB storage",
        "SSL certificates",
        "Advanced analytics",
        "Custom domains",
        "Staging environments"
      ],
      limitations: [],
      cta: "Start Pro",
      popular: true
    },
    {
      name: "Deluxe",
      price: "$49",
      period: "/month",
      description: "For large teams and mission-critical applications",
      tokens: "2,000 AI tokens/month",
      features: [
        "5 active applications",
        "Full agent team + custom agents",
        "All datastores + custom integrations",
        "24/7 dedicated support",
        "50GB storage",
        "SSL certificates",
        "Custom analytics",
        "On-premise options"
      ],
      limitations: [],
      cta: "Start Deluxe",
      popular: false
    }
  ]

  const tokenInfo = [
    {
      action: "Basic chat interaction",
      tokens: "1-5 tokens",
      description: "Simple conversations with agents"
    },
    {
      action: "Code generation",
      tokens: "10-50 tokens",
      description: "Generate components, functions, or small features"
    },
    {
      action: "Full page creation",
      tokens: "50-200 tokens", 
      description: "Complete page with components and styling"
    },
    {
      action: "Database schema design",
      tokens: "20-100 tokens",
      description: "Design and generate database models"
    },
    {
      action: "Security analysis",
      tokens: "30-150 tokens",
      description: "Full security audit and recommendations"
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
              <Link href="/pricing" className="text-purple-600 font-medium">
                Pricing
              </Link>
              <Link href="/team" className="text-gray-600 hover:text-gray-900 transition-colors">
                Meet the Agents
              </Link>
            </nav>
            <div className="flex items-center space-x-4">
              <button className="text-gray-600 hover:text-gray-900 transition-colors">
                Sign In
              </button>
              <button className="bg-gradient-to-r from-purple-600 to-blue-600 text-white px-4 py-2 rounded-lg hover:from-purple-700 hover:to-blue-700 transition-all">
                Get Started
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        {/* Hero Section */}
        <div className="text-center mb-16">
          <h1 className="text-4xl md:text-5xl font-bold text-gray-900 mb-6">
            Simple, Transparent{' '}
            <span className="bg-gradient-to-r from-purple-600 to-blue-600 bg-clip-text text-transparent">
              Pricing
            </span>
          </h1>
          <p className="text-xl text-gray-600 mb-8 max-w-3xl mx-auto">
            Choose the plan that fits your needs. All plans include our core AI agents 
            and can be upgraded anytime as you grow.
          </p>
        </div>

        {/* Pricing Cards */}
        <div className="grid lg:grid-cols-3 gap-8 mb-16">
          {plans.map((plan, index) => (
            <div
              key={index}
              className={`relative bg-white rounded-2xl border-2 p-8 ${
                plan.popular 
                  ? 'border-purple-500 shadow-xl scale-105' 
                  : 'border-gray-200 hover:border-purple-300 hover:shadow-lg'
              } transition-all duration-200`}
            >
              {plan.popular && (
                <div className="absolute -top-4 left-1/2 transform -translate-x-1/2">
                  <span className="bg-gradient-to-r from-purple-600 to-blue-600 text-white px-6 py-2 rounded-full text-sm font-medium">
                    Most Popular
                  </span>
                </div>
              )}

              <div className="text-center mb-8">
                <h3 className="text-2xl font-bold text-gray-900 mb-2">{plan.name}</h3>
                <div className="mb-4">
                  <span className="text-4xl font-bold text-gray-900">{plan.price}</span>
                  <span className="text-gray-600">{plan.period}</span>
                </div>
                <p className="text-gray-600">{plan.description}</p>
                <div className="mt-4 inline-flex items-center px-3 py-1 rounded-full bg-purple-100 text-purple-700 text-sm font-medium">
                  <SparklesIcon className="w-4 h-4 mr-1" />
                  {plan.tokens}
                </div>
              </div>

              <ul className="space-y-4 mb-8">
                {plan.features.map((feature, featureIndex) => (
                  <li key={featureIndex} className="flex items-start">
                    <CheckIcon className="w-5 h-5 text-green-500 mr-3 mt-0.5 flex-shrink-0" />
                    <span className="text-gray-700">{feature}</span>
                  </li>
                ))}
                {plan.limitations.map((limitation, limitIndex) => (
                  <li key={limitIndex} className="flex items-start">
                    <XMarkIcon className="w-5 h-5 text-red-400 mr-3 mt-0.5 flex-shrink-0" />
                    <span className="text-gray-500">{limitation}</span>
                  </li>
                ))}
              </ul>

              <button
                className={`w-full py-3 rounded-lg font-medium transition-all ${
                  plan.popular
                    ? 'bg-gradient-to-r from-purple-600 to-blue-600 text-white hover:from-purple-700 hover:to-blue-700'
                    : 'bg-gray-100 text-gray-900 hover:bg-gray-200'
                }`}
              >
                {plan.cta}
              </button>
            </div>
          ))}
        </div>

        {/* Token Usage Guide */}
        <div className="bg-white rounded-2xl border border-gray-200 p-8">
          <div className="text-center mb-8">
            <h2 className="text-3xl font-bold text-gray-900 mb-4">
              Understanding AI Tokens
            </h2>
            <p className="text-lg text-gray-600">
              Tokens are used when our AI agents work on your project. Here's how they're typically consumed:
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {tokenInfo.map((info, index) => (
              <div key={index} className="border border-gray-200 rounded-lg p-6">
                <div className="flex justify-between items-start mb-3">
                  <h3 className="font-semibold text-gray-900">{info.action}</h3>
                  <span className="text-sm font-medium text-purple-600 bg-purple-100 px-2 py-1 rounded">
                    {info.tokens}
                  </span>
                </div>
                <p className="text-sm text-gray-600">{info.description}</p>
              </div>
            ))}
          </div>

          <div className="mt-8 p-6 bg-gradient-to-r from-purple-50 to-blue-50 rounded-lg">
            <h3 className="font-semibold text-gray-900 mb-2">Pro Tip</h3>
            <p className="text-gray-700">
              Tokens reset monthly and don't roll over. Most customers find that the Pro plan 
              provides plenty of tokens for multiple applications. Need more? You can always purchase 
              additional token packs or upgrade to Deluxe.
            </p>
          </div>
        </div>

        {/* FAQ Section */}
        <div className="mt-16">
          <h2 className="text-3xl font-bold text-center text-gray-900 mb-12">
            Frequently Asked Questions
          </h2>
          <div className="grid md:grid-cols-2 gap-8">
            <div>
              <h3 className="font-semibold text-gray-900 mb-2">
                What happens if I run out of tokens?
              </h3>
              <p className="text-gray-600 mb-6">
                Your applications continue to run normally. You'll just need to wait until next month 
                for tokens to reset, or you can purchase additional token packs.
              </p>
            </div>
            <div>
              <h3 className="font-semibold text-gray-900 mb-2">
                Can I change plans anytime?
              </h3>
              <p className="text-gray-600 mb-6">
                Yes! You can upgrade or downgrade your plan at any time. Changes take effect 
                immediately and we'll prorate any billing differences.
              </p>
            </div>
            <div>
              <h3 className="font-semibold text-gray-900 mb-2">
                What datastores are included?
              </h3>
              <p className="text-gray-600 mb-6">
                Pro and Deluxe plans include PostgreSQL, Redis, and Vector Database. 
                Starter plan uses local file storage only.
              </p>
            </div>
            <div>
              <h3 className="font-semibold text-gray-900 mb-2">
                Is there a free trial?
              </h3>
              <p className="text-gray-600 mb-6">
                Yes! All plans come with a 14-day free trial. No credit card required to start. 
                You'll get full access to test all features.
              </p>
            </div>
          </div>
        </div>
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
