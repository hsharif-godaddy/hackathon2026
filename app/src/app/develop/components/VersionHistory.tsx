'use client'

import { useEffect, useRef, useMemo } from 'react'
import { useGitHistoryQuery } from '@/hooks/useGitHistory'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
import { useDeploymentsQuery } from '@/hooks/useDeploymentsQuery'
import { useSiteStore } from '@/stores/useSiteStore'
import { useSwitchboard } from '@/hooks/useSwitchboard'
import { DeploymentStatus } from '@/lib/mgmt-airo/types'
import Tag from '@ux/tag'
import Spinner from '@ux/spinner'
import CheckboxFilledIcon from '@ux/icon/checkbox-filled'
import Alert from '@ux/alert'
import { logger } from '@/lib/request-context'
import { useAppIdFromParams } from './utils'
import { formatDate } from '@/utils/common'

interface Commit {
  hash: string
  message: string
  author: string
  date: string
}

export default function VersionHistory() {
  const commitsListRef = useRef<HTMLUListElement>(null)

  const {
    selectedCommit,
    selectCommit,
    isSelectingCommit,
    commitSelectionError,
    setCommitSelectionError
  } = useDevelopPageStore()

  const appId = useAppIdFromParams()

  const site = useSiteStore((state) => appId ? state.getSite(appId) : null)
  const { data: isPublishButtonEnabled } = useSwitchboard('appbuilder-publish-button')

  const {
    data: commits = [],
    isLoading: loading,
    error: queryError
  } = useGitHistoryQuery({
    appId: appId || '',
    enabled: !!appId
  })

  // NOTE: commits array is ordered from NEWEST to OLDEST (chronologically descending)
  // Index 0 = most recent commit, higher indices = older commits
  // This ordering is assumed throughout this component for published tag logic

  const error = queryError?.message || null

  const { data: deployments = [] } = useDeploymentsQuery({
    appId: appId || '',
    enabled: isPublishButtonEnabled && !!appId && !!site?.agent_url && commits.length > 0,
    includeJobData: true,
    limit: commits.length > 150 ? 150 : commits.length,
  })

  // Find the most recent deployed commit index
  // All commits from that index and before (including it) should be marked as published
  const mostRecentDeployedCommitIndex = useMemo(() => {
    const mostRecentDeployment = deployments.find(d => d.status === DeploymentStatus.DEPLOYED);
    if (!mostRecentDeployment) return -1;
    
    return commits.findIndex(c => c.hash === mostRecentDeployment.gitHash);
  }, [deployments, commits])

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
      logger.debug('version-history.commit.selection-busy', { message: 'Commit selection already in progress, ignoring click' });
      return;
    }

    try {
      if (selectedCommit?.hash === commit.hash) {
        // Deselect current commit (return to latest)
        await selectCommit(appId, null)
      } else {
        // Select new commit
        await selectCommit(appId, commit)
      }
    } catch (error) {
      logger.error('version-history.commit.selection-error', { 
        message: 'Failed to select commit', 
        error: error instanceof Error ? error.message : String(error) 
      });
    }
  }

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
            <div className="text-xs">
              {description}
            </div>
          )}
          { isSelected && <CheckboxFilledIcon className="w-5 h-5 top-1 right-1 absolute text-intents-ux-feedbackHighContrastSuccess-feedbackColor" /> }
        </button>
      </div>
    </li>
  )

  return (
    <div className="flex-1 flex flex-col h-full overflow-y-auto">
      {/* Scrollable content area */}
      <div className="flex-1 flex flex-col gap-4 p-4">
        {error && (
          <div className="bg-intents-ux-feedbackCritical-feedbackColor p-3 text-sm">
            Error: {error}
          </div>
        )}

        {commitSelectionError && (
          <Alert 
            emphasis="critical"
            onClose={() => setCommitSelectionError(null)}
          >
            <div className="font-semibold">Failed to switch version</div>
            <div className="text-sm mt-1">{commitSelectionError}</div>
          </Alert>
        )}

        {loading && (
          <div className="flex justify-center items-center h-full">
            <Spinner />
          </div>
        )}

        {!loading && commits.length === 0 && !error && (
          <div className="flex justify-center items-center h-full">
            No commit history found
          </div>
        )}

        <ul ref={commitsListRef} className="space-y-2 max-h-full">
          { commits.map((commit, index) => {
            // A commit is published if it's at or older than the most recent deployed commit:
            // 1. There is a deployed commit (mostRecentDeployedCommitIndex >= 0), AND
            // 2. This commit's index >= deployed index (meaning it's the same age or older)
            const isPublished = mostRecentDeployedCommitIndex >= 0 && index >= mostRecentDeployedCommitIndex;
            
            return renderCommitItem({
              key: commit.hash,
              onClick: () => handleSelectCommit(commit),
              message: commit.message,
              description: (
                <div className="flex items-center gap-2">
                  <Tag type="info">{commit.hash.substring(0, 7)}</Tag>
                  {isPublished && (
                    <Tag emphasis="success">PUBLISHED</Tag>
                  )}
                  <span className="text-xs">
                    {formatDate(commit.date, true)}
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
