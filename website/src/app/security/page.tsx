'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  ArrowLeftIcon,
  ShieldCheckIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon,
  ClockIcon,
  CodeBracketIcon,
  DocumentTextIcon,
  EyeIcon
} from '@heroicons/react/24/outline'

interface SecurityIssue {
  id: string
  severity: 'critical' | 'high' | 'medium' | 'low'
  title: string
  description: string
  file: string
  line: number
  cwe: string
  fixedAt: Date
  before: string
  after: string
  explanation: string
}

export default function SecurityBot() {
  const [selectedIssue, setSelectedIssue] = useState<string | null>(null)

  const securityIssues: SecurityIssue[] = [
    {
      id: 'sql-injection-1',
      severity: 'critical',
      title: 'SQL Injection Vulnerability',
      description: 'Direct concatenation of user input in SQL query without sanitization',
      file: 'src/app/api/members/route.ts',
      line: 23,
      cwe: 'CWE-89',
      fixedAt: new Date(Date.now() - 3600000),
      before: `const query = \`SELECT * FROM members WHERE email = '\${email}' AND password = '\${password}'\`;\nconst result = await db.query(query);`,
      after: `const query = 'SELECT * FROM members WHERE email = ? AND password = ?';\nconst result = await db.query(query, [email, hashedPassword]);`,
      explanation: 'Replaced string concatenation with parameterized queries to prevent SQL injection. Also implemented proper password hashing using bcrypt.'
    },
    {
      id: 'xss-1',
      severity: 'high',
      title: 'Cross-Site Scripting (XSS)',
      description: 'User input rendered without proper escaping in member profile component',
      file: 'src/components/MemberProfile.tsx',
      line: 45,
      cwe: 'CWE-79',
      fixedAt: new Date(Date.now() - 7200000),
      before: `<div dangerouslySetInnerHTML={{__html: memberBio}} />`,
      after: `<div>{DOMPurify.sanitize(memberBio)}</div>`,
      explanation: 'Implemented DOMPurify to sanitize user-generated content and removed dangerous innerHTML usage. Added input validation on the backend as well.'
    },
    {
      id: 'auth-bypass-1',
      severity: 'high',
      title: 'Authentication Bypass',
      description: 'Missing authentication check in admin API endpoint',
      file: 'src/app/api/admin/members/route.ts',
      line: 15,
      cwe: 'CWE-862',
      fixedAt: new Date(Date.now() - 10800000),
      before: `export async function DELETE(request: Request) {\n  const { memberId } = await request.json();\n  await deleteMember(memberId);\n  return Response.json({ success: true });\n}`,
      after: `export async function DELETE(request: Request) {\n  const session = await getServerSession(authOptions);\n  if (!session?.user?.role === 'admin') {\n    return Response.json({ error: 'Unauthorized' }, { status: 401 });\n  }\n  const { memberId } = await request.json();\n  await deleteMember(memberId);\n  return Response.json({ success: true });\n}`,
      explanation: 'Added session validation and role-based access control. Only authenticated admin users can now access this endpoint.'
    },
    {
      id: 'sensitive-data-1',
      severity: 'medium',
      title: 'Sensitive Data Exposure',
      description: 'API endpoint returning user passwords in response',
      file: 'src/app/api/users/[id]/route.ts',
      line: 28,
      cwe: 'CWE-200',
      fixedAt: new Date(Date.now() - 14400000),
      before: `return Response.json({\n  id: user.id,\n  email: user.email,\n  password: user.password,\n  role: user.role\n});`,
      after: `return Response.json({\n  id: user.id,\n  email: user.email,\n  role: user.role,\n  createdAt: user.createdAt\n});`,
      explanation: 'Removed password field from API response and added password field to the exclude list in the user model serialization.'
    }
  ]

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical': return 'text-red-600 bg-red-50 border-red-200'
      case 'high': return 'text-orange-600 bg-orange-50 border-orange-200'
      case 'medium': return 'text-yellow-600 bg-yellow-50 border-yellow-200'
      case 'low': return 'text-blue-600 bg-blue-50 border-blue-200'
      default: return 'text-gray-600 bg-gray-50 border-gray-200'
    }
  }

  const selectedIssueData = securityIssues.find(issue => issue.id === selectedIssue)

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="border-b border-gray-200 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 bg-gradient-to-r from-red-100 to-orange-100 rounded-lg flex items-center justify-center">
                  <ShieldCheckIcon className="w-5 h-5 text-red-600" />
                </div>
                <div>
                  <h1 className="text-xl font-bold text-gray-900">SecurityBot-SEC</h1>
                  <p className="text-sm text-gray-500">Security & Compliance Specialist</p>
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
        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <div className="flex items-center">
              <div className="w-8 h-8 bg-green-100 rounded-lg flex items-center justify-center">
                <CheckCircleIcon className="w-5 h-5 text-green-600" />
              </div>
              <div className="ml-3">
                <p className="text-2xl font-bold text-gray-900">4</p>
                <p className="text-sm text-gray-500">Issues Fixed</p>
              </div>
            </div>
          </div>
          
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <div className="flex items-center">
              <div className="w-8 h-8 bg-red-100 rounded-lg flex items-center justify-center">
                <ExclamationTriangleIcon className="w-5 h-5 text-red-600" />
              </div>
              <div className="ml-3">
                <p className="text-2xl font-bold text-gray-900">1</p>
                <p className="text-sm text-gray-500">Critical</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <div className="flex items-center">
              <div className="w-8 h-8 bg-orange-100 rounded-lg flex items-center justify-center">
                <ExclamationTriangleIcon className="w-5 h-5 text-orange-600" />
              </div>
              <div className="ml-3">
                <p className="text-2xl font-bold text-gray-900">2</p>
                <p className="text-sm text-gray-500">High</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <div className="flex items-center">
              <div className="w-8 h-8 bg-yellow-100 rounded-lg flex items-center justify-center">
                <ClockIcon className="w-5 h-5 text-yellow-600" />
              </div>
              <div className="ml-3">
                <p className="text-2xl font-bold text-gray-900">1</p>
                <p className="text-sm text-gray-500">Medium</p>
              </div>
            </div>
          </div>
        </div>

        {/* AI Analysis Summary */}
        <div className="mb-8 bg-gradient-to-r from-red-50 to-orange-50 border border-red-200 rounded-lg p-6">
          <div className="flex items-start space-x-3">
            <div className="w-8 h-8 bg-gradient-to-r from-red-600 to-orange-600 rounded-lg flex items-center justify-center flex-shrink-0">
              <ShieldCheckIcon className="w-4 h-4 text-white" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">SecurityBot Analysis</h3>
              <p className="text-gray-700 mb-4">
                I've completed a comprehensive security scan of FitStudio Pro and identified 4 critical vulnerabilities. 
                All issues have been automatically resolved with secure coding practices:
              </p>
              <ul className="text-sm text-gray-600 space-y-1">
                <li>• Implemented parameterized queries to prevent SQL injection</li>
                <li>• Added input sanitization and XSS protection</li>
                <li>• Enforced authentication and authorization checks</li>
                <li>• Removed sensitive data from API responses</li>
              </ul>
              <p className="text-sm text-gray-600 mt-4">
                Your application now follows OWASP security guidelines and is protected against common web vulnerabilities.
              </p>
            </div>
          </div>
        </div>

        {/* Security Issues List */}
        <div className="bg-white rounded-lg border border-gray-200">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">Recent Security Fixes</h2>
            <p className="text-sm text-gray-500">Vulnerabilities detected and automatically resolved</p>
          </div>

          <div className="divide-y divide-gray-200">
            {securityIssues.map((issue) => (
              <div key={issue.id} className="p-6 hover:bg-gray-50 transition-colors">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center space-x-3 mb-2">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${getSeverityColor(issue.severity)}`}>
                        {issue.severity.toUpperCase()}
                      </span>
                      <span className="text-xs text-gray-500">{issue.cwe}</span>
                      <span className="text-xs text-gray-500">
                        Fixed {issue.fixedAt.toLocaleTimeString()}
                      </span>
                    </div>
                    <h3 className="text-lg font-medium text-gray-900 mb-1">{issue.title}</h3>
                    <p className="text-gray-600 mb-2">{issue.description}</p>
                    <div className="flex items-center text-sm text-gray-500">
                      <DocumentTextIcon className="w-4 h-4 mr-1" />
                      {issue.file}:{issue.line}
                    </div>
                  </div>
                  <button
                    onClick={() => setSelectedIssue(selectedIssue === issue.id ? null : issue.id)}
                    className="ml-4 inline-flex items-center px-3 py-1.5 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
                  >
                    <EyeIcon className="w-4 h-4 mr-1.5" />
                    View Fix
                  </button>
                </div>

                {selectedIssue === issue.id && selectedIssueData && (
                  <div className="mt-6 bg-gray-50 rounded-lg p-4">
                    <h4 className="font-medium text-gray-900 mb-3">Security Fix Details</h4>
                    
                    <div className="space-y-4">
                      <div>
                        <h5 className="text-sm font-medium text-gray-700 mb-2">Before (Vulnerable Code)</h5>
                        <pre className="bg-red-50 border border-red-200 rounded p-3 text-sm overflow-x-auto">
                          <code className="text-red-800">{selectedIssueData.before}</code>
                        </pre>
                      </div>

                      <div>
                        <h5 className="text-sm font-medium text-gray-700 mb-2">After (Fixed Code)</h5>
                        <pre className="bg-green-50 border border-green-200 rounded p-3 text-sm overflow-x-auto">
                          <code className="text-green-800">{selectedIssueData.after}</code>
                        </pre>
                      </div>

                      <div>
                        <h5 className="text-sm font-medium text-gray-700 mb-2">Explanation</h5>
                        <p className="text-sm text-gray-600 bg-blue-50 border border-blue-200 rounded p-3">
                          {selectedIssueData.explanation}
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>


      </div>
    </div>
  )
}
