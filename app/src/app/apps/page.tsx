'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import {
  SparklesIcon,
  CodeBracketIcon,
  PlusIcon,
  StopIcon,
  TrashIcon,
  ArrowPathIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon,
  ClockIcon,
  XCircleIcon,
  ArrowTopRightOnSquareIcon
} from '@heroicons/react/24/outline'
import { ProtectedRoute, UserMenu, SignOutButton, SignInButton } from '@/components/auth'
import { appService } from '@/services/AppService'

interface App {
  id: string
  name: string
  port: number
  status: 'creating' | 'created' | 'error'
  createdAt: string
  updatedAt: string
}

interface RunningServer {
  appId: string
  port: number
  url: string
}

interface AlertState {
  appId: string | null
  type: 'stop' | 'delete' | 'stop-all' | 'force-cleanup' | null
  message: string
}

function AppsPageContent() {
  const [apps, setApps] = useState<App[]>([])
  const [runningServers, setRunningServers] = useState<RunningServer[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [alertState, setAlertState] = useState<AlertState>({ appId: null, type: null, message: '' })
  const router = useRouter()

  useEffect(() => {
    const fetchData = async () => {
      try {
        // Fetch apps and servers data in parallel
        const [appsData, serversData] = await Promise.all([
          appService.getAllApps(),
          appService.getServers()
        ])
        
        setApps(appsData.apps || [])
        setRunningServers(serversData.servers || [])
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

  const getStatusBadge = (status: App['status']) => {
    switch (status) {
      case 'created':
        return {
          label: 'Ready',
          className: 'bg-green-100 text-green-800',
          icon: CheckCircleIcon
        }
      case 'creating':
        return {
          label: 'Creating',
          className: 'bg-yellow-100 text-yellow-800',
          icon: ClockIcon
        }
      case 'error':
        return {
          label: 'Error',
          className: 'bg-red-100 text-red-800',
          icon: XCircleIcon
        }
      default:
        return {
          label: 'Unknown',
          className: 'bg-gray-100 text-gray-800',
          icon: ExclamationTriangleIcon
        }
    }
  }

  const getAppIcon = (status: App['status']) => {
    switch (status) {
      case 'created':
        return CheckCircleIcon
      case 'creating':
        return ClockIcon
      case 'error':
        return XCircleIcon
      default:
        return CodeBracketIcon
    }
  }

  const getAppIconColor = (status: App['status']) => {
    switch (status) {
      case 'created':
        return 'text-green-600'
      case 'creating':
        return 'text-yellow-600'
      case 'error':
        return 'text-red-600'
      default:
        return 'text-purple-600'
    }
  }

  const isServerRunning = (appId: string) => {
    return runningServers.some(server => server.appId === appId)
  }

  const handleStopServer = async (appId: string) => {
    setActionLoading(`stop-${appId}`)
    try {
      await appService.stopApp(appId)
      console.log('✅ Server stopped successfully for app:', appId)
        
      // Small delay to ensure backend has updated
      await new Promise(resolve => setTimeout(resolve, 500))
      
      // Refresh running servers list
      const serversData = await appService.getServers()
      setRunningServers(serversData.servers || [])
    } catch (error) {
      console.error('❌ Error stopping server for app:', appId, error)
      alert('Failed to stop server')
    } finally {
      setActionLoading(null)
    }
  }

  const confirmStopServer = (appId: string) => {
    showAlert(appId, 'stop', 'Are you sure you want to stop this server?')
  }

  const executeStopServer = async (appId: string) => {
    clearAlert()
    await handleStopServer(appId)
  }

  const handleDeleteApp = async (appId: string) => {
    setActionLoading(`delete-${appId}`)
    try {
      await appService.deleteApp(appId)
      
      // Refresh apps list
      const appsData = await appService.getAllApps()
      setApps(appsData.apps || [])
        
        // Refresh running servers list
        const serversData = await appService.getServers()
        setRunningServers(serversData.servers || [])
    } catch (error) {
      console.error('Error deleting app:', error)
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
      alert(`Failed to delete app: ${errorMessage}`)
    } finally {
      setActionLoading(null)
    }
  }

  const confirmDeleteApp = (appId: string) => {
    showAlert(appId, 'delete', 'Are you sure you want to delete this app? This action cannot be undone.')
  }

  const executeDeleteApp = async (appId: string) => {
    clearAlert()
    await handleDeleteApp(appId)
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
      const data = await appService.stopAllApps()
      alert(data.message || 'All apps stopped successfully')
        
        // Refresh running servers list
        const serversData = await appService.getServers()
        setRunningServers(serversData.servers || [])
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
      const data = await appService.restartApp(appId)
      alert(data.message || 'App restarted successfully')
        
        // Wait a moment for the server to restart, then refresh data
        setTimeout(async () => {
          try {
            const serversData = await appService.getServers()
            setRunningServers(serversData.servers || [])
          } catch (error) {
            console.error('Error refreshing servers after restart:', error)
          }
        }, 2000)
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
      const data = await appService.cleanupOrphans()
      alert(data.message || 'Cleanup completed successfully')
        
        // Refresh running servers list
        const serversData = await appService.getServers()
        setRunningServers(serversData.servers || [])
    } catch (error) {
      console.error('Error cleaning up orphans:', error)
      alert('Failed to cleanup orphaned processes')
    } finally {
      setActionLoading(null)
    }
  }

  const clearAlert = () => {
    setAlertState({ appId: null, type: null, message: '' })
  }

  const showAlert = (appId: string | null, type: AlertState['type'], message: string) => {
    setAlertState({ appId, type, message })
  }

  // Inline Alert Component
  const InlineAlert = ({ message, onConfirm, onCancel }: {
    appId: string | null
    message: string
    onConfirm: () => void
    onCancel: () => void
  }) => (
    <div className="absolute inset-0 bg-white border-2 border-red-200 rounded-lg z-10 flex flex-col justify-center items-center p-4 shadow-lg">
      <div className="flex items-center space-x-2 mb-4">
        <ExclamationTriangleIcon className="w-6 h-6 text-red-600" />
        <span className="text-red-800 font-medium">Confirm Action</span>
      </div>
      <p className="text-gray-700 text-center mb-6 text-sm">{message}</p>
      <div className="flex space-x-3">
        <button
          onClick={onCancel}
          className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={onConfirm}
          className="px-4 py-2 text-sm bg-red-600 text-white hover:bg-red-700 rounded-lg transition-colors"
        >
          Confirm
        </button>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-white to-blue-50">
      {/* Header */}
      <header className="border-b border-gray-100 bg-white/80 backdrop-blur-sm">
        <div className="mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center space-x-3">
              <Link href="/" className="flex items-center space-x-3">
                <div className="w-64 h-64 flex items-center justify-center">
                    <Image src="/logo.svg" alt="Airo Logo" width={140} height={140} />
                  </div>
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
              <SignInButton />
              <SignOutButton />
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
            <div className="w-64 h-64 bg-gradient-to-r from-purple-600 to-blue-600 rounded-full flex items-center justify-center mx-auto mb-4">
              <SparklesIcon className="w-8 h-8 text-white animate-pulse" />
            </div>
            <p className="text-gray-600">Loading your apps...</p>
          </div>
        ) : error ? (
          <div className="text-center py-12">
            <div className="w-64 h-64 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
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
                  className="relative flex flex-col bg-white rounded-lg border border-gray-200 hover:border-purple-300 hover:shadow-lg transition-all duration-200 px-6 pt-6 pb-4"
                >
                  {/* Inline Alert */}
                  {alertState.appId === app.id && alertState.type && (
                    <InlineAlert
                      appId={app.id}
                      message={alertState.message}
                      onConfirm={() => {
                        if (alertState.type === 'stop') {
                          executeStopServer(app.id)
                        } else if (alertState.type === 'delete') {
                          executeDeleteApp(app.id)
                        }
                      }}
                      onCancel={clearAlert}
                    />
                  )}
                  
                  <div className="flex items-start justify-between mb-4">
                    <div className="w-12 h-12 bg-gradient-to-r from-purple-100 to-blue-100 rounded-lg flex items-center justify-center">
                      {(() => {
                        const AppIcon = getAppIcon(app.status)
                        return <AppIcon className={`w-6 h-6 ${getAppIconColor(app.status)}`} />
                      })()}
                    </div>
                    <div className="flex items-center space-x-2">
                      {isRunning && (
                        <div className="flex items-center space-x-1 text-xs text-green-600 bg-green-50 px-2 py-1 rounded-full">
                          <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                          <span>Running</span>
                        </div>
                      )}
                      {(() => {
                        const statusBadge = getStatusBadge(app.status)
                        const StatusIcon = statusBadge.icon
                        return (
                          <div className={`flex items-center space-x-1 text-xs px-2 py-1 rounded-full ${statusBadge.className}`}>
                            <StatusIcon className="w-3 h-3" />
                            <span>{statusBadge.label}</span>
                          </div>
                        )
                      })()}
                      <span className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded-full">
                        {app.id}
                      </span>
                    </div>
                  </div>
                  
                  <h3 className="text-lg font-semibold text-gray-900">
                    {app.name}
                  </h3>
                  
                  <div className="flex items-center text-sm text-gray-500 space-x-4 mb-4">
                    <div className="flex items-center space-x-1 italic">
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
                  
                  <div className="flex items-center justify-between mt-auto">
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
                            onClick={() => confirmStopServer(app.id)}
                            disabled={actionLoading === `stop-${app.id}`}
                            className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            title="Stop server"
                          >
                            <StopIcon className="w-4 h-4" />
                          </button>
                        </>
                      )}
                      <button
                        onClick={() => confirmDeleteApp(app.id)}
                        disabled={actionLoading === `delete-${app.id}`}
                        className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        title="Delete app"
                      >
                        <TrashIcon className="w-4 h-4" />
                      </button>
                      {isRunning && (
                        <a
                          href={`http://localhost:${app.port}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                          title="Visit live app"
                        >
                          <ArrowTopRightOnSquareIcon className="w-4 h-4" />
                        </a>
                      )}
                      <button
                        onClick={() => router.push(`/develop/${app.id}`)}
                        className="px-3 py-1 text-sm text-purple-600 hover:bg-purple-50 rounded-lg transition-colors font-medium"
                      >
                        Edit →
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
