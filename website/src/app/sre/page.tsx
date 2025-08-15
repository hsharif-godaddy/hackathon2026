'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  ArrowLeftIcon,
  CogIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  ArrowPathIcon,
  ChartBarIcon,
  ClockIcon,
  CodeBracketIcon,
  BugAntIcon,
  ShieldCheckIcon
} from '@heroicons/react/24/outline'

interface MaintenanceEvent {
  id: string
  type: 'upgrade' | 'rollback' | 'deployment' | 'monitoring' | 'fix'
  title: string
  description: string
  timestamp: Date
  duration: string
  status: 'success' | 'warning' | 'error' | 'rollback'
  details: {
    version?: string
    tests?: { passed: number; total: number }
    errors?: string[]
    metrics?: { before: string; after: string }
    rollbackReason?: string
  }
}

export default function SREBot() {
  const [selectedEvent, setSelectedEvent] = useState<string | null>(null)

  const maintenanceEvents: MaintenanceEvent[] = [
    {
      id: 'nextjs-upgrade-success',
      type: 'upgrade',
      title: 'Next.js Upgrade to v14.2.1',
      description: 'Successfully upgraded Next.js with full test validation',
      timestamp: new Date(Date.now() - 3600000),
      duration: '12m 34s',
      status: 'success',
      details: {
        version: '14.1.0 → 14.2.1',
        tests: { passed: 247, total: 247 },
        metrics: { before: '2.1s avg response', after: '1.8s avg response' }
      }
    },
    {
      id: 'database-migration',
      type: 'deployment',
      title: 'Database Schema Migration',
      description: 'Applied member fitness tracking schema updates',
      timestamp: new Date(Date.now() - 7200000),
      duration: '8m 21s',
      status: 'success',
      details: {
        version: 'Migration #0042',
        tests: { passed: 156, total: 156 }
      }
    },
    {
      id: 'react-upgrade-rollback',
      type: 'rollback',
      title: 'React 19 Upgrade → Rollback → Fixed Deployment',
      description: 'Detected error spike after React upgrade, rolled back, fixed compatibility issue, and redeployed successfully',
      timestamp: new Date(Date.now() - 14400000),
      duration: '45m 17s',
      status: 'rollback',
      details: {
        version: 'React 18.2.0 → 19.0.0 → 18.2.0 → 19.0.0',
        tests: { passed: 247, total: 247 },
        errors: [
          'TypeError: Cannot read properties of undefined (reading \'useId\')',
          'Error: Hydration failed because the initial UI does not match',
          'ReferenceError: useFormStatus is not defined'
        ],
        rollbackReason: 'Error rate increased from 0.1% to 12.4% within 5 minutes of deployment',
        metrics: { before: '0.1% error rate', after: '0.1% error rate (post-fix)' }
      }
    },
    {
      id: 'ssl-renewal',
      type: 'monitoring',
      title: 'SSL Certificate Auto-Renewal',
      description: 'Renewed SSL certificates for all domains',
      timestamp: new Date(Date.now() - 21600000),
      duration: '3m 45s',
      status: 'success',
      details: {
        version: 'Let\'s Encrypt renewal'
      }
    },
    {
      id: 'performance-optimization',
      type: 'fix',
      title: 'Database Query Optimization',
      description: 'Optimized slow member lookup queries',
      timestamp: new Date(Date.now() - 28800000),
      duration: '15m 12s',
      status: 'success',
      details: {
        metrics: { before: '850ms avg query time', after: '95ms avg query time' }
      }
    }
  ]

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'success': return 'text-green-600 bg-green-50 border-green-200'
      case 'warning': return 'text-yellow-600 bg-yellow-50 border-yellow-200'
      case 'error': return 'text-red-600 bg-red-50 border-red-200'
      case 'rollback': return 'text-purple-600 bg-purple-50 border-purple-200'
      default: return 'text-gray-600 bg-gray-50 border-gray-200'
    }
  }

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'upgrade': return <ArrowPathIcon className="w-5 h-5" />
      case 'rollback': return <ExclamationTriangleIcon className="w-5 h-5" />
      case 'deployment': return <CodeBracketIcon className="w-5 h-5" />
      case 'monitoring': return <ChartBarIcon className="w-5 h-5" />
      case 'fix': return <BugAntIcon className="w-5 h-5" />
      default: return <CogIcon className="w-5 h-5" />
    }
  }

  const selectedEventData = maintenanceEvents.find(event => event.id === selectedEvent)

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="border-b border-gray-200 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 bg-gradient-to-r from-blue-100 to-cyan-100 rounded-lg flex items-center justify-center">
                  <CogIcon className="w-5 h-5 text-blue-600" />
                </div>
                <div>
                  <h1 className="text-xl font-bold text-gray-900">SREBot-OPS</h1>
                  <p className="text-sm text-gray-500">Site Reliability & Operations</p>
                </div>
              </div>
            </div>
            <Link
              href="/develop"
              className="inline-flex items-center text-gray-600 hover:text-gray-900 transition-colors"
            >
              <ArrowLeftIcon className="w-4 h-4 mr-2" />
              Back to Development
            </Link>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Summary Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <div className="flex items-center">
              <div className="w-8 h-8 bg-green-100 rounded-lg flex items-center justify-center">
                <CheckCircleIcon className="w-5 h-5 text-green-600" />
              </div>
              <div className="ml-3">
                <p className="text-2xl font-bold text-gray-900">99.97%</p>
                <p className="text-sm text-gray-500">Uptime</p>
              </div>
            </div>
          </div>
          
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <div className="flex items-center">
              <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center">
                <ArrowPathIcon className="w-5 h-5 text-blue-600" />
              </div>
              <div className="ml-3">
                <p className="text-2xl font-bold text-gray-900">5</p>
                <p className="text-sm text-gray-500">Operations Today</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <div className="flex items-center">
              <div className="w-8 h-8 bg-purple-100 rounded-lg flex items-center justify-center">
                <ExclamationTriangleIcon className="w-5 h-5 text-purple-600" />
              </div>
              <div className="ml-3">
                <p className="text-2xl font-bold text-gray-900">1</p>
                <p className="text-sm text-gray-500">Auto-Rollback</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <div className="flex items-center">
              <div className="w-8 h-8 bg-yellow-100 rounded-lg flex items-center justify-center">
                <ClockIcon className="w-5 h-5 text-yellow-600" />
              </div>
              <div className="ml-3">
                <p className="text-2xl font-bold text-gray-900">1.8s</p>
                <p className="text-sm text-gray-500">Avg Response</p>
              </div>
            </div>
          </div>
        </div>

        {/* AI Analysis Summary */}
        <div className="mb-8 bg-gradient-to-r from-blue-50 to-cyan-50 border border-blue-200 rounded-lg p-6">
          <div className="flex items-start space-x-3">
            <div className="w-8 h-8 bg-gradient-to-r from-blue-600 to-cyan-600 rounded-lg flex items-center justify-center flex-shrink-0">
              <CogIcon className="w-4 h-4 text-white" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">SREBot Analysis</h3>
              <p className="text-gray-700 mb-4">
                I continuously monitor your application's health and automatically handle maintenance operations. 
                Recent highlights include:
              </p>
              <ul className="text-sm text-gray-600 space-y-1">
                <li>• Successfully upgraded Next.js with 14% performance improvement</li>
                <li>• Detected and automatically rolled back a problematic React upgrade within 2 minutes</li>
                <li>• Fixed compatibility issues and successfully redeployed React 19</li>
                <li>• Optimized database queries, reducing response time by 89%</li>
                <li>• Maintained 99.97% uptime with zero manual intervention required</li>
              </ul>
              <p className="text-sm text-gray-600 mt-4">
                All operations include comprehensive testing, monitoring, and automatic rollback capabilities to ensure reliability.
              </p>
            </div>
          </div>
        </div>

        {/* Maintenance Timeline */}
        <div className="bg-white rounded-lg border border-gray-200">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">Maintenance Timeline</h2>
            <p className="text-sm text-gray-500">Recent automated operations and system updates</p>
          </div>

          <div className="p-6">
            <div className="flow-root">
              <ul className="-mb-8">
                {maintenanceEvents.map((event, eventIdx) => (
                  <li key={event.id}>
                    <div className="relative pb-8">
                      {eventIdx !== maintenanceEvents.length - 1 ? (
                        <span className="absolute top-5 left-5 -ml-px h-full w-0.5 bg-gray-200" aria-hidden="true" />
                      ) : null}
                      <div className="relative flex items-start space-x-3">
                        <div className={`relative px-1 ${getStatusColor(event.status)} rounded-full flex items-center justify-center h-10 w-10 border`}>
                          {getTypeIcon(event.type)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between">
                            <div>
                              <h3 className="text-sm font-medium text-gray-900">{event.title}</h3>
                              <p className="text-sm text-gray-500">{event.description}</p>
                            </div>
                            <div className="text-right text-sm text-gray-500">
                              <p>{event.timestamp.toLocaleTimeString()}</p>
                              <p>Duration: {event.duration}</p>
                            </div>
                          </div>
                          
                          {event.details.tests && (
                            <div className="mt-2 flex items-center space-x-4 text-sm">
                              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                                <CheckCircleIcon className="w-3 h-3 mr-1" />
                                {event.details.tests.passed}/{event.details.tests.total} tests passed
                              </span>
                              {event.details.version && (
                                <span className="text-gray-500">{event.details.version}</span>
                              )}
                            </div>
                          )}

                          {event.details.metrics && (
                            <div className="mt-2 text-sm text-gray-600">
                              <span className="text-red-600">{event.details.metrics.before}</span>
                              <span className="mx-2">→</span>
                              <span className="text-green-600">{event.details.metrics.after}</span>
                            </div>
                          )}

                          <button
                            onClick={() => setSelectedEvent(selectedEvent === event.id ? null : event.id)}
                            className="mt-2 text-sm text-blue-600 hover:text-blue-500"
                          >
                            {selectedEvent === event.id ? 'Hide Details' : 'View Details'}
                          </button>

                          {selectedEvent === event.id && selectedEventData && (
                            <div className="mt-4 bg-gray-50 rounded-lg p-4">
                              <h4 className="font-medium text-gray-900 mb-3">Operation Details</h4>
                              
                              {selectedEventData.id === 'react-upgrade-rollback' && (
                                <div className="space-y-4">
                                  <div className="bg-yellow-50 border border-yellow-200 rounded p-3">
                                    <h5 className="text-sm font-medium text-yellow-800 mb-2">Initial Deployment</h5>
                                    <p className="text-sm text-yellow-700">React 18.2.0 → 19.0.0 deployed successfully. All 247 tests passed.</p>
                                  </div>
                                  
                                  <div className="bg-red-50 border border-red-200 rounded p-3">
                                    <h5 className="text-sm font-medium text-red-800 mb-2">Error Detection (5 minutes post-deploy)</h5>
                                    <p className="text-sm text-red-700 mb-2">Error rate spiked from 0.1% to 12.4%. Detected issues:</p>
                                    <ul className="text-xs text-red-600 space-y-1">
                                      {selectedEventData.details.errors?.map((error, idx) => (
                                        <li key={idx}>• {error}</li>
                                      ))}
                                    </ul>
                                  </div>

                                  <div className="bg-purple-50 border border-purple-200 rounded p-3">
                                    <h5 className="text-sm font-medium text-purple-800 mb-2">Automatic Rollback</h5>
                                    <p className="text-sm text-purple-700">Rolled back to React 18.2.0 within 2 minutes. Error rate returned to 0.1%.</p>
                                  </div>

                                  <div className="bg-blue-50 border border-blue-200 rounded p-3">
                                    <h5 className="text-sm font-medium text-blue-800 mb-2">Root Cause Analysis & Fix</h5>
                                    <p className="text-sm text-blue-700">Identified React 19 compatibility issues with form handling components. Updated useFormStatus imports and fixed hydration mismatches.</p>
                                  </div>

                                  <div className="bg-green-50 border border-green-200 rounded p-3">
                                    <h5 className="text-sm font-medium text-green-800 mb-2">Successful Redeployment</h5>
                                    <p className="text-sm text-green-700">React 19.0.0 deployed again with fixes. All tests passed. Error rate remained at 0.1%.</p>
                                  </div>
                                </div>
                              )}

                              {selectedEventData.id === 'nextjs-upgrade-success' && (
                                <div className="space-y-4">
                                  <div className="bg-blue-50 border border-blue-200 rounded p-3">
                                    <h5 className="text-sm font-medium text-blue-800 mb-2">Pre-upgrade Validation</h5>
                                    <p className="text-sm text-blue-700">Analyzed dependencies and compatibility. No breaking changes detected.</p>
                                  </div>
                                  
                                  <div className="bg-green-50 border border-green-200 rounded p-3">
                                    <h5 className="text-sm font-medium text-green-800 mb-2">Upgrade Process</h5>
                                    <p className="text-sm text-green-700">Updated Next.js from 14.1.0 to 14.2.1. All 247 tests passed. Performance improved by 14%.</p>
                                  </div>
                                </div>
                              )}

                              {!['react-upgrade-rollback', 'nextjs-upgrade-success'].includes(selectedEventData.id) && (
                                <div className="text-sm text-gray-600">
                                  <p>Operation completed successfully with no issues detected.</p>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>


      </div>
    </div>
  )
}
