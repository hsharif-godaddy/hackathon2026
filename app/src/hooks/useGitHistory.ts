import { useState, useEffect, useCallback } from 'react'
import { appService } from '@/services/AppService'
import { logger } from '@/lib/request-context'

interface GitCommit {
  hash: string
  message: string
  author: string
  date: string
}

export function useGitHistory(appId: string, autoLoad = true) {
  const [commits, setCommits] = useState<GitCommit[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadGitHistory = useCallback(async (forceReload = false) => {
    if (!appId) return
    
    // Don't load if already loading, unless forcing
    if (isLoading && !forceReload) {
      logger.debug('git-history.skip-loading', { message: 'Git history already loading for app', appId })
      return
    }

    // Don't load if already loaded, unless forcing
    if (commits.length > 0 && !forceReload) {
      logger.debug('git-history.skip-loaded', { message: 'Git history already loaded for app', appId })
      return
    }

    setIsLoading(true)
    setError(null)
    logger.info('git-history.load.begin', { message: 'Starting git history load for app', appId })

    // Smart retry logic - longer delays for newer apps that might not be ready
    let attempts = 0
    const maxAttempts = 4
    const delays = [0, 2000, 4000, 8000] // Progressive delays

    while (attempts < maxAttempts) {
      attempts++

      try {
        logger.debug('git-history.load.attempt', { message: 'Git history attempt', attempt: attempts, maxAttempts, appId })

        // Add delay before attempt (except first)
        if (attempts > 1) {
          const delay = delays[attempts - 1] || 8000
          logger.debug('git-history.load.wait', { message: 'Waiting before git history attempt', delay, attempt: attempts })
          await new Promise(resolve => setTimeout(resolve, delay))
        }

        const { commits: loadedCommits } = await appService.getGitHistory(appId)
        
        setCommits(loadedCommits || [])
        setIsLoading(false)
        setError(null)
        
        logger.info('git-history.load.success', { message: 'Git history loaded', commits: loadedCommits?.length || 0, appId })
        return

      } catch (err: unknown) {
        const errorMessage = (err as Error)?.message || String(err) || 'Unknown error'
        logger.warn('git-history.load.attempt-failed', { message: 'Git history attempt failed', attempt: attempts, maxAttempts, appId, error: errorMessage })

        // Don't retry certain permanent errors
        if (errorMessage.includes('404') || 
            errorMessage.includes('403') || 
            errorMessage.includes('not found') ||
            errorMessage.includes('Not a git repository')) {
          logger.warn('git-history.load.permanent-error', { message: 'Permanent git error detected, stopping retries', error: errorMessage })
          setError(errorMessage)
          break
        }
      }
    }

    // All attempts failed
    logger.error('git-history.load.failure', { message: 'Git history loading failed', appId, attempts })
    setIsLoading(false)
    setCommits([]) // Set empty array to indicate we tried but failed
  }, [appId, isLoading, commits.length])

  // Auto-load on appId change
  useEffect(() => {
    if (autoLoad && appId) {
      // Wait 5 seconds for app to be ready, then load git history
      const timer = setTimeout(() => {
        loadGitHistory()
      }, 5000)
      
      return () => clearTimeout(timer)
    }
  }, [appId, autoLoad, loadGitHistory])

  // Cleanup on unmount or appId change
  useEffect(() => {
    return () => {
      setCommits([])
      setIsLoading(false)
      setError(null)
    }
  }, [appId])

  return {
    commits,
    isLoading,
    error,
    loadGitHistory: () => loadGitHistory(true), // Force reload when called manually
    refresh: () => loadGitHistory(true)
  }
}