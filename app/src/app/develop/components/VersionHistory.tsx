'use client'

import { useState, useEffect } from 'react'
import { 
  ClockIcon, 
  ArrowPathIcon, 
  XMarkIcon,
  EyeIcon
} from '@heroicons/react/24/outline'
import { appFetch } from '@/lib/gasket-config'

interface Commit {
  hash: string
  shortHash: string
  message: string
  author: string
  date: string
}

interface VersionHistoryProps {
  appId: string
  isOpen: boolean
  onClose: () => void
  onSelectCommit: (commit: Commit | null) => void
  selectedCommit: Commit | null
}

export default function VersionHistory({ 
  appId, 
  isOpen, 
  onClose, 
  onSelectCommit, 
  selectedCommit 
}: VersionHistoryProps) {
  const [commits, setCommits] = useState<Commit[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Load commits when component opens
  useEffect(() => {
    if (isOpen && appId) {
      fetchCommits()
    }
  }, [isOpen, appId])

  const fetchCommits = async () => {
    if (!appId) return
    
    setIsLoading(true)
    setError(null)
    
    try {
      const response = await appFetch(`http://localhost:4000/apps/${appId}/git/history`)
      
      if (response.ok) {
        const data = await response.json()
        setCommits(data.commits || [])
      } else {
        const errorData = await response.json().catch(() => ({}))
        setError(errorData.error || 'Failed to load commit history')
      }
    } catch (err) {
      setError('Error loading commit history')
      console.error('Failed to fetch commits:', err)
    } finally {
      setIsLoading(false)
    }
  }

  const handleSelectCommit = async (commit: Commit) => {
    if (selectedCommit?.hash === commit.hash) {
      // Deselect current commit (return to latest)
      onSelectCommit(null)
    } else {
      // Select new commit
      onSelectCommit(commit)
    }
  }


  // Format date string
  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(date)
  }

  if (!isOpen) return null

  return (
    <div className="absolute top-0 right-0 h-full bg-white z-20 shadow-lg w-80 border-l border-gray-200 flex flex-col">
      <div className="flex items-center justify-between p-3 border-b border-gray-200 bg-gray-50">
        <div className="flex items-center">
          <ClockIcon className="w-5 h-5 mr-2 text-amber-600" />
          <h3 className="font-medium text-gray-800">Version History</h3>
        </div>
        <div className="flex items-center space-x-2">
          <button 
            className="p-1 hover:bg-gray-200 rounded-md" 
            onClick={fetchCommits}
            title="Refresh commit history"
          >
            <ArrowPathIcon className="w-4 h-4 text-gray-600" />
          </button>
          <button 
            className="p-1 hover:bg-gray-200 rounded-md" 
            onClick={onClose}
            title="Close history panel"
          >
            <XMarkIcon className="w-4 h-4 text-gray-600" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {isLoading && (
          <div className="flex justify-center items-center h-20">
            <ArrowPathIcon className="w-6 h-6 animate-spin text-blue-500" />
          </div>
        )}

        {error && (
          <div className="text-red-500 p-3 text-sm">
            Error: {error}
          </div>
        )}

        {!isLoading && commits.length === 0 && !error && (
          <div className="text-blue-600 p-3 text-center text-sm">
            No commit history found
          </div>
        )}

        <ul className="space-y-1">
          {commits.map((commit) => (
            <li 
              key={commit.hash}
              className={`rounded-md overflow-hidden border ${
                selectedCommit?.hash === commit.hash 
                  ? 'border-blue-300 bg-blue-50' 
                  : 'border-gray-200 hover:bg-gray-50'
              }`}
            >
              <div className="p-2 flex justify-between items-center">
                <div className="flex-1 pr-2">
                  <p className="text-sm font-medium line-clamp-1 text-gray-800">
                    {commit.message}
                  </p>
                  <p className="text-xs text-blue-600">
                    {commit.shortHash} · {formatDate(commit.date)}
                  </p>
                </div>
                <button
                  onClick={() => handleSelectCommit(commit)}
                  className={`flex items-center justify-center h-7 w-7 rounded-full ${
                    selectedCommit?.hash === commit.hash
                      ? 'bg-blue-100 text-blue-700 hover:bg-blue-200'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                  title={selectedCommit?.hash === commit.hash ? 'Return to Latest' : 'View This Version'}
                >
                  <EyeIcon className="w-4 h-4" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      </div>

      {selectedCommit && (
        <div className="p-2 border-t border-gray-200 bg-amber-50">
          <p className="text-xs font-medium mb-1 text-amber-800">
            Viewing historical version
          </p>
          <div className="flex items-center justify-between">
            <p className="text-xs text-amber-700 truncate">
              {selectedCommit.shortHash}: {selectedCommit.message}
            </p>
            <button
              onClick={() => onSelectCommit(null)}
              className="px-2 py-1 rounded bg-amber-200 hover:bg-amber-300 text-xs text-amber-800"
            >
              Exit
            </button>
          </div>
        </div>
      )}
    </div>
  )
}