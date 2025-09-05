import { useState, useEffect, useCallback } from 'react'
import { appService } from '@/services/AppService'

interface GitCommit {
  hash: string
  shortHash: string
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
      console.log('🔄 Git history already loading for app:', appId)
      return
    }

    // Don't load if already loaded, unless forcing
    if (commits.length > 0 && !forceReload) {
      console.log('📚 Git history already loaded for app:', appId)
      return
    }

    setIsLoading(true)
    setError(null)
    console.log('📚 Starting git history load for app:', appId)

    // Smart retry logic - longer delays for newer apps that might not be ready
    let attempts = 0
    const maxAttempts = 4
    const delays = [0, 2000, 4000, 8000] // Progressive delays

    while (attempts < maxAttempts) {
      attempts++

      try {
        console.log(`🔄 Git history attempt ${attempts}/${maxAttempts} for app ${appId}`)

        // Add delay before attempt (except first)
        if (attempts > 1) {
          const delay = delays[attempts - 1] || 8000
          console.log(`⏳ Waiting ${delay}ms before git history attempt ${attempts}...`)
          await new Promise(resolve => setTimeout(resolve, delay))
        }

        const { commits: loadedCommits } = await appService.getGitHistory(appId)
        
        setCommits(loadedCommits || [])
        setIsLoading(false)
        setError(null)
        
        console.log(`✅ Git history loaded: ${loadedCommits?.length || 0} commits for app ${appId}`)
        return

      } catch (err: unknown) {
        const errorMessage = (err as Error)?.message || String(err) || 'Unknown error'
        console.log(`⚠️ Git history attempt ${attempts}/${maxAttempts} failed for app ${appId}:`, errorMessage)

        // Don't retry certain permanent errors
        if (errorMessage.includes('404') || 
            errorMessage.includes('403') || 
            errorMessage.includes('not found') ||
            errorMessage.includes('Not a git repository')) {
          console.log('🛑 Permanent git error detected, stopping retries:', errorMessage)
          setError(errorMessage)
          break
        }
      }
    }

    // All attempts failed
    console.log(`❌ Git history loading failed for app ${appId} after ${attempts} attempts`)
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