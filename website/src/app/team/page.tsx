import Link from 'next/link'
import { 
  SparklesIcon, 
  UserGroupIcon, 
  CpuChipIcon, 
  CircleStackIcon, 
  CodeBracketIcon, 
  ShieldCheckIcon, 
  WrenchScrewdriverIcon 
} from '@heroicons/react/24/outline'

export default function Team() {
  const agents = [
    {
      name: "ProdBot-PM",
      role: "Product Manager Agent",
      icon: UserGroupIcon,
      description: "Transforms your ideas into detailed requirements and user stories",
      specialties: [
        "Requirements gathering",
        "User story creation", 
        "Feature prioritization",
        "Market research",
        "Stakeholder communication"
      ],
      personality: "ProdBot-PM is methodical and thorough, asking the right questions to understand exactly what you need. It excels at breaking down complex ideas into actionable plans.",
      experience: "Trained on thousands of successful product launches across industries"
    },
    {
      name: "ArchBot-SYS", 
      role: "Software Architect Agent",
      icon: CpuChipIcon,
      description: "Designs scalable, maintainable system architectures using best practices",
      specialties: [
        "System architecture design",
        "Technology selection",
        "Performance optimization", 
        "Integration planning",
        "Scalability design"
      ],
      personality: "ArchBot-SYS thinks big picture while paying attention to details. It balances cutting-edge technology with proven, stable solutions.",
      experience: "Expertise drawn from enterprise-scale applications and microservices architectures"
    },
    {
      name: "DataBot-DB",
      role: "Data Architect Agent", 
      icon: CircleStackIcon,
      description: "Creates optimized database schemas and data storage strategies",
      specialties: [
        "Database schema design",
        "Data modeling",
        "Query optimization",
        "Migration planning",
        "Performance tuning"
      ],
      personality: "DataBot-DB is detail-oriented and analytical, ensuring your data is structured efficiently and can scale with your growth.",
      experience: "Specialized knowledge of PostgreSQL, Redis, Vector databases, and modern data patterns"
    },
    {
      name: "CodeBot-DEV",
      role: "Lead Developer Agent",
      icon: CodeBracketIcon, 
      description: "Writes clean, maintainable code and provides real-time development feedback",
      specialties: [
        "Full-stack development",
        "Code review & optimization",
        "Testing strategies",
        "Documentation",
        "Debugging & troubleshooting"
      ],
      personality: "CodeBot-DEV is collaborative and patient, explaining code decisions and teaching best practices as it works alongside you.",
      experience: "Master of TypeScript, React, Next.js, and modern development workflows"
    },
    {
      name: "SecBot-GUARD",
      role: "Security Analyst Agent",
      icon: ShieldCheckIcon,
      description: "Identifies vulnerabilities and implements security best practices",
      specialties: [
        "Vulnerability scanning",
        "Security reviews",
        "Compliance auditing",
        "Threat modeling",
        "Automated remediation"
      ],
      personality: "SecBot-GUARD is vigilant and proactive, thinking like an attacker to find weaknesses before they become problems.",
      experience: "Trained on OWASP guidelines, Semgrep patterns, and enterprise security frameworks"
    },
    {
      name: "OpsBot-SRE",
      role: "Site Reliability Engineer Agent", 
      icon: WrenchScrewdriverIcon,
      description: "Ensures your applications run smoothly in production with monitoring and optimization",
      specialties: [
        "Performance monitoring",
        "Incident response", 
        "Capacity planning",
        "Automated maintenance",
        "Reliability engineering"
      ],
      personality: "OpsBot-SRE is always watching over your applications, preventing issues before they impact users and optimizing performance continuously.",
      experience: "Expert in cloud infrastructure, Kubernetes, monitoring systems, and DevOps practices"
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
              <Link href="/team" className="text-purple-600 font-medium">
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
            Meet Your{' '}
            <span className="bg-gradient-to-r from-purple-600 to-blue-600 bg-clip-text text-transparent">
              6-Person AI Team
            </span>
          </h1>
          <p className="text-xl text-gray-600 mb-8 max-w-3xl mx-auto">
            Instead of hiring 6 expensive specialists, our AI agents give you the equivalent 
            of an entire development team. Each AI agent has deep expertise in their role, 
            working together 24/7 to build your application.
          </p>
        </div>

        {/* Team Overview */}
        <div className="bg-white rounded-2xl border border-gray-200 p-8 mb-16">
          <div className="text-center mb-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">How Your AI Team Collaborates</h2>
            <p className="text-gray-600 max-w-2xl mx-auto">
              These AI agents work like a real development team, each handling their specialty 
              while coordinating seamlessly. You get the equivalent of hiring 6 senior-level 
              specialists for a fraction of the cost.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            <div className="text-center">
              <div className="w-16 h-16 bg-gradient-to-r from-purple-100 to-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <UserGroupIcon className="w-8 h-8 text-purple-600" />
              </div>
              <h3 className="font-semibold text-gray-900 mb-2">Discovery & Planning</h3>
              <p className="text-sm text-gray-600">
                Product Manager gathers requirements while Software Architect designs the system and 
                Data Architect plans the database structure.
              </p>
            </div>

            <div className="text-center">
              <div className="w-16 h-16 bg-gradient-to-r from-purple-100 to-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <CodeBracketIcon className="w-8 h-8 text-purple-600" />
              </div>
              <h3 className="font-semibold text-gray-900 mb-2">Development & Security</h3>
              <p className="text-sm text-gray-600">
                Lead Developer writes the code while Security Analyst continuously reviews 
                for vulnerabilities and implements best practices.
              </p>
            </div>

            <div className="text-center">
              <div className="w-16 h-16 bg-gradient-to-r from-purple-100 to-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <WrenchScrewdriverIcon className="w-8 h-8 text-purple-600" />
              </div>
              <h3 className="font-semibold text-gray-900 mb-2">Deployment & Monitoring</h3>
              <p className="text-sm text-gray-600">
                SRE Agent deploys your application and sets up monitoring to ensure it runs 
                smoothly in production with optimal performance.
              </p>
            </div>
          </div>
        </div>

        {/* Individual Agent Profiles */}
        <div className="space-y-8">
          {agents.map((agent, index) => {
            const IconComponent = agent.icon
            return (
              <div 
                key={index}
                className="bg-white rounded-2xl border border-gray-200 overflow-hidden hover:shadow-lg transition-shadow duration-200"
              >
                <div className="p-8">
                  <div className="flex flex-col lg:flex-row lg:items-start lg:space-x-8">
                    {/* Agent Avatar & Basic Info */}
                    <div className="flex-shrink-0 text-center lg:text-left mb-6 lg:mb-0">
                      <div className="w-24 h-24 bg-gradient-to-r from-purple-100 to-blue-100 rounded-full flex items-center justify-center mx-auto lg:mx-0 mb-4">
                        <IconComponent className="w-12 h-12 text-purple-600" />
                      </div>
                      <h3 className="text-xl font-bold text-gray-900">{agent.name}</h3>
                      <p className="text-purple-600 font-medium text-sm">{agent.role}</p>
                    </div>

                    {/* Agent Details */}
                    <div className="flex-1">
                      <p className="text-gray-700 mb-6 text-lg">{agent.description}</p>
                      
                      <div className="grid md:grid-cols-2 gap-6">
                        {/* Specialties */}
                        <div>
                          <h4 className="font-semibold text-gray-900 mb-3">Core Specialties</h4>
                          <ul className="space-y-2">
                            {agent.specialties.map((specialty, specIndex) => (
                              <li key={specIndex} className="flex items-center text-sm text-gray-600">
                                <div className="w-1.5 h-1.5 bg-purple-500 rounded-full mr-3"></div>
                                {specialty}
                              </li>
                            ))}
                          </ul>
                        </div>

                        {/* Personality & Experience */}
                        <div>
                          <h4 className="font-semibold text-gray-900 mb-3">Working Style</h4>
                          <p className="text-sm text-gray-600 mb-4">{agent.personality}</p>
                          
                          <h4 className="font-semibold text-gray-900 mb-2">Experience</h4>
                          <p className="text-sm text-gray-600">{agent.experience}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {/* CTA Section */}
        <div className="mt-16 text-center">
          <div className="bg-gradient-to-r from-purple-50 to-blue-50 rounded-2xl p-8">
            <h2 className="text-3xl font-bold text-gray-900 mb-4">
              Ready to Hire Your AI Team?
            </h2>
            <p className="text-lg text-gray-600 mb-8 max-w-2xl mx-auto">
              Get the equivalent of 6 senior specialists working 24/7 on your project. 
              No hiring, no management, no office politics - just results.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link 
                href="/builder"
                className="bg-gradient-to-r from-purple-600 to-blue-600 text-white px-8 py-3 rounded-lg hover:from-purple-700 hover:to-blue-700 transition-all font-medium"
              >
                Start Building Now
              </Link>
              <Link 
                href="/pricing"
                className="bg-white text-gray-900 px-8 py-3 rounded-lg border border-gray-300 hover:border-gray-400 transition-all font-medium"
              >
                View Pricing
              </Link>
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
