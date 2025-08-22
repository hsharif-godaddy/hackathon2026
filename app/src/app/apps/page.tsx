'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  SparklesIcon,
  CodeBracketIcon,
  PlusIcon,
  CalendarIcon,
  StopIcon,
  TrashIcon,
  ArrowPathIcon,
  ExclamationTriangleIcon
} from '@heroicons/react/24/outline'
import { ProtectedRoute, UserMenu } from '@/components/auth'
import { appFetch } from '@/lib/gasket-config'

interface App {
  id: string
  name: string
  port: number
  createdAt: string
  updatedAt: string
}

interface RunningServer {
  appId: string
  port: number
  url: string
}

function AppsPageContent() {
  const [apps, setApps] = useState<App[]>([])
  const [runningServers, setRunningServers] = useState<RunningServer[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const router = useRouter()

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [appsResponse, serversResponse] = await Promise.all([
          appFetch('http://localhost:4000/apps'),
          appFetch('http://localhost:4000/apps/servers')
        ])
        
        if (appsResponse.ok) {
          const appsData = await appsResponse.json()
          setApps(appsData.apps)
        } else {
          setError('Failed to load apps')
        }

        if (serversResponse.ok) {
          const serversData = await serversResponse.json()
          setRunningServers(serversData.servers)
        }
      } catch (error) {
        console.error('Error fetching data:', error)
        setError('Failed to connect to server')
      } finally {
        setIsLoading(false)
      }
    }

    fetchData()
  }, [])

  const handleCreateNew = () => {
    router.push('/')
  }

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    })
  }

  const isServerRunning = (appId: string) => {
    return runningServers.some(server => server.appId === appId)
  }

  const handleStopServer = async (appId: string) => {
    setActionLoading(`stop-${appId}`)
    try {
      const response = await appFetch(`http://localhost:4000/apps/${appId}/stop`, {
        method: 'POST'
      })
      
      if (response.ok) {
        // Refresh running servers list
        const serversResponse = await appFetch('http://localhost:4000/apps/servers')
        if (serversResponse.ok) {
          const serversData = await serversResponse.json()
          setRunningServers(serversData.servers)
        }
      } else {
        alert('Failed to stop server')
      }
    } catch (error) {
      console.error('Error stopping server:', error)
      alert('Failed to stop server')
    } finally {
      setActionLoading(null)
    }
  }

  const handleDeleteApp = async (appId: string) => {
    if (!confirm('Are you sure you want to delete this app? This action cannot be undone.')) {
      return
    }

    setActionLoading(`delete-${appId}`)
    try {
      const response = await appFetch(`http://localhost:4000/apps/${appId}`, {
        method: 'DELETE'
      })
      
      if (response.ok) {
        // Refresh apps list
        const appsResponse = await appFetch('http://localhost:4000/apps')
        if (appsResponse.ok) {
          const appsData = await appsResponse.json()
          setApps(appsData.apps)
        }
        
        // Refresh running servers list
        const serversResponse = await appFetch('http://localhost:4000/apps/servers')
        if (serversResponse.ok) {
          const serversData = await serversResponse.json()
          setRunningServers(serversData.servers)
        }
      } else {
        alert('Failed to delete app')
      }
    } catch (error) {
      console.error('Error deleting app:', error)
      alert('Failed to delete app')
    } finally {
      setActionLoading(null)
    }
  }

  const handleStopAll = async () => {
    if (runningServers.length === 0) {
      alert('No servers are currently running')
      return
    }

    if (!confirm(`Are you sure you want to stop all ${runningServers.length} running server${runningServers.length !== 1 ? 's' : ''}?`)) {
      return
    }

    setActionLoading('stop-all')
    try {
      const response = await appFetch('http://localhost:4000/apps/stop-all', {
        method: 'POST'
      })
      
      if (response.ok) {
        const data = await response.json()
        alert(data.message)
        
        // Refresh running servers list
        const serversResponse = await appFetch('http://localhost:4000/apps/servers')
        if (serversResponse.ok) {
          const serversData = await serversResponse.json()
          setRunningServers(serversData.servers)
        }
      } else {
        alert('Failed to stop servers')
      }
    } catch (error) {
      console.error('Error stopping all servers:', error)
      alert('Failed to stop servers')
    } finally {
      setActionLoading(null)
    }
  }

  const handleRestartServer = async (appId: string) => {
    setActionLoading(`restart-${appId}`)
    try {
      const response = await appFetch(`http://localhost:4000/apps/${appId}/restart`, {
        method: 'POST'
      })
      
      if (response.ok) {
        const data = await response.json()
        alert(data.message)
        
        // Wait a moment for the server to restart, then refresh data
        setTimeout(async () => {
          const serversResponse = await appFetch('http://localhost:4000/apps/servers')
          if (serversResponse.ok) {
            const serversData = await serversResponse.json()
            setRunningServers(serversData.servers)
          }
        }, 2000)
      } else {
        alert('Failed to restart server')
      }
    } catch (error) {
      console.error('Error restarting server:', error)
      alert('Failed to restart server')
    } finally {
      setActionLoading(null)
    }
  }

  const handleForceCleanup = async () => {
    if (!confirm('Force cleanup will attempt to kill all orphaned dev server processes. This may terminate processes not managed by this app. Continue?')) {
      return
    }

    setActionLoading('force-cleanup')
    try {
      const response = await appFetch('http://localhost:4000/apps/cleanup-orphans', {
        method: 'POST'
      })
      
      if (response.ok) {
        const data = await response.json()
        alert(data.message)
        
        // Refresh running servers list
        const serversResponse = await appFetch('http://localhost:4000/apps/servers')
        if (serversResponse.ok) {
          const serversData = await serversResponse.json()
          setRunningServers(serversData.servers)
        }
      } else {
        alert('Failed to cleanup orphaned processes')
      }
    } catch (error) {
      console.error('Error cleaning up orphans:', error)
      alert('Failed to cleanup orphaned processes')
    } finally {
      setActionLoading(null)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-white to-blue-50">
      {/* Header */}
      <header className="border-b border-gray-100 bg-white/80 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center space-x-3">
              <Link href="/" className="flex items-center space-x-3">
                <div className="w-8 h-8 bg-gradient-to-r from-purple-600 to-blue-600 rounded-lg flex items-center justify-center">
                  <SparklesIcon className="w-5 h-5 text-white" />
                </div>
                <span className="text-xl font-bold bg-gradient-to-r from-purple-600 to-blue-600 bg-clip-text text-transparent">
                  Airo
                </span>
              </Link>
            </div>
            <div className="flex items-center space-x-4">
              <UserMenu />
              <button
                onClick={handleForceCleanup}
                disabled={actionLoading === 'force-cleanup'}
                className="bg-orange-600 text-white px-4 py-2 rounded-lg hover:bg-orange-700 transition-all flex items-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed"
                title="Force cleanup orphaned processes"
              >
                <ExclamationTriangleIcon className="w-4 h-4" />
                <span>
                  {actionLoading === 'force-cleanup' ? 'Cleaning...' : 'Force Cleanup'}
                </span>
              </button>
              {runningServers.length > 0 && (
                <button
                  onClick={handleStopAll}
                  disabled={actionLoading === 'stop-all'}
                  className="bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 transition-all flex items-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <StopIcon className="w-4 h-4" />
                  <span>
                    {actionLoading === 'stop-all' ? 'Stopping...' : `Stop All (${runningServers.length})`}
                  </span>
                </button>
              )}
              <button
                onClick={handleCreateNew}
                className="bg-gradient-to-r from-purple-600 to-blue-600 text-white px-4 py-2 rounded-lg hover:from-purple-700 hover:to-blue-700 transition-all flex items-center space-x-2"
              >
                <PlusIcon className="w-4 h-4" />
                <span>New App</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8 pb-16">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">My Apps</h1>
          <p className="text-gray-600">
            Manage your AI-built applications
            {runningServers.length > 0 && (
              <span className="ml-2 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                {runningServers.length} server{runningServers.length !== 1 ? 's' : ''} running
              </span>
            )}
          </p>
        </div>

        {isLoading ? (
          <div className="text-center py-12">
            <div className="w-16 h-16 bg-gradient-to-r from-purple-600 to-blue-600 rounded-full flex items-center justify-center mx-auto mb-4">
              <SparklesIcon className="w-8 h-8 text-white animate-pulse" />
            </div>
            <p className="text-gray-600">Loading your apps...</p>
          </div>
        ) : error ? (
          <div className="text-center py-12">
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <span className="text-red-600 text-2xl">⚠️</span>
            </div>
            <h2 className="text-xl font-semibold text-gray-900 mb-2">Error Loading Apps</h2>
            <p className="text-gray-600 mb-4">{error}</p>
            <button
              onClick={() => window.location.reload()}
              className="bg-gradient-to-r from-purple-600 to-blue-600 text-white px-4 py-2 rounded-lg hover:from-purple-700 hover:to-blue-700 transition-all"
            >
              Try Again
            </button>
          </div>
        ) : apps.length === 0 ? (
          <div className="text-center py-12">
            <CodeBracketIcon className="w-16 h-16 mx-auto mb-4 text-gray-300" />
            <h2 className="text-xl font-semibold text-gray-900 mb-2">No Apps Yet</h2>
            <p className="text-gray-600 mb-6">Create your first AI-powered application</p>
            <button
              onClick={handleCreateNew}
              className="bg-gradient-to-r from-purple-600 to-blue-600 text-white px-6 py-3 rounded-lg hover:from-purple-700 hover:to-blue-700 transition-all flex items-center space-x-2 mx-auto"
            >
              <PlusIcon className="w-5 h-5" />
              <span>Create Your First App</span>
            </button>
          </div>
        ) : (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {apps.map((app) => {
              const isRunning = isServerRunning(app.id)
              return (
                <div
                  key={app.id}
                  className="bg-white rounded-lg border border-gray-200 hover:border-purple-300 hover:shadow-lg transition-all duration-200 p-6"
                >
                  <div className="flex items-start justify-between mb-4">
                    <div className="w-12 h-12 bg-gradient-to-r from-purple-100 to-blue-100 rounded-lg flex items-center justify-center">
                      <CodeBracketIcon className="w-6 h-6 text-purple-600" />
                    </div>
                    <div className="flex items-center space-x-2">
                      {isRunning && (
                        <div className="flex items-center space-x-1 text-xs text-green-600 bg-green-50 px-2 py-1 rounded-full">
                          <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                          <span>Running</span>
                        </div>
                      )}
                      <span className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded-full">
                        {app.id}
                      </span>
                    </div>
                  </div>
                  
                  <h3 className="text-lg font-semibold text-gray-900 mb-2">
                    {app.name}
                  </h3>
                  
                  <div className="flex items-center text-sm text-gray-500 space-x-4 mb-4">
                    <div className="flex items-center space-x-1">
                      <CalendarIcon className="w-4 h-4" />
                      <span>Created {formatDate(app.createdAt)}</span>
                    </div>
                  </div>

                  {isRunning && (
                    <div className="mb-4 p-3 bg-green-50 rounded-lg">
                      <p className="text-sm text-green-700 font-medium">Server running on port {app.port}</p>
                      <a 
                        href={`http://localhost:${app.port}`}
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="text-sm text-green-600 hover:text-green-800 underline"
                      >
                        View live app →
                      </a>
                    </div>
                  )}
                  
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-600">
                      {formatDate(app.updatedAt)}
                    </span>
                    <div className="flex items-center space-x-2">
                      {isRunning && (
                        <>
                          <button
                            onClick={() => handleRestartServer(app.id)}
                            disabled={actionLoading === `restart-${app.id}`}
                            className="p-2 text-orange-600 hover:bg-orange-50 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            title="Restart server"
                          >
                            <ArrowPathIcon className={`w-4 h-4 ${actionLoading === `restart-${app.id}` ? 'animate-spin' : ''}`} />
                          </button>
                          <button
                            onClick={() => handleStopServer(app.id)}
                            disabled={actionLoading === `stop-${app.id}`}
                            className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            title="Stop server"
                          >
                            <StopIcon className="w-4 h-4" />
                          </button>
                        </>
                      )}
                      <button
                        onClick={() => handleDeleteApp(app.id)}
                        disabled={actionLoading === `delete-${app.id}`}
                        className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        title="Delete app"
                      >
                        <TrashIcon className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => router.push(`/develop/${app.id}`)}
                        className="px-3 py-1 text-sm text-purple-600 hover:bg-purple-50 rounded-lg transition-colors font-medium"
                      >
                        Open →
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </main>
    </div>
  )
}

export default function Apps() {
  return (
    <ProtectedRoute 
      requiredAccess="user"
      loadingMessage="Loading Your Apps"
      unauthorizedMessage="You need to be signed in to view your apps."
    >
      <AppsPageContent />
    </ProtectedRoute>
  );
}
