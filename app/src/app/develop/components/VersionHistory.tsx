'use client'

import { useEffect, useRef, useState } from 'react'
import { useGitHistoryStore } from '@/stores/useGitHistoryStore'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
import Tag from '@ux/tag'
import CheckboxFilledIcon from '@ux/icon/checkbox-filled'

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
}

export default function VersionHistory({ 
  appId, 
  isOpen,
}: VersionHistoryProps) {
  const commitsListRef = useRef<HTMLUListElement>(null)

  
  // Use Git history store
  const {
    getCommits,
    isLoading,
    getError,
    loadGitHistory
  } = useGitHistoryStore()

  // Use develop page store for selected commit
  const { selectedCommit, selectCommit, isSelectingCommit } = useDevelopPageStore()

  const commits = getCommits(appId)
  const loading = isLoading(appId)
  const error = getError(appId)

  // Load commits when component opens or appId changes
  useEffect(() => {
    if (appId && isOpen) {
      loadGitHistory(appId)
    }
  }, [appId, isOpen, loadGitHistory])

  // Auto-select the latest commit when commits load and no commit is selected
  useEffect(() => {
    if (commits.length > 0 && !selectedCommit) {
      selectCommit(appId, commits[0])
    }
  }, [commits, selectedCommit, appId, selectCommit])

  // Handle commit selection using global store
  const handleSelectCommit = async (commit: Commit) => {
    // Don't allow selecting if already in progress
    if (isSelectingCommit) {
      console.log('🔄 Commit selection already in progress, ignoring click');
      return;
    }
    
    if (selectedCommit?.hash === commit.hash) {
      // Deselect current commit (return to latest)
      await selectCommit(appId, null)
    } else {
      // Select new commit
      await selectCommit(appId, commit)
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

  const renderCommitItem = ({ 
    key, 
    message, 
    description, 
    isSelected, 
    onClick
  }: { 
    key: string, 
    message: string, 
    description?: string | React.ReactNode, 
    isSelected: boolean, 
    onClick: () => void
  }) => (
    <li
      key={key}
      className={`rounded-md overflow-auto border transition-colors duration-200 ${
        isSelected
          ? 'border-intents-ux-boxHighContrast-borderColor' 
          : 'border-intents-ux-boxLowContrast-borderColor'
      }`}
    >
      <div className="flex flex-col">
        <button
          onClick={onClick} 
          disabled={isSelectingCommit}
          className={`relative pl-4 py-3 pr-8 text-left w-full transition-colors duration-200 ${
            isSelectingCommit 
              ? 'opacity-50 cursor-not-allowed' 
              : 'hover:bg-intents-ux-boxLowContrastOverlay-backgroundColor hover:cursor-pointer'
          }`}
        >
          <p className="text-sm font-medium line-clamp-1">
            {message}
          </p>
          { description && (
            <p className="text-xs">
              {description}
            </p>
          )}
          { isSelected && <CheckboxFilledIcon className="w-5 h-5 top-1 right-1 absolute text-intents-ux-feedbackHighContrastSuccess-feedbackColor" /> }
        </button>
      </div>
    </li>
  )

  return (
    <div className="flex-1 flex flex-col h-full">
      {/* Scrollable content area */}
      <div className="flex-1 flex flex-col overflow-y-auto gap-4" style={{ overflowY: 'auto', height: 'calc(100% - 50px)' }}>
        {error && (
          <div className="bg-intents-ux-feedbackCritical-feedbackColor p-3 text-sm">
            Error: {error}
          </div>
        )}

        {!loading && commits.length === 0 && !error && (
          <div className="p-3 text-center text-sm">
            No commit history found
          </div>
        )}

        <ul ref={commitsListRef} className="space-y-2 max-h-full">
          { commits.map((commit) => {
            return renderCommitItem({ 
              key: commit.hash,
              onClick: () => handleSelectCommit(commit),
              message: commit.message, 
              description: (
                <div className="flex items-center gap-2">
                  <Tag type="info">{commit.shortHash}</Tag>
                  <span className="text-xs">
                    {formatDate(commit.date)}
                  </span>
                </div>
              ),
              isSelected: selectedCommit?.hash === commit.hash
            })
          })}
        </ul>
      </div>
      
    </div>
  )
}
