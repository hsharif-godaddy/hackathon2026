'use client'

import { useEffect, useMemo, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import Alert from '@ux/alert'
import CheckboxFilledIcon from '@ux/icon/checkbox-filled'
import Spinner from '@ux/spinner'
import Tag from '@ux/tag'

import { useDeploymentsQuery } from '@/hooks/useDeploymentsQuery'
import { useGitHistoryQuery } from '@/hooks/useGitHistory'
import { useSwitchboard } from '@/hooks/useSwitchboard'
import { DeploymentStatus } from '@/lib/mgmt-airo/types'
import { logger } from '@/lib/request-context'
import { useGitStore } from '@/stores/useGitStore'
import { useSiteStore } from '@/stores/useSiteStore'
import { formatDate } from '@/utils/common'
import { useAppIdFromParams } from './utils'

interface Commit {
  hash: string
  message: string
  author: string
  date: string
}

export default function VersionHistory() {
  const commitsListRef = useRef<HTMLUListElement>(null)
  const appId = useAppIdFromParams()
  const queryClient = useQueryClient()

  const selectedCommitHash = useGitStore((state) => appId ? state.getSelectedCommitHash(appId) : null)
  const isSelectingCommit = useGitStore((state) => state.isSelectingCommit)
  const commitSelectionError = useGitStore((state) => state.commitSelectionError)
  const selectCommitAction = useGitStore((state) => state.selectCommit)
  const setSelectedCommitHash = useGitStore((state) => state.setSelectedCommitHash)
  const setCommitSelectionError = useGitStore((state) => state.setCommitSelectionError)

  const site = useSiteStore((state) => appId ? state.getSite(appId) : null)
  // Coerce to boolean to prevent React Query errors when undefined
  const { data: isPublishButtonEnabled } = useSwitchboard('appbuilder-publish-button')
  const isPublishButtonEnabledFlag = isPublishButtonEnabled === true

  const {
    data,
    isLoading: loading,
    error: queryError
  } = useGitHistoryQuery({
    appId: appId || '',
    enabled: !!appId
  })

  const commits = data?.commits || [] // eslint-disable-line react-hooks/exhaustive-deps
  const currentCommit = data?.currentCommit || null

  // NOTE: commits array is ordered from NEWEST to OLDEST (chronologically descending)
  // Index 0 = most recent commit, higher indices = older commits
  // This ordering is assumed throughout this component for published tag logic

  // Derive the selected commit object from the hash
  const selectedCommit = useMemo(() => {
    if (!selectedCommitHash || !commits.length) return null
    return commits.find(c => c.hash === selectedCommitHash) ?? null
  }, [selectedCommitHash, commits])

  const error = queryError?.message || null

  const { data: deployments = [] } = useDeploymentsQuery({
    appId: appId || '',
    enabled: isPublishButtonEnabledFlag && !!appId && !!site?.agent_url && commits.length > 0,
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

  // Track the last currentCommit we synced to - when it changes, we should sync again
  const lastSyncedCommitRef = useRef<Record<string, string>>({})

  // Auto-select current commit when currentCommit changes
  // Uses lightweight state sync (no checkout) when server provides currentCommit
  // IMPORTANT: Only auto-updates when currentCommit changes - respects manual selections otherwise
  useEffect(() => {
    if (commits.length === 0 || !appId || isSelectingCommit || commitSelectionError) return

    const lastSyncedCommit = lastSyncedCommitRef.current[appId]

    // Auto-select in these cases:
    // 1. No commit selected at all (initial load)
    // 2. currentCommit has changed since we last synced (new commit was made)
    const shouldAutoSelect = !selectedCommitHash || (currentCommit && currentCommit !== lastSyncedCommit)

    if (shouldAutoSelect && currentCommit && commits.some(c => c.hash === currentCommit)) {
      // Use lightweight setter - just sync UI state, don't trigger checkout
      // The server already has this commit checked out (it's HEAD)
      setSelectedCommitHash(appId, currentCommit)
      lastSyncedCommitRef.current[appId] = currentCommit
    } else if (!selectedCommitHash && commits.length > 0) {
      // Fallback: When currentCommit is null (old backend or git failure),
      // use the latest commit to maintain backward compatibility
      setSelectedCommitHash(appId, commits[0].hash)
      lastSyncedCommitRef.current[appId] = commits[0].hash
    }
  }, [commits, selectedCommitHash, currentCommit, isSelectingCommit, commitSelectionError, appId, setSelectedCommitHash])

  // Handle commit selection using global store
  const handleSelectCommit = async (commit: Commit) => {
    // Don't allow selecting if already in progress
    if (isSelectingCommit) {
      logger.debug('version-history.commit.selection-busy', { message: 'Commit selection already in progress, ignoring click' });
      return;
    }

    try {
      await selectCommitAction(appId, commit.hash)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)

      // Any checkout error might mean an auto-commit was created before the failure
      // Always refetch git history to show any auto-commits that may have been created
      logger.info('version-history.commit.error-refetch', {
        message: 'Checkout failed, refetching git history to show any auto-commits',
        appId,
        targetCommit: commit.hash.substring(0, 7),
        error: errorMessage
      })

      await queryClient.invalidateQueries({
        queryKey: ['git-history', appId],
        refetchType: 'active'
      })

      logger.error('version-history.commit.selection-error', {
        message: 'Failed to select commit',
        error: errorMessage
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
          className={`relative pl-2 py-1.5 pr-4 text-left w-full transition-colors duration-200 ${
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
          { isSelected && <CheckboxFilledIcon className="w-2.5 h-2.5 top-0.5 right-0.5 absolute text-intents-ux-feedbackHighContrastSuccess-feedbackColor" /> }
        </button>
      </div>
    </li>
  )

  return (
    <div className="flex-1 flex flex-col h-full overflow-y-auto">
      {/* Scrollable content area */}
      <div className="flex-1 flex flex-col gap-2 p-2 sm:p-0">
        {error && (
          <div className="bg-intents-ux-feedbackCritical-feedbackColor p-1.5 text-sm">
            Error: {error}
          </div>
        )}

        {commitSelectionError && (
          <Alert
            emphasis="critical"
            onClose={() => setCommitSelectionError(null)}
          >
            <div className="font-semibold">Failed to switch version</div>
            <div className="text-sm mt-0.5">{commitSelectionError}</div>
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

        <ul ref={commitsListRef} className="space-y-1 max-h-full">
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
                <div className="flex items-center gap-1">
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
