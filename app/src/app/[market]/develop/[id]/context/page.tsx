'use client'

import { useParams } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

import { ProtectedRoute } from '@/components/auth'
import { features } from '@/lib/features'

interface ContextSection {
  type: 'template' | 'app' | 'visual' | 'element' | 'conversation' | 'hot_files' | 'system_prompt' | 'unused'
  role: 'system' | 'user'
  content: string
  tokenCount: number
}

interface ContextDebugResponse {
  systemPrompt: string
  contextSections: ContextSection[]
  totalTokens: number
  conversationHistory: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>
}

const TYPE_COLORS = {
  template: '#3b82f6',      // blue
  app: '#10b981',           // green
  visual: '#f59e0b',        // yellow
  element: '#ef4444',       // red
  conversation: '#8b5cf6',  // purple
  hot_files: '#06b6d4',     // cyan
  system_prompt: '#6b7280', // lighter gray
  unused: '#e5e7eb'         // light gray
}

const TYPE_LABELS = {
  template: 'Template Description',
  app: 'Current Project Context',
  visual: 'Visual Context',
  element: 'AI Edit Context',
  conversation: 'Conversation History',
  hot_files: 'Hot Files',
  system_prompt: 'System Prompt',
  unused: 'Available Capacity'
}

// Custom Area Chart Component
const AreaChart = ({
  data,
  height = 200,
  onSectionClick
}: {
  data: ContextSection[]
  height?: number
  onSectionClick: (section: ContextSection) => void
}) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(800)
  const total = data.reduce((sum, section) => sum + section.tokenCount, 0)

  // Update width when container resizes
  useEffect(() => {
    const updateWidth = () => {
      if (containerRef.current) {
        setWidth(containerRef.current.offsetWidth - 24) // Subtract padding
      }
    }

    updateWidth()
    window.addEventListener('resize', updateWidth)
    return () => window.removeEventListener('resize', updateWidth)
  }, [])

  // Generate cumulative data for area chart
  const cumulativeData = data.reduce((acc, section, index) => {
    const prev = acc[index - 1] || { x: 0, y: 0 }
    const percentage = (section.tokenCount / total) * 100
    acc.push({
      x: prev.x + percentage,
      y: height,
      section,
      percentage
    })
    return acc
  }, [] as Array<{ x: number, y: number, section: ContextSection, percentage: number }>)

  return (
    <div className="rounded-lg border p-3">
      <h3 className="text-lg font-semibold mb-2">Context Token Distribution</h3>

      {/* Chart SVG */}
      <div ref={containerRef} className="mb-3">
        <svg width={width} height={height} className="border rounded w-full">
          {/* Background */}
          <rect width={width} height={height} fill="#f8fafc" />

          {/* Area sections */}
          {cumulativeData.map((point, index) => {
            const prevPoint = cumulativeData[index - 1]
            const startX = prevPoint ? (prevPoint.x / 100) * width : 0
            const endX = (point.x / 100) * width
            const sectionWidth = endX - startX

            const isUnused = point.section.type === 'unused'

            return (
              <g key={point.section.type}>
                {/* Area rectangle */}
                <rect
                  x={startX}
                  y={0}
                  width={sectionWidth}
                  height={height}
                  fill={TYPE_COLORS[point.section.type]}
                  opacity={isUnused ? 0.3 : 0.7}
                  className="cursor-pointer hover:opacity-90 transition-opacity"
                  onClick={() => onSectionClick(point.section)}
                  {...(isUnused && { strokeDasharray: "4,4", stroke: "#9ca3af", strokeWidth: 1 })}
                />

                {/* Section label (if wide enough) */}
                {sectionWidth > 50 && (
                  <text
                    x={startX + sectionWidth / 2}
                    y={height / 2}
                    textAnchor="middle"
                    className={`text-sm font-medium pointer-events-none ${isUnused ? 'text-gray-600' : 'text-white'}`}
                    fill={isUnused ? '#4b5563' : 'white'}
                    style={isUnused ? {} : { textShadow: '1px 1px 2px rgba(0,0,0,0.5)' }}
                  >
                    {point.percentage.toFixed(1)}%
                  </text>
                )}
              </g>
            )
          })}

          {/* Grid lines */}
          {[25, 50, 75].map(percent => (
            <line
              key={percent}
              x1={(percent / 100) * width}
              y1={0}
              x2={(percent / 100) * width}
              y2={height}
              stroke="#e2e8f0"
              strokeDasharray="2,2"
              opacity={0.5}
            />
          ))}
        </svg>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-2 text-sm">
        {data.map((section) => {
          const percentage = ((section.tokenCount / total) * 100).toFixed(1)
          return (
            <div
              key={section.type}
              className="flex items-center gap-1 cursor-pointer hover:opacity-80"
              onClick={() => onSectionClick(section)}
            >
              <div
                className="w-2 h-2 rounded"
                style={{ backgroundColor: TYPE_COLORS[section.type] }}
              />
              <span className="font-medium">{TYPE_LABELS[section.type]}:</span>
              <span>{section.tokenCount} tokens ({percentage}%)</span>
            </div>
          )
        })}
      </div>

      <div className="mt-2 text-sm text-gray-600">
        <strong>Total Tokens:</strong> {total}
      </div>
    </div>
  )
}

