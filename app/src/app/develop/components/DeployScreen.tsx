'use client'

import { useState } from 'react'
import {
  XMarkIcon,
  SparklesIcon,
  GlobeAltIcon,
  CheckCircleIcon,
  CreditCardIcon,
  CloudIcon,
  RocketLaunchIcon
} from '@heroicons/react/24/outline'

interface DeployScreenProps {
  isOpen: boolean
  onClose: () => void
}

interface DomainSuggestion {
  name: string
  price: string
  available: boolean
  tld: string
  reasoning: string
}

export default function DeployScreen({ isOpen, onClose }: DeployScreenProps) {
  const [step, setStep] = useState(1) // 1: Domain Selection, 2: Hosting Setup, 3: Deployment
  const [selectedDomain, setSelectedDomain] = useState<string | null>(null)
  const [customDomain, setCustomDomain] = useState('')
  const [isAnalyzing, setIsAnalyzing] = useState(false)

  if (!isOpen) return null

  const domainSuggestions: DomainSuggestion[] = [
    {
      name: 'fitstudiopro',
      price: '$12.99/year',
      available: true,
      tld: '.com',
      reasoning: 'Perfect match for your fitness studio brand. Professional and memorable.'
    },
    {
      name: 'fitstudiopro',
      price: '$8.99/year',
      available: true,
      tld: '.fit',
      reasoning: 'Industry-specific domain that clearly indicates fitness services.'
    },
    {
      name: 'profitstudio',
      price: '$12.99/year',
      available: true,
      tld: '.com',
      reasoning: 'Alternative arrangement that emphasizes the professional aspect.'
    },
    {
      name: 'fitstudiopro',
      price: '$4.99/year',
      available: true,
      tld: '.app',
      reasoning: 'Modern TLD perfect for your web application and mobile presence.'
    }
  ]

  const handleDomainAnalysis = () => {
    setIsAnalyzing(true)
    setTimeout(() => {
      setIsAnalyzing(false)
    }, 2000)
  }

  const renderStep1 = () => (
    <div className="space-y-6">
      <div className="text-center">
        <div className="w-16 h-16 bg-gradient-to-r from-blue-100 to-purple-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <GlobeAltIcon className="w-8 h-8 text-blue-600" />
        </div>
        <h3 className="text-xl font-semibold text-gray-900 mb-2">Choose Your Domain</h3>
        <p className="text-gray-600">Our AI analyzed your project and suggests these perfect domain names</p>
      </div>

      {/* AI Analysis Box */}
      <div className="bg-gradient-to-r from-purple-50 to-blue-50 border border-purple-200 rounded-lg p-4">
        <div className="flex items-start space-x-3">
          <div className="w-8 h-8 bg-gradient-to-r from-purple-600 to-blue-600 rounded-lg flex items-center justify-center flex-shrink-0">
            <SparklesIcon className="w-4 h-4 text-white" />
          </div>
          <div>
            <h4 className="text-sm font-semibold text-gray-900 mb-1">AI Domain Analysis</h4>
            <p className="text-sm text-gray-700">
              Based on your fitness studio project &quot;FitStudio Pro&quot;, I&apos;ve found domains that match your brand, 
              target audience, and business goals. Each suggestion includes SEO and branding analysis.
            </p>
          </div>
        </div>
      </div>

      {/* Domain Suggestions */}
      <div className="space-y-3">
        <h4 className="font-medium text-gray-900">Recommended Domains</h4>
        {domainSuggestions.map((domain) => (
          <div
            key={`${domain.name}${domain.tld}`}
            className={`border rounded-lg p-4 cursor-pointer transition-all ${
              selectedDomain === `${domain.name}${domain.tld}`
                ? 'border-blue-500 bg-blue-50'
                : 'border-gray-200 hover:border-gray-300'
            }`}
            onClick={() => setSelectedDomain(`${domain.name}${domain.tld}`)}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center space-x-2">
                <span className="font-semibold text-gray-900">{domain.name}{domain.tld}</span>
                {domain.available && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">
                    Available
                  </span>
                )}
              </div>
              <span className="font-semibold text-blue-600">{domain.price}</span>
            </div>
            <p className="text-sm text-gray-600">{domain.reasoning}</p>
          </div>
        ))}
      </div>

      {/* Custom Domain Input */}
      <div className="border-t border-gray-200 pt-4">
        <h4 className="font-medium text-gray-900 mb-3">Or enter your own domain</h4>
        <div className="flex space-x-2">
          <input
            type="text"
            value={customDomain}
            onChange={(e) => setCustomDomain(e.target.value)}
            placeholder="Enter domain name"
            className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
          <button
            onClick={handleDomainAnalysis}
            disabled={!customDomain || isAnalyzing}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isAnalyzing ? (
              <div className="flex items-center space-x-2">
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                <span>Analyzing...</span>
              </div>
            ) : (
              'Check'
            )}
          </button>
        </div>
      </div>
    </div>
  )

  const renderStep2 = () => (
    <div className="space-y-6">
      <div className="text-center">
        <div className="w-16 h-16 bg-gradient-to-r from-green-100 to-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <CloudIcon className="w-8 h-8 text-green-600" />
        </div>
        <h3 className="text-xl font-semibold text-gray-900 mb-2">Hosting & Setup</h3>
        <p className="text-gray-600">We&apos;ll configure professional hosting optimized for your fitness studio</p>
      </div>

      <div className="bg-gradient-to-r from-green-50 to-emerald-50 border border-green-200 rounded-lg p-4">
        <div className="flex items-start space-x-3">
          <CheckCircleIcon className="w-6 h-6 text-green-600 flex-shrink-0 mt-0.5" />
          <div>
            <h4 className="text-sm font-semibold text-gray-900 mb-2">Your hosting includes:</h4>
            <ul className="text-sm text-gray-700 space-y-1">
              <li>• Fast global CDN for quick loading</li>
              <li>• SSL certificate for security</li>
              <li>• Automated backups</li>
              <li>• 99.9% uptime guarantee</li>
              <li>• Optimized for fitness booking systems</li>
            </ul>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white border border-gray-200 rounded-lg p-4 text-center">
          <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center mx-auto mb-3">
            <GlobeAltIcon className="w-6 h-6 text-blue-600" />
          </div>
          <h4 className="font-medium text-gray-900">Domain</h4>
          <p className="text-sm text-gray-600 mt-1">{selectedDomain || 'fitstudiopro.com'}</p>
        </div>
        
        <div className="bg-white border border-gray-200 rounded-lg p-4 text-center">
          <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center mx-auto mb-3">
            <CloudIcon className="w-6 h-6 text-green-600" />
          </div>
          <h4 className="font-medium text-gray-900">Hosting</h4>
          <p className="text-sm text-gray-600 mt-1">Pro Plan - $19/month</p>
        </div>
        
        <div className="bg-white border border-gray-200 rounded-lg p-4 text-center">
          <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center mx-auto mb-3">
            <CheckCircleIcon className="w-6 h-6 text-purple-600" />
          </div>
          <h4 className="font-medium text-gray-900">SSL & Security</h4>
          <p className="text-sm text-gray-600 mt-1">Included</p>
        </div>
      </div>
    </div>
  )

  const renderStep3 = () => (
    <div className="space-y-6">
      <div className="text-center">
        <div className="w-16 h-16 bg-gradient-to-r from-purple-100 to-pink-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <RocketLaunchIcon className="w-8 h-8 text-purple-600" />
        </div>
        <h3 className="text-xl font-semibold text-gray-900 mb-2">Ready to Deploy!</h3>
        <p className="text-gray-600">Your FitStudio Pro website will be live in minutes</p>
      </div>

      <div className="bg-gradient-to-r from-purple-50 to-pink-50 border border-purple-200 rounded-lg p-6">
        <h4 className="font-semibold text-gray-900 mb-4">Deployment Summary</h4>
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <span className="text-gray-600">Domain ({selectedDomain || 'fitstudiopro.com'})</span>
            <span className="font-medium">$12.99/year</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-gray-600">Pro Hosting</span>
            <span className="font-medium">$19.00/month</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-gray-600">SSL Certificate</span>
            <span className="font-medium text-green-600">Free</span>
          </div>
          <div className="border-t border-purple-200 pt-3 flex justify-between items-center">
            <span className="font-semibold text-gray-900">Total (First Year)</span>
            <span className="font-bold text-lg">$240.99</span>
          </div>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <h4 className="font-medium text-gray-900 mb-3">Payment Method</h4>
        <div className="flex items-center space-x-3 p-3 border border-gray-200 rounded-lg">
          <CreditCardIcon className="w-6 h-6 text-gray-400" />
          <div>
            <p className="font-medium text-gray-900">•••• •••• •••• 4242</p>
            <p className="text-sm text-gray-500">Expires 12/26</p>
          </div>
        </div>
      </div>
    </div>
  )

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 bg-gradient-to-r from-green-600 to-emerald-600 rounded-lg flex items-center justify-center">
              <RocketLaunchIcon className="w-4 h-4 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Deploy FitStudio Pro</h2>
              <p className="text-sm text-gray-500">Step {step} of 3</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg hover:bg-gray-100 transition-colors flex items-center justify-center"
          >
            <XMarkIcon className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Progress Bar */}
        <div className="px-6 py-3 bg-gray-50">
          <div className="flex items-center space-x-2">
            {[1, 2, 3].map((stepNumber) => (
              <div key={stepNumber} className="flex items-center">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                  stepNumber <= step 
                    ? 'bg-green-600 text-white' 
                    : 'bg-gray-200 text-gray-600'
                }`}>
                  {stepNumber < step ? (
                    <CheckCircleIcon className="w-5 h-5" />
                  ) : (
                    stepNumber
                  )}
                </div>
                {stepNumber < 3 && (
                  <div className={`w-12 h-1 mx-2 ${
                    stepNumber < step ? 'bg-green-600' : 'bg-gray-200'
                  }`} />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto max-h-[60vh]">
          {step === 1 && renderStep1()}
          {step === 2 && renderStep2()}
          {step === 3 && renderStep3()}
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-gray-200 bg-gray-50 flex justify-between">
          <button
            onClick={() => step > 1 ? setStep(step - 1) : onClose()}
            className="px-4 py-2 text-gray-600 hover:text-gray-900 transition-colors"
          >
            {step === 1 ? 'Cancel' : 'Back'}
          </button>
          
          <button
            onClick={() => {
              if (step < 3) {
                setStep(step + 1)
              } else {
                // Handle deployment
                alert('Deployment started! Your site will be live in a few minutes.')
                onClose()
              }
            }}
            disabled={step === 1 && !selectedDomain && !customDomain}
            className="px-6 py-2 bg-gradient-to-r from-green-600 to-emerald-600 text-white rounded-lg hover:shadow-lg transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {step === 3 ? 'Deploy Now' : 'Continue'}
          </button>
        </div>
      </div>
    </div>
  )
}
