'use client'

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import Alert from '@ux/alert'
import Button from '@ux/button'
import CheckboxFilledIcon from '@ux/icon/checkbox-filled'
import ChevronDownIcon from '@ux/icon/chevron-down'
import ChevronRightIcon from '@ux/icon/chevron-right'
import EditIcon from '@ux/icon/edit'
import Tag from '@ux/tag'
import Tooltip from '@ux/tooltip'

import PanelSkeleton from '@/app/[market]/develop/components/PanelSkeleton'
import { useChatTabs } from '@/hooks/useChatTabs'
import { useDeploymentsQuery } from '@/hooks/useDeploymentsQuery'
import { useGitHistoryQuery } from '@/hooks/useGitHistory'
import { useIsHistoryDisabled } from '@/hooks/useIsHistoryDisabled'
import { useRestoreCommitMutation } from '@/hooks/useRestoreCommitMutation'
import { useSwitchboard } from '@/hooks/useSwitchboard'
import { useTranslations } from '@/hooks/useTranslations'
import { useUpdateCommitMessageMutation } from '@/hooks/useUpdateCommitMessageMutation'
import { DeploymentStatus } from '@/lib/mgmt-airo/types'
import { logger } from '@/lib/request-context'
import { GIT_HISTORY_PAGE_SIZE } from '@/services/AppService'
import { useGitStore } from '@/stores/useGitStore'
import { useSiteStore } from '@/stores/useSiteStore'
import { formatDate } from '@/utils/common'
import { hasBeenPublished } from '@/utils/site'
import { ChatTab } from './types'
import { useAppIdFromParams } from './utils'

interface Commit {
  hash: string
  message: string
  author: string
  date: string
}

function groupCommitsByDate(commits: Commit[]): Record<string, Commit[]> {
  const groups: Record<string, Commit[]> = {}
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)

  commits.forEach(commit => {
    const commitDate = new Date(commit.date)
    commitDate.setHours(0, 0, 0, 0)

    let groupKey: string
    if (commitDate.getTime() === today.getTime()) {
      groupKey = '__today__'
    } else if (commitDate.getTime() === yesterday.getTime()) {
      groupKey = '__yesterday__'
    } else {
      groupKey = formatDate(commit.date, false)
    }

    if (!groups[groupKey]) {
      groups[groupKey] = []
    }
    groups[groupKey].push(commit)
  })

  return groups
}

interface CommitItemProps {
  message: string
  description?: string | React.ReactNode
  isSelected: boolean
  onClick: () => void
  canEdit?: boolean
  isEditing?: boolean
  onEdit?: () => void
  onSave?: () => void
  disabled?: boolean
  showDisabledTooltip?: boolean
  isRestoring: boolean
  isSelectingCommit: boolean
  updateCommitMessageMutation: ReturnType<typeof useUpdateCommitMessageMutation>
  editingInputRef: React.RefObject<HTMLInputElement>
  editingMessage: string
  setEditingMessage: (message: string) => void
  cancelEdit: () => void
  isSavingEditRef: React.RefObject<boolean>
}

function CommitItem({
  message,
  description,
  isSelected,
  onClick,
  canEdit = false,
  isEditing = false,
  onEdit,
  onSave,
  disabled = false,
  showDisabledTooltip = false,
  isRestoring,
  isSelectingCommit,
  updateCommitMessageMutation,
  editingInputRef,
  editingMessage,
  setEditingMessage,
  cancelEdit,
  isSavingEditRef
}: CommitItemProps) {
  const t = useTranslations()
  const [showTooltip, setShowTooltip] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const tooltipId = useId()

  return (
    <>
      <div
        ref={containerRef}
        data-testid="commit-item-container"
        onMouseEnter={() => showDisabledTooltip && setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        onFocus={() => showDisabledTooltip && setShowTooltip(true)}
        onBlur={() => setShowTooltip(false)}
        aria-describedby={showTooltip ? tooltipId : undefined}
        className={`rounded-md overflow-auto border transition-colors duration-200 ${
          isSelected
            ? 'border-intents-ux-boxHighContrast-borderColor'
            : 'border-intents-ux-boxLowContrast-borderColor'
        } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
      >
        <div className="flex flex-col">
          {!isEditing && (
            <div className="relative">
              <button
                data-testid="commit-selection-button"
                onClick={onClick}
                disabled={isSelectingCommit || disabled}
                className={`relative pl-2 py-1.5 pr-7 text-left w-full transition-colors duration-200 ${
                  isSelectingCommit || disabled
                    ? 'cursor-not-allowed'
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
              {canEdit && onEdit && (
                <button
                  type="button"
                  aria-label={t('builder_common_edit')}
                  onClick={(event) => {
                    event.stopPropagation()
                    onEdit()
                  }}
                  disabled={isSelectingCommit || updateCommitMessageMutation.isPending || disabled}
                  className={`absolute top-3.5 right-0.5 p-0.5 rounded transition-colors duration-200 ${
                    isSelectingCommit || updateCommitMessageMutation.isPending || disabled
                      ? 'cursor-not-allowed'
                      : 'hover:bg-intents-ux-boxLowContrastOverlay-backgroundColor'
                  }`}
                >
                  <EditIcon className="w-2.5 h-2.5" />
                </button>
              )}
            </div>
          )}
          {isEditing && onSave && (
            <div className="pl-2 py-1.5 pr-2">
              <input
                ref={editingInputRef}
                aria-label={t('builder_tools_publish_commit')}
                value={editingMessage}
                onChange={(event) => setEditingMessage(event.target.value)}
                onBlur={() => {
                  if (!updateCommitMessageMutation.isPending && !isSavingEditRef.current) {
                    cancelEdit()
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    void onSave()
                  }
                  if (event.key === 'Escape') {
                    event.preventDefault()
                    cancelEdit()
                  }
                }}
                disabled={updateCommitMessageMutation.isPending || disabled}
                className="w-full text-sm font-medium px-1 py-0.5 rounded border border-intents-ux-boxHighContrast-borderColor bg-intents-ux-container-background text-intents-ux-textColor"
                autoFocus
              />
              {description && (
                <div className="text-xs mt-1">
                  {description}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      {showTooltip && showDisabledTooltip && (
        <Tooltip id={tooltipId} anchorRef={containerRef} portalElem={document.body}>
          <div className="p-1 max-w-[30ch] break-words text-sm">
            {isRestoring
              ? t('builder_version_history_disabled_during_restore', undefined, 'Cannot interact with version history while restoration is in progress')
              : t('builder_version_history_disabled_during_publish', undefined, 'Cannot interact with version history while publish is in progress')}
          </div>
        </Tooltip>
      )}
    </>
  )
}

export default function VersionHistory() {
  const t = useTranslations();
  const editingInputRef = useRef<HTMLInputElement>(null)
  const isSavingEditRef = useRef(false)
  const appId = useAppIdFromParams()
  const queryClient = useQueryClient()
  const { activeChatTab } = useChatTabs()
  const [editingCommitHash, setEditingCommitHash] = useState<string | null>(null)
  const [editingMessage, setEditingMessage] = useState('')

  const selectedCommitHash = useGitStore((state) => appId ? state.getSelectedCommitHash(appId) : null)
  const isSelectingCommit = useGitStore((state) => state.isSelectingCommit)
  const commitSelectionError = useGitStore((state) => state.commitSelectionError)
  const selectCommitAction = useGitStore((state) => state.selectCommit)
  const setSelectedCommitHash = useGitStore((state) => state.setSelectedCommitHash)
  const setCommitSelectionError = useGitStore((state) => state.setCommitSelectionError)
  const updateCommitMessageMutation = useUpdateCommitMessageMutation()

  const site = useSiteStore((state) => appId ? state.getSite(appId) : null)
  const isHistoryTabActive = activeChatTab === ChatTab.HISTORY;
  const restoreMutation = useRestoreCommitMutation();
  const { isDisabled: isHistoryDisabled, isPublishing } = useIsHistoryDisabled(appId || '', restoreMutation.isPending);

  // Only fetch when the history tab is actually open — VersionHistory is always mounted
  // (display:none-based tab switching), so without this guard the flag fires on every page load.
  const { data: isPublishButtonEnabled } = useSwitchboard('appbuilder-publish-button', { enabled: isHistoryTabActive })
  const isPublishButtonEnabledFlag = isPublishButtonEnabled === true
  const isAppPublished = hasBeenPublished(site);

  // Pagination state
  const [offset, setOffset] = useState(0);
  const [allCommits, setAllCommits] = useState<Commit[]>([]);
  const [hasMoreCommits, setHasMoreCommits] = useState(true);
  const [editError, setEditError] = useState<string | null>(null)
  const [restoreError, setRestoreError] = useState<string | null>(null)
  const [restoringHash, setRestoringHash] = useState<string | null>(null)

  // Collapsed date groups state (Set of collapsed date group keys)
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  const {
    data,
    isLoading: loading,
    error: queryError,
    isFetching
  } = useGitHistoryQuery({
    appId: appId || '',
    enabled: !!appId && isHistoryTabActive,
    offset
  })

  useEffect(() => {
    setOffset(0)
    setAllCommits([])
    setHasMoreCommits(true)
    setCollapsedGroups(new Set())
    setRestoringHash(null)
  }, [appId, isHistoryTabActive])

  useEffect(() => {
    if (!appId || !isHistoryTabActive || !data?.commits) {
      return
    }
    if (offset === 0) {
      setAllCommits(data.commits)
    } else {
      setAllCommits(prev => {
        const existingHashes = new Set(prev.map(c => c.hash))
        const newCommits = data.commits.filter(c => !existingHashes.has(c.hash))
        return [...prev, ...newCommits]
      })
    }
    setHasMoreCommits(data.hasMore)
  }, [appId, data?.commits, data?.hasMore, isHistoryTabActive, offset])

  const commitHashToIndex = useMemo(() => {
    const m = new Map<string, number>()
    for (let i = 0; i < allCommits.length; i++) {
      m.set(allCommits[i].hash, i)
    }
    return m
  }, [allCommits])
  const currentCommit = data?.currentCommit || null

  // NOTE: commits array is ordered from NEWEST to OLDEST (chronologically descending)
  // Index 0 = most recent commit, higher indices = older commits
  // This ordering is assumed throughout this component for published tag logic

  // Derive the selected commit object from the hash
  const selectedCommit = useMemo(() => {
    if (!selectedCommitHash || !allCommits.length) return null
    return allCommits.find(c => c.hash === selectedCommitHash) ?? null
  }, [selectedCommitHash, allCommits])

  const error = queryError?.message || null

  const { data: deployments = [] } = useDeploymentsQuery({
    appId: appId || '',
    enabled: isPublishButtonEnabledFlag && !!appId && !!site?.agent_url && allCommits.length > 0 && isHistoryTabActive,
    includeJobData: true,
    limit: allCommits.length > 150 ? 150 : allCommits.length,
  })

  // Find the most recent deployed commit index
  // All commits from that index and before (including it) should be marked as published
  const mostRecentDeployedCommitIndex = useMemo(() => {
    const mostRecentDeployment = deployments.find(d => d.status === DeploymentStatus.DEPLOYED);
    if (!mostRecentDeployment) return -1;

    return allCommits.findIndex(c => c.hash === mostRecentDeployment.gitHash);
  }, [deployments, allCommits])

  const groupedCommits = useMemo(() => groupCommitsByDate(allCommits), [allCommits])

  const getGroupLabel = (groupKey: string): string => {
    if (groupKey === '__today__') {
      return t('builder_version_history_today')
    }
    if (groupKey === '__yesterday__') {
      return t('builder_version_history_yesterday')
    }
    return groupKey
  }

  // Track the last currentCommit we synced to - when it changes, we should sync again
  const lastSyncedCommitRef = useRef<Record<string, string>>({})

  // Auto-select current commit when currentCommit changes
  // Uses lightweight state sync (no checkout) when server provides currentCommit
  // IMPORTANT: Only auto-updates when currentCommit changes - respects selections that differ from last auto-sync
  useEffect(() => {
    if (allCommits.length === 0 || !appId || isSelectingCommit || commitSelectionError) return

    const lastSyncedCommit = lastSyncedCommitRef.current[appId]

    // Auto-select in these cases:
    // 1. No commit selected at all (initial load)
    // 2. currentCommit has changed since we last synced (new commit was made)
    // Only auto-select if we haven't moved selection beyond the last auto-sync
    const shouldAutoSelect = !selectedCommitHash || selectedCommitHash === lastSyncedCommit

    if (shouldAutoSelect && currentCommit && allCommits.some(c => c.hash === currentCommit)) {
      // Use lightweight setter - just sync UI state, don't trigger checkout
      // The server already has this commit checked out (it's HEAD)
      setSelectedCommitHash(appId, currentCommit)
      lastSyncedCommitRef.current[appId] = currentCommit
    } else if (!selectedCommitHash && allCommits.length > 0) {
      // Fallback: When currentCommit is null (old backend or git failure),
      // use the latest commit to maintain backward compatibility
      setSelectedCommitHash(appId, allCommits[0].hash)
      lastSyncedCommitRef.current[appId] = allCommits[0].hash
    }
  }, [allCommits, selectedCommitHash, currentCommit, isSelectingCommit, commitSelectionError, appId, setSelectedCommitHash])

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
        appId,
        message: 'Failed to select commit',
        error: errorMessage
      });
    }
  }

  const startEdit = (commit: Commit) => {
    setEditingCommitHash(commit.hash)
    setEditingMessage(commit.message)
    setEditError(null)
  }

  const cancelEdit = () => {
    setEditingCommitHash(null)
    setEditingMessage('')
    setEditError(null)
  }

  const saveEdit = async (commit: Commit) => {
    if (updateCommitMessageMutation.isPending || editingCommitHash !== commit.hash) {
      return
    }

    const message = editingMessage.trim()
    if (!message) {
      setEditError(t('builder_common_required_field_err'))
      editingInputRef.current?.focus()
      return
    }

    if (!appId || message === commit.message) {
      cancelEdit()
      return
    }

    try {
      isSavingEditRef.current = true
      const result = await updateCommitMessageMutation.mutateAsync({
        appId,
        message,
        expectedHash: commit.hash,
      })
      lastSyncedCommitRef.current[appId] = result.newCommitHash
      cancelEdit()
    } catch (error) {
      setEditError(error instanceof Error ? error.message : String(error))
      editingInputRef.current?.focus()
    } finally {
      isSavingEditRef.current = false
    }
  }

  const handleRestoreCommit = (commit: Commit) => {
    setRestoreError(null)
    setRestoringHash(commit.hash)
    restoreMutation.mutate(
      { appId, commitHash: commit.hash },
      {
        onSuccess: () => {
          logger.info('version-history.restore.success', {
            appId,
            commitHash: commit.hash.substring(0, 7)
          });
        },
        onError: (error) => {
          const errorMessage = error instanceof Error ? error.message : String(error)
          setRestoreError(errorMessage)
          logger.error('version-history.restore.error', {
            appId,
            error: errorMessage
          })
        },
        onSettled: () => {
          setRestoringHash(null)
        }
      }
    );
  };

  // Toggle date group collapse state
  const toggleDateGroup = (dateGroup: string) => {
    setCollapsedGroups(prev => {
      const newSet = new Set(prev);
      if (newSet.has(dateGroup)) {
        newSet.delete(dateGroup);
      } else {
        newSet.add(dateGroup);
      }
      return newSet;
    });
  };

  // Determine if commit is latest
  const isLatestCommit = (commit: Commit) => {
    return allCommits.length > 0 && allCommits[0].hash === commit.hash;
  };

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

        {editError && (
          <Alert
            emphasis="critical"
            onClose={() => setEditError(null)}
          >
            <div className="font-semibold">{t('builder_version_history_edit_error')}</div>
            <div className="text-sm mt-0.5">{editError}</div>
          </Alert>
        )}

        {loading && (
          <PanelSkeleton panelType={ChatTab.HISTORY} />
        )}

        {!loading && allCommits.length === 0 && !error && (
          <div className="flex justify-center items-center h-full">
            {t('builder_version_history_empty')}
          </div>
        )}

        {restoreError && (
          <Alert
            emphasis="critical"
            onClose={() => setRestoreError(null)}
          >
            <div className="font-semibold">{t('builder_preview_error_failed')}</div>
            <div className="text-sm mt-0.5">{restoreError}</div>
          </Alert>
        )}

        <div className="space-y-3">
          {Object.entries(groupedCommits).map(([dateGroup, dateCommits]) => {
            const isCollapsed = collapsedGroups.has(dateGroup);
            const commitCount = dateCommits.length;

            return (
              <div key={dateGroup}>
                <button
                  data-testid="date-group-toggle"
                  onClick={() => toggleDateGroup(dateGroup)}
                  disabled={isHistoryDisabled}
                  className={`w-full flex items-center gap-1.5 text-xs font-semibold text-intents-ux-textMediumEmphasis-textColor mb-1 px-1 transition-colors ${
                    isHistoryDisabled
                      ? 'opacity-50 cursor-not-allowed'
                      : 'hover:text-intents-ux-textHighEmphasis-textColor'
                  }`}
                >
                  {isCollapsed ? (
                    <ChevronRightIcon className="w-3 h-3" />
                  ) : (
                    <ChevronDownIcon className="w-3 h-3" />
                  )}
                  <span>{getGroupLabel(dateGroup)}</span>
                  <span className="text-intents-ux-textLowEmphasis-textColor font-normal">({commitCount})</span>
                </button>
                {!isCollapsed && (
                  <ul className="space-y-1">
                    {dateCommits.map((commit) => {
                      const commitIndex = commitHashToIndex.get(commit.hash) ?? -1
                      const isPublished = mostRecentDeployedCommitIndex >= 0 &&
                        commitIndex >= mostRecentDeployedCommitIndex
                      const isSelected = selectedCommit?.hash === commit.hash;
                      const showRestore = isSelected && !isLatestCommit(commit);
                      const isRestoringThisCommit =
                        restoreMutation.isPending && restoringHash === commit.hash

                      return (
                        <li key={commit.hash} className="space-y-1">
                          <CommitItem
                            onClick={() => handleSelectCommit(commit)}
                            message={commit.message}
                            canEdit={commitIndex === 0 && commit.hash === currentCommit}
                            isEditing={editingCommitHash === commit.hash}
                            onEdit={() => startEdit(commit)}
                            onSave={() => saveEdit(commit)}
                            description={
                              <div className="flex items-center gap-1">
                                <Tag type="info">{commit.hash.substring(0, 7)}</Tag>
                                {isPublished && (
                                  <Tag emphasis={isAppPublished ? "success" : "passive"}>
                                    {isAppPublished ? t("builder_status_published") : t("builder_status_unpublished")}
                                  </Tag>
                                )}
                                <span className="text-xs">
                                  {formatDate(commit.date, true)}
                                </span>
                              </div>
                            }
                            isSelected={isSelected}
                            disabled={isHistoryDisabled}
                            showDisabledTooltip={isPublishing || restoreMutation.isPending}
                            isRestoring={restoreMutation.isPending}
                            isSelectingCommit={isSelectingCommit}
                            updateCommitMessageMutation={updateCommitMessageMutation}
                            editingInputRef={editingInputRef}
                            editingMessage={editingMessage}
                            setEditingMessage={setEditingMessage}
                            cancelEdit={cancelEdit}
                            isSavingEditRef={isSavingEditRef}
                          />
                          {showRestore && (
                            <div className="px-2 pb-1">
                              <Button
                                design="secondary"
                                size="sm"
                                onClick={() => handleRestoreCommit(commit)}
                                disabled={restoreMutation.isPending || isHistoryDisabled}
                              >
                                {isRestoringThisCommit ? t('builder_preview_error_restoring') : t('builder_preview_error_restore')}
                              </Button>
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })}
        </div>

        {hasMoreCommits && !loading && allCommits.length > 0 && (
          <div className="flex justify-center pt-2 pb-2">
            <Button
              design="tertiary"
              size="md"
              onClick={() => setOffset(prev => prev + GIT_HISTORY_PAGE_SIZE)}
              disabled={isFetching || isHistoryDisabled}
            >
              {isFetching ? t('builder_common_loading') : t('builder_version_history_load_more')}
            </Button>
          </div>
        )}
      </div>

    </div>
  )
}