// Message Content Renderer
const MessageRenderer = ({ content, type }: { content: string, type: ContextSection['type'] }) => {
  // Try to detect and parse JSON
  const parseContent = (text: string) => {
    // Check if it looks like JSON
    const trimmed = text.trim()
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) ||
      (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try {
        return JSON.parse(trimmed)
      } catch {
        return text
      }
    }
    return text
  }

  const parsedContent = parseContent(content)
  const isJSON = typeof parsedContent === 'object'

  return (
    <div className="space-y-2">
      {/* Content Type Badge */}
      <div className="flex items-center gap-1">
        <span
          className="px-1.5 py-0.5 rounded-full text-white text-sm font-medium"
          style={{ backgroundColor: TYPE_COLORS[type] }}
        >
          {TYPE_LABELS[type]}
        </span>
        <span className="text-sm text-gray-500">
          {content.length} characters
        </span>
      </div>

      {/* Content */}
      <div className="border rounded-lg overflow-hidden">
        {isJSON ? (
          // JSON Content
          <div>
            <div className="bg-gray-50 px-2 py-1 border-b">
              <span className="text-sm font-medium text-gray-700">JSON Content</span>
            </div>
            <pre className="p-2 overflow-auto max-h-48 text-sm">
              <code>{JSON.stringify(parsedContent, null, 2)}</code>
            </pre>
          </div>
        ) : (
          // Text Content
          <div>
            <div className="bg-gray-50 px-2 py-1 border-b">
              <span className="text-sm font-medium text-gray-700">Text Content</span>
            </div>
            <div className="p-2 overflow-auto max-h-48">
              <pre className="whitespace-pre-wrap text-sm font-mono">{content}</pre>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function ContextDebugPage() {
  const params = useParams()
  const appId = params.id as string

  const [contextData, setContextData] = useState<ContextDebugResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedSection, setSelectedSection] = useState<ContextSection | null>(null)

  // Debug options - enabled by default
  const [userInput, setUserInput] = useState('Can you help me build a landing page?')

  // Redirect if not in development mode
  useEffect(() => {
    if (!features.developmentMode) {
      window.location.href = `/develop/${appId}`
    }
  }, [appId])

  const fetchContextData = async () => {
    setLoading(true)
    setError(null)

    try {
      const params = new URLSearchParams({
        injectFakeVisual: 'true',
        injectFakeAiEdit: 'true',
        userInput
      })

      const response = await fetch(`/api/develop/${appId}/context?${params}`)

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to fetch context data')
      }

      const data: ContextDebugResponse = await response.json()
      setContextData(data)

      // Auto-select first section
      if (data.contextSections.length > 0) {
        setSelectedSection(data.contextSections[0])
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (appId) {
      fetchContextData()
    }

  }, [appId])

  if (!features.developmentMode) {
    return null
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="border-b">
        <div className="max-w-7xl mx-auto px-3 py-2">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Context Debug</h1>
              <p className="text-gray-600 mt-0.5">
                App: <span className="font-mono text-sm">{appId}</span>
              </p>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={userInput}
                onChange={(e) => setUserInput(e.target.value)}
                placeholder="Enter test message..."
                className="px-1.5 py-1 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 w-80"
              />
              <button
                onClick={fetchContextData}
                disabled={loading}
                className="px-2 py-1 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
              >
                {loading ? (
                  <>
                    <div className="w-2 h-2 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Loading...
                  </>
                ) : (
                  'Refresh Context'
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-3 py-3">
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-2 py-1.5 rounded-lg mb-3">
            <strong>Error:</strong> {error}
          </div>
        )}

        <div className="space-y-3">
          {contextData && (
            <>
              {/* Area Chart */}
              <AreaChart
                data={contextData.contextSections}
                onSectionClick={setSelectedSection}
              />

              {/* System Prompt */}
              <div className="rounded-lg border p-3">
                <h3 className="text-lg font-semibold mb-2">System Prompt</h3>
                <div className="border rounded-lg overflow-hidden">
                  <div className="bg-gray-50 px-2 py-1 border-b">
                    <span className="text-sm font-medium text-gray-700">
                      {contextData.systemPrompt.length} characters
                    </span>
                  </div>
                  <div className="p-2 overflow-auto max-h-48">
                    <pre className="whitespace-pre-wrap text-sm font-mono">
                      {contextData.systemPrompt}
                    </pre>
                  </div>
                </div>
              </div>

              {/* Conversation History */}
              {contextData.conversationHistory && contextData.conversationHistory.length > 0 && (
                <div className="rounded-lg border p-3">
                  <h3 className="text-lg font-semibold mb-2">
                    Conversation History ({contextData.conversationHistory.length} messages)
                  </h3>
                  <div className="space-y-2">
                    {contextData.conversationHistory.map((message, index) => (
                      <div key={index} className="border rounded-lg p-2">
                        <div className="flex items-center justify-between mb-1">
                          <span
                            className={`px-1.5 py-0.5 rounded-full text-white text-sm font-medium ${message.role === 'user'
                                ? 'bg-blue-600'
                                : message.role === 'assistant'
                                  ? 'bg-green-600'
                                  : 'bg-gray-600'
                              }`}
                          >
                            {message.role.charAt(0).toUpperCase() + message.role.slice(1)}
                          </span>
                          <span className="text-sm text-gray-500">
                            {message.content.length} characters
                          </span>
                        </div>
                        <div className="border rounded overflow-hidden">
                          <div className="bg-gray-50 px-2 py-1 border-b">
                            <span className="text-sm font-medium text-gray-700">Message Content</span>
                          </div>
                          <div className="p-2 overflow-auto max-h-32">
                            <pre className="whitespace-pre-wrap text-sm">{message.content}</pre>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Selected Section Detail */}
              {selectedSection && (
                <div className="rounded-lg border p-3">
                  <h3 className="text-lg font-semibold mb-2">Section Details</h3>
                  <MessageRenderer content={selectedSection.content} type={selectedSection.type} />
                </div>
              )}

              {/* All Sections */}
              <div className="rounded-lg border p-3">
                <h3 className="text-lg font-semibold mb-2">All Context Sections</h3>
                <div className="space-y-3">
                  {contextData.contextSections.map((section, index) => (
                    <div key={index} className="border rounded-lg p-2">
                      <MessageRenderer content={section.content} type={section.type} />
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {loading && !contextData && (
            <div className="rounded-lg border p-6">
              <div className="text-center">
                <div className="w-4 h-4 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                <p className="text-gray-600">Loading context data...</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function ContextDebug() {
  return (
      <ProtectedRoute>
        <ContextDebugPage />
      </ProtectedRoute>
      )
}
