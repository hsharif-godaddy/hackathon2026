'use client'

import clsx from 'clsx'
import dynamic from 'next/dynamic'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import Button from '@ux/button'
import DownloadIcon from '@ux/icon/download'
import HamburgerIcon from '@ux/icon/hamburger'
import PageIcon from '@ux/icon/page'
import SearchIcon from '@ux/icon/search'
import XIcon from '@ux/icon/x'
import Spinner from '@ux/spinner'
import Text from '@ux/text'

import FileTree, { FileItem, FileStatus } from '@/app/[market]/develop/components/FileTree'
import { markdownComponents } from '@/app/[market]/develop/components/preview/markdownComponents'
import UnifiedSearch, { SearchState } from '@/app/[market]/develop/components/UnifiedSearch'
import { useBreakpoints } from '@/hooks/useBreakpoints'
import { useTranslations } from '@/hooks/useTranslations'
import { logger } from '@/lib/request-context'
import { appService } from '@/services/AppService'
import { useCodeSyncStore } from '@/stores/useCodeSyncStore'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
import { useFileTreeStore } from '@/stores/useFileTreeStore'
import { useServerPollingStore } from '@/stores/useServerPollingStore'
import { useSiteCreationStore } from '@/stores/useSiteCreationStore'
import { BINARY_FILE_REGEX, IMAGE_FILE_REGEX, VIDEO_FILE_REGEX } from '@/utils/file-types'

const EMPTY_ARRAY: never[] = [];

// Special path for the search "file"
const SEARCH_PATH = '__search__'

// Dynamically import Monaco Editor to avoid SSR issues
const MonacoEditor = dynamic(() => import('@monaco-editor/react'), {
  ssr: false,
  loading: () => (
    <div className="h-full flex items-center justify-center text-white">
      <div className="text-center">
        <div className="animate-spin rounded-full h-4 w-4 border-b-2 mx-auto mb-1"></div>
      </div>
    </div>
  )
})

/**
 * Configure Monaco TypeScript/JavaScript compiler options for JSX support
 * This prevents false error highlighting for TSX/JSX files
 */
function handleEditorWillMount(monaco: typeof import('monaco-editor')) {
  // Configure TypeScript compiler options for JSX support
  monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
    target: monaco.languages.typescript.ScriptTarget.ESNext,
    module: monaco.languages.typescript.ModuleKind.ESNext,
    moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
    jsx: monaco.languages.typescript.JsxEmit.ReactJSX,
    allowJs: true,
    allowSyntheticDefaultImports: true,
    esModuleInterop: true,
    strict: false,
    skipLibCheck: true,
    noEmit: true,
    isolatedModules: true,
    resolveJsonModule: true,
    baseUrl: '.',
    paths: {
      '@/*': ['src/*']
    }
  });

  // Also configure JavaScript defaults for JSX files
  monaco.languages.typescript.javascriptDefaults.setCompilerOptions({
    target: monaco.languages.typescript.ScriptTarget.ESNext,
    module: monaco.languages.typescript.ModuleKind.ESNext,
    moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
    jsx: monaco.languages.typescript.JsxEmit.ReactJSX,
    allowJs: true,
    allowSyntheticDefaultImports: true,
    esModuleInterop: true,
  });

  // Disable semantic validation to prevent false errors from missing type definitions
  monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
    noSemanticValidation: true,
    noSyntaxValidation: false,
  });

  monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
    noSemanticValidation: true,
    noSyntaxValidation: false,
  });
}

interface OpenFile {
  path: string
  name: string
  content: string
  language: string
  isDirty: boolean
  isSearch?: boolean
}

interface PreviewCodeProps {
  appId: string
}

export default function PreviewCode({ appId }: PreviewCodeProps) {
  const t = useTranslations();
  const [openFiles, setOpenFiles] = useState<OpenFile[]>([])
  const [activeFile, setActiveFile] = useState<string | null>(null)
  const [saving, setSaving] = useState<string | null>(null)
  const [recentlySaved, setRecentlySaved] = useState<string | null>(null)
  const [showMarkdownPreview, setShowMarkdownPreview] = useState(false)
  const [searchState, setSearchState] = useState<SearchState | undefined>(undefined)
  const [isSearchExpanded, setIsSearchExpanded] = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)

  const { isBelowSmBreakpoint } = useBreakpoints()
  // On mobile, start with file tree open so users know it exists
  const [showFileTree, setShowFileTree] = useState(isBelowSmBreakpoint)
  const setHasUnsavedChanges = useDevelopPageStore((state) => state.setHasUnsavedChanges)

  // Subscribe to page initialization state - only load files when page is ready
  // This prevents redundant ensure-running calls since the initialization state machine
  // already handles app readiness verification
  const loadingPhase = useDevelopPageStore((state) => state.loadingPhase)

  // Use realAppId if available (during temp→real ID transition), otherwise use appId from params
  // This prevents ensure-running calls with stale temp IDs after navigation
  const realAppId = useSiteCreationStore((state) => state.realAppId)
  const effectiveAppId = realAppId ?? appId

  // Subscribe to file changes from CodeSyncStore
  // Use changeVersion to trigger updates without recreating arrays
  const changeVersion = useCodeSyncStore((state) => state.changeVersion)
  const clearFileChange = useCodeSyncStore((state) => state.clearFileChange)
  const addConflict = useCodeSyncStore((state) => state.addConflict)
  const resolveConflict = useCodeSyncStore((state) => state.resolveConflict)
  const hasConflict = useCodeSyncStore((state) => state.hasConflict)
  const getFileChange = useCodeSyncStore((state) => state.getFileChange)

  // Get preview URL for serving binary files
  const getServerState = useServerPollingStore((state) => state.getServerState)
  const serverState = getServerState(appId)
  const previewUrl = serverState?.url

  // Subscribe to file tree store for shared state
  const files = useFileTreeStore((state) => state.files[effectiveAppId] ?? EMPTY_ARRAY)
  const isLoading = useFileTreeStore((state) => state.loading[effectiveAppId] ?? false)
  const error = useFileTreeStore((state) => state.errors[effectiveAppId] ?? null)

  // Refs for file loading and editing

  const editorRef = useRef<any>(null)
  const pendingLineNumberRef = useRef<number | null>(null)
  const loadingFilesRef = useRef<Set<string>>(new Set())
  const processedChangesRef = useRef<Set<string>>(new Set())
  const changeTimeoutsRef = useRef<Map<string, NodeJS.Timeout>>(new Map())
  const isMountedRef = useRef(true)
  const effectiveAppIdRef = useRef<string | null>(effectiveAppId)


  // Add a file to the tree incrementally
  const addFileToTree = useCallback((tree: FileItem[], filePath: string): FileItem[] => {
    const pathParts = filePath.split('/').filter(Boolean)
    let currentLevel = tree
    let currentPath = ''

    for (let i = 0; i < pathParts.length; i++) {
      const part = pathParts[i]
      currentPath = currentPath ? `${currentPath}/${part}` : part
      const isLastPart = i === pathParts.length - 1

      const existingItem = currentLevel.find(item => item.name === part)

      if (existingItem) {
        if (!isLastPart && existingItem.children) {
          currentLevel = existingItem.children
        }
      } else {
        const newItem: FileItem = {
          name: part,
          type: isLastPart ? 'file' : 'folder',
          path: currentPath,
          extension: isLastPart ? part.split('.').pop() : undefined,
          children: isLastPart ? undefined : []
        }

        currentLevel.push(newItem)

        if (!isLastPart && newItem.children) {
          currentLevel = newItem.children
        }
      }
    }

    return [...tree]
  }, [])

  // Remove a file from the tree incrementally
  const removeFileFromTree = useCallback((tree: FileItem[], filePath: string): FileItem[] => {
    const pathParts = filePath.split('/').filter(Boolean)

    const removeRecursive = (items: FileItem[], parts: string[], depth: number): FileItem[] => {
      if (depth >= parts.length) return items

      const part = parts[depth]
      const isLastPart = depth === parts.length - 1

      if (isLastPart) {
        return items.filter(item => item.name !== part)
      }

      return items.map(item => {
        if (item.name === part && item.children) {
          const updatedChildren = removeRecursive(item.children, parts, depth + 1)
          // Remove empty folders
          if (updatedChildren.length === 0) {
            return null
          }
          return { ...item, children: updatedChildren }
        }
        return item
      }).filter((item): item is FileItem => item !== null)
    }

    return removeRecursive(tree, pathParts, 0)
  }, [])

  // Load file content from backend - throws on error to allow caller to handle
  const loadFileContent = useCallback(async (filePath: string): Promise<string> => {
    if (!effectiveAppId) {
      throw new Error('App ID is required to load file content')
    }

    // Check if this is a binary file (image, PDF, video)
    const isBinary = BINARY_FILE_REGEX.test(filePath)

    // For binary files, return URL to the file in the running app instead of reading content
    if (isBinary && previewUrl) {
      // Convert file path to web path (remove public/ prefix if exists)
      let webPath = filePath.replace(/^public\//, '/')
      if (!webPath.startsWith('/')) {
        webPath = '/' + webPath
      }
      const fullUrl = `${previewUrl}${webPath}`

      logger.info('code-editor.binary-file.url-generated', {
        filePath,
        webPath,
        previewUrl,
        fullUrl
      })

      return fullUrl
    }

    try {
      const result = await appService.readFile(effectiveAppId, filePath)
      return result.content
    } catch (error) {
      logger.error('code-editor.file.load-error', {
        message: 'Error loading file',
        filePath,
        error: error instanceof Error ? error.message : String(error)
      })
      throw error // Re-throw to allow caller to handle
    }
  }, [effectiveAppId, previewUrl])

  // Save file content to backend
  const saveFileContent = useCallback(async (filePath: string, content: string): Promise<boolean> => {
    if (!effectiveAppId) {
      throw new Error('App ID is required to save file')
    }
    try {
      const result = await appService.writeFile(effectiveAppId, filePath, content, 'rewrite')
      return typeof result.success === 'boolean' ? result.success : true
    } catch (error) {
      logger.error('code-editor.file.save-error', {
        message: 'Error saving file',
        filePath,
        error: error instanceof Error ? error.message : String(error)
      })
      return false // Return false for save errors (UI can continue)
    }
  }, [effectiveAppId])

  // Keep effectiveAppId ref in sync to avoid stale closure in cleanup
  useEffect(() => {
    effectiveAppIdRef.current = effectiveAppId
  }, [effectiveAppId])

  // Master cleanup effect - ensures refs are reset on unmount
  useEffect(() => {
    isMountedRef.current = true
    const changeTimeouts = changeTimeoutsRef.current
    const loadingFiles = loadingFilesRef.current
    const processedChanges = processedChangesRef.current

    return () => {
      isMountedRef.current = false

      // Clear all change timeouts
      changeTimeouts.forEach(timeout => clearTimeout(timeout))
      changeTimeouts.clear()

      // Reset all refs to initial state
      loadingFiles.clear()
      processedChanges.clear()

      // Reset file tree store state for this app (use ref to avoid stale closure)
      const currentAppId = effectiveAppIdRef.current
      if (currentAppId) {
        useFileTreeStore.getState().reset(currentAppId)
      }
    }

  }, [])

  useEffect(() => {
    // Clear processed changes when effectiveAppId changes (including temp→real ID transitions)
    // to prevent stale state across different apps
    processedChangesRef.current.clear()

    const changeTimeouts = changeTimeoutsRef.current
    const loadingFiles = loadingFilesRef.current
    const processedChanges = processedChangesRef.current

    // Only load files when the page initialization is complete
    // The initialization state machine ensures the app is registered and running
    // before setting loadingPhase to 'ready'
    // Use cache-first loading to avoid duplicate API calls
    if (loadingPhase === 'ready' && effectiveAppId) {
      useFileTreeStore.getState().loadFilesFromCacheOrFetch(effectiveAppId)
    }

    // Cleanup: cancel pending operations when effectiveAppId or loadingPhase changes
    return () => {
      // Clear all change timeouts
      changeTimeouts.forEach(timeout => clearTimeout(timeout))
      changeTimeouts.clear()

      // Clear loading state refs (only if still mounted, otherwise master cleanup handles it)
      if (isMountedRef.current) {
        loadingFiles.clear()
        processedChanges.clear()
      }
    }
  }, [effectiveAppId, loadingPhase])

  // Handle file changes from agent operations
  useEffect(() => {
    // Get current file changes from store
    const fileChanges = useCodeSyncStore.getState().fileChanges
    if (fileChanges.size === 0) return

    logger.info('code-editor.file-changes.detected', {
      changeCount: fileChanges.size,
      changeVersion,
      changes: Array.from(fileChanges.entries()).map(([path, change]) => ({
        path,
        operation: change.operation,
        streaming: change.streaming
      }))
    })

    const processFileChanges = async () => {
      for (const [filePath, change] of fileChanges.entries()) {
        // Skip if already processed or still streaming
        if (change.streaming || processedChangesRef.current.has(`${filePath}-${change.timestamp}`)) {
          continue
        }

        const changeKey = `${filePath}-${change.timestamp}`
        processedChangesRef.current.add(changeKey)

        logger.info('code-editor.file-change.processing', {
          filePath,
          operation: change.operation
        })

        // Update file tree incrementally in the store
        if (change.operation === 'create' || change.operation === 'modify') {
          const currentFiles = useFileTreeStore.getState().files[effectiveAppId] ?? EMPTY_ARRAY
          useFileTreeStore.getState().setFiles(effectiveAppId, addFileToTree(currentFiles, filePath))
        } else if (change.operation === 'delete') {
          const currentFiles = useFileTreeStore.getState().files[effectiveAppId] ?? EMPTY_ARRAY
          useFileTreeStore.getState().setFiles(effectiveAppId, removeFileFromTree(currentFiles, filePath))
          // Calculate remaining files before state updates (prevents stale closure)
          const remainingFiles = openFiles.filter(f => f.path !== filePath)
          // Close the file if it's open
          setOpenFiles(remainingFiles)
          // Switch active file if needed
          if (activeFile === filePath) {
            setActiveFile(remainingFiles.length > 0 ? remainingFiles[remainingFiles.length - 1].path : null)
          }
        }

        // Handle open file reload with conflict detection
        const openFile = openFiles.find(f => f.path === filePath)
        if (openFile && change.operation !== 'delete') {
          if (openFile.isDirty) {
            // File has unsaved changes - mark as conflict
            addConflict(filePath)
            logger.info('code-editor.file-change.conflict', {
              filePath,
              message: 'File has unsaved changes, showing reload prompt'
            })
          } else {
            // File is clean - auto-reload
            try {
              const newContent = await loadFileContent(filePath)
              setOpenFiles(prev =>
                prev.map(f =>
                  f.path === filePath ? { ...f, content: newContent, isDirty: false } : f
                )
              )
              logger.info('code-editor.file-change.reloaded', {
                filePath,
                message: 'File auto-reloaded successfully'
              })
            } catch (error) {
              logger.error('code-editor.file-change.reload-error', {
                filePath,
                error: error instanceof Error ? error.message : String(error)
              })
            }
          }
        }

        // Clear the change after a delay to allow visual indicators to show
        const timeoutId = setTimeout(() => {
          clearFileChange(filePath)
          changeTimeoutsRef.current.delete(filePath)
        }, 3000)
        changeTimeoutsRef.current.set(filePath, timeoutId)
      }
    }

    processFileChanges()

    const changeTimeouts = changeTimeoutsRef.current
    // Cleanup: clear all pending change timeouts
    return () => {
      changeTimeouts.forEach(timeout => clearTimeout(timeout))
      changeTimeouts.clear()
    }
  }, [changeVersion, openFiles, activeFile, effectiveAppId, addFileToTree, removeFileFromTree, loadFileContent, addConflict, clearFileChange])

  // Notify parent about unsaved changes
  useEffect(() => {
    const hasUnsavedChanges = openFiles.some(file => file.isDirty)
    setHasUnsavedChanges(hasUnsavedChanges)
  }, [openFiles, setHasUnsavedChanges])

  // Get file status for visual indicators
  const getFileStatus = useCallback((path: string): FileStatus => {
    const change = getFileChange(path)
    if (!change) return 'normal'
    if (change.streaming) return 'streaming'
    if (change.operation === 'delete') return 'deleted'
    if (change.operation === 'create' || change.operation === 'modify') return 'modified'
    return 'normal'
  }, [getFileChange])

  // Handle conflict resolution - reload file with latest content
  const handleReloadFile = useCallback(async (filePath: string) => {
    try {
      const newContent = await loadFileContent(filePath)
      setOpenFiles(prev =>
        prev.map(f =>
          f.path === filePath ? { ...f, content: newContent, isDirty: false } : f
        )
      )
      resolveConflict(filePath)
      clearFileChange(filePath)
      logger.info('code-editor.conflict.resolved', {
        filePath,
        message: 'File reloaded with latest content'
      })
    } catch (error) {
      logger.error('code-editor.conflict.reload-error', {
        filePath,
        error: error instanceof Error ? error.message : String(error)
      })
      alert(t('builder_code_alert_failed_reload'))
    }
  }, [loadFileContent, resolveConflict, clearFileChange, t])

  // Handle keeping user's changes - dismiss conflict and clear change indicator
  const handleKeepMyChanges = useCallback((filePath: string) => {
    resolveConflict(filePath)
    clearFileChange(filePath)
    logger.info('code-editor.conflict.kept-changes', {
      filePath,
      message: 'User chose to keep their changes'
    })
  }, [resolveConflict, clearFileChange])

  const getLanguageFromPath = (path: string): string => {
    const ext = path.split('.').pop()?.toLowerCase()
    switch (ext) {
      case 'tsx':
      case 'jsx':
        return 'typescript'
      case 'ts':
        return 'typescript'
      case 'js':
        return 'javascript'
      case 'json':
        return 'json'
      case 'css':
        return 'css'
      case 'scss':
        return 'scss'
      case 'html':
        return 'html'
      case 'md':
        return 'markdown'
      default:
        return 'plaintext'
    }
  }

  const handleFileSelect = useCallback(async (path: string, lineNumber?: number) => {
    // Check if file is already open
    const existingFile = openFiles.find(f => f.path === path)
    if (existingFile) {
      setActiveFile(path)

      // Navigate to line if specified
      if (lineNumber && editorRef.current) {
        // Use setTimeout to ensure editor is ready
        setTimeout(() => {
          if (editorRef.current) {
            editorRef.current.revealLineInCenter(lineNumber)
            editorRef.current.setPosition({ lineNumber, column: 1 })
          }
        }, 100)
      } else if (lineNumber) {
        // Store for later if editor not ready
        pendingLineNumberRef.current = lineNumber
      }

      // Reset markdown preview when switching files
      setShowMarkdownPreview(false)

      // On mobile, close file tree after selection
      if (isBelowSmBreakpoint) {
        setShowFileTree(false)
      }
      return
    }

    // Prevent duplicate loads from rapid clicks (race condition fix)
    if (loadingFilesRef.current.has(path)) {
      return
    }
    loadingFilesRef.current.add(path)

    try {
      // Load file content from backend
      const content = await loadFileContent(path)
      const name = path.split('/').pop() || path
      const language = getLanguageFromPath(path)

      const newFile: OpenFile = {
        path,
        name,
        content,
        language,
        isDirty: false
      }

      setOpenFiles(prev => [...prev, newFile])
      setActiveFile(path)

      // Store line number for navigation after editor mounts
      if (lineNumber) {
        pendingLineNumberRef.current = lineNumber
      }

      // On mobile, close file tree after selection
      if (isBelowSmBreakpoint) {
        setShowFileTree(false)
      }
    } catch (error) {
      // Log error but allow retry by removing from loading set
      logger.error('code-editor.file.open-error', {
        message: 'Failed to open file',
        path,
        error: error instanceof Error ? error.message : String(error)
      })
    } finally {
      loadingFilesRef.current.delete(path)
    }
  }, [openFiles, loadFileContent, isBelowSmBreakpoint])

  const handleCloseFile = useCallback((path: string) => {
    setOpenFiles(prev => prev.filter(f => f.path !== path))
    if (activeFile === path) {
      const remaining = openFiles.filter(f => f.path !== path)
      setActiveFile(remaining.length > 0 ? remaining[remaining.length - 1].path : null)
    }
  }, [activeFile, openFiles])

  // Open search as a "file" tab
  const handleOpenSearch = useCallback(() => {
    // Check if search tab already exists
    const existingSearch = openFiles.find(f => f.path === SEARCH_PATH)
    if (existingSearch) {
      setActiveFile(SEARCH_PATH)
      return
    }

    // Add search as a new tab
    const searchFile: OpenFile = {
      path: SEARCH_PATH,
      name: t('builder_code_search_tab', undefined, 'Search'),
      content: '',
      language: 'plaintext',
      isDirty: false,
      isSearch: true
    }

    setOpenFiles(prev => [...prev, searchFile])
    setActiveFile(SEARCH_PATH)

    // On mobile, close file tree after opening search
    if (isBelowSmBreakpoint) {
      setShowFileTree(false)
    }
  }, [openFiles, isBelowSmBreakpoint, t])

  // Expand search input in header and open search tab
  const expandSearch = useCallback(() => {
    setIsSearchExpanded(true)
    handleOpenSearch()
    setTimeout(() => searchInputRef.current?.focus(), 0)
  }, [handleOpenSearch])

  // Collapse search input and close search tab
  const collapseSearch = useCallback(() => {
    setIsSearchExpanded(false)
    setSearchState(undefined)
    setOpenFiles(prev => prev.filter(f => f.path !== SEARCH_PATH))
    if (activeFile === SEARCH_PATH) {
      const remainingFiles = openFiles.filter(f => f.path !== SEARCH_PATH)
      setActiveFile(remainingFiles.length > 0 ? remainingFiles[remainingFiles.length - 1].path : null)
    }
  }, [activeFile, openFiles])

  const handleEditorChange = useCallback((value: string | undefined) => {
    if (!activeFile || !value) return

    setOpenFiles(prev =>
      prev.map(f =>
        f.path === activeFile
          ? { ...f, content: value, isDirty: true }
          : f
      )
    )
  }, [activeFile])

  const handleSaveFile = useCallback(async (filePath?: string) => {
    const pathToSave = filePath || activeFile
    if (!pathToSave) return

    const fileToSave = openFiles.find(f => f.path === pathToSave)
    if (!fileToSave || !fileToSave.isDirty) return

    setSaving(pathToSave)

    try {
      // Save to backend
      const success = await saveFileContent(pathToSave, fileToSave.content)

      if (!success) {
        throw new Error('Save operation failed')
      }

      // Mark file as saved
      setOpenFiles(prev =>
        prev.map(f => f.path === pathToSave ? { ...f, isDirty: false } : f)
      )

      // Show save confirmation
      setRecentlySaved(pathToSave)
      setTimeout(() => setRecentlySaved(null), 2000)

      // Trigger preview refresh for certain file types
      const refreshPreviewExtensions = ['.tsx', '.jsx', '.ts', '.js', '.css', '.scss', '.html'];
      if (refreshPreviewExtensions.some(ext => pathToSave.endsWith(ext))) {
        window.postMessage({ type: 'file-saved', path: pathToSave }, window.location.origin)
      }

      logger.info('code-editor.file.saved', { message: 'File saved', path: pathToSave })
    } catch (error) {
      logger.error('code-editor.file.save-failed', { message: 'Failed to save file', error: error instanceof Error ? error.message : String(error) })
      alert(t('builder_code_alert_failed_save'))
    } finally {
      setSaving(null)
    }
  }, [activeFile, openFiles, saveFileContent, t])

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 's') {
        event.preventDefault()
        handleSaveFile()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleSaveFile])

  // Sync: collapse header when search tab is closed externally
  const isSearchTabOpen = useMemo(() => openFiles.some(f => f.path === SEARCH_PATH), [openFiles])
  useEffect(() => {
    if (!isSearchTabOpen && isSearchExpanded) {
      setIsSearchExpanded(false)
      setSearchState(undefined)
    }
  }, [isSearchTabOpen, isSearchExpanded])

  const currentFile = openFiles.find(f => f.path === activeFile)

  if (isLoading) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-1">
        <Spinner data-partial="gradientAiro" />
        <div className="text-sm">{t('builder_code_loading_files')}</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <div className="text-lg font-semibold mb-1">{t('builder_code_loading_project')}</div>
          <div className="text-sm mb-2">{error}</div>
          <button
            onClick={() => useFileTreeStore.getState().loadFiles(effectiveAppId)}
            disabled={isLoading}
            className="px-2 py-1 rounded-md disabled:opacity-50"
          >
            {isLoading ? t('builder_common_loading') : t('builder_code_retry_loading')}
          </button>
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="h-full w-full flex overflow-hidden relative border rounded-md bg-intents-ux-box-backgroundColor">
        {/* File Tree - Desktop: sidebar, Mobile: overlay */}
      {isBelowSmBreakpoint ? (
        // Mobile: Slide-in overlay
        <>
          {showFileTree && (
            <div
              className="absolute inset-0 bg-intents-ux-boxHighContrastOverlay-backgroundColor bg-opacity-4"
              onClick={() => setShowFileTree(false)}
            />
          )}
          <div className={clsx(
            "absolute left-0 top-0 bottom-0 w-[280px] bg-intents-ux-box-backgroundColor z-20 transform transition-transform duration-300 ease-in-out flex flex-col",
            showFileTree ? "translate-x-0" : "-translate-x-full"
          )}>
            <div className="flex items-center justify-between px-1.5 py-1 border-b">
              <Text.p className="ml-2 !font-semibold">{t('builder_common_files')}</Text.p>
              <div className="flex items-center gap-1">
                <Button
                  onClick={handleOpenSearch}
                  className="!p-0.5"
                  design="control"
                  data-testid="search-button"
                  title={t('builder_code_search_placeholder_code', undefined, 'Search')}
                  aria-label={t('builder_code_search_placeholder_code', undefined, 'Search')}
                  icon={<SearchIcon />}
                />
                <Button
                  onClick={() => setShowFileTree(false)}
                  className="!p-0.5"
                  design="control"
                  title={t('builder_common_close', undefined, 'Close')}
                  aria-label={t('builder_common_close', undefined, 'Close')}
                  icon={<XIcon />}
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto">
              <FileTree
                files={files}
                selectedFile={activeFile}
                onFileSelect={handleFileSelect}
                getFileStatus={getFileStatus}
              />
            </div>
          </div>
        </>
      ) : (
        // Desktop: Fixed sidebar
        <div className="border-r min-h-0 w-[250px] flex-shrink-0 flex flex-col">
          <div className="flex items-center justify-between px-2 border-b h-6 my-0.5">
            {/* Files title - hidden when search is expanded */}
            <Text.p
              className={clsx(
                "!font-semibold transition-opacity duration-200",
                isSearchExpanded ? "opacity-0 w-0 overflow-hidden" : "opacity-100"
              )}
            >
              {t('builder_common_files')}
            </Text.p>

            {/* Search button that transforms into input */}
            <div
              className={clsx(
                "flex items-center rounded-md bg-intents-ux-boxLowContrast-backgroundColor transition-[width] duration-300 ease-in-out",
                isSearchExpanded ? "w-full" : "w-[28px]"
              )}
            >
              <button
                onClick={!isSearchExpanded ? expandSearch : undefined}
                className={clsx(
                  "flex items-center justify-center flex-shrink-0 h-[28px] w-[28px]",
                  !isSearchExpanded && "cursor-pointer hover:opacity-80"
                )}
                aria-label={t('builder_code_search_placeholder_code', undefined, 'Search')}
                data-testid="search-button"
                type="button"
              >
                <SearchIcon className="w-2 h-2" />
              </button>
              <input
                ref={searchInputRef}
                type="text"
                value={searchState?.query ?? ''}
                onChange={(e) => {
                  const q = e.target.value
                  setSearchState(prev =>
                    prev
                      ? { ...prev, query: q }
                      : { query: q, fileResults: [], codeResults: [], totalCodeMatches: 0, truncated: false }
                  )
                }}
                onBlur={() => {
                  if (isSearchExpanded && !searchState?.query?.trim()) {
                    collapseSearch()
                  }
                }}
                onKeyDown={(e) => e.key === 'Escape' && collapseSearch()}
                placeholder={t('builder_code_search_placeholder_code', undefined, 'Search files and code')}
                className={clsx(
                  "bg-transparent outline-none text-sm h-[28px] transition-opacity duration-300 ease-in-out",
                  isSearchExpanded ? "flex-1 opacity-100 delay-150" : "w-0 opacity-0"
                )}
                aria-label={t('builder_code_search_placeholder_code', undefined, 'Search')}
                data-testid="search-input-header"
                tabIndex={isSearchExpanded ? 0 : -1}
              />
              {isSearchExpanded && searchState?.query && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchState(prev =>
                      prev
                        ? { ...prev, query: '' }
                        : { query: '', fileResults: [], codeResults: [], totalCodeMatches: 0, truncated: false }
                    )
                    searchInputRef.current?.focus()
                  }}
                  className="flex-shrink-0 p-1 mr-1 opacity-60 hover:opacity-100 transition-opacity"
                  aria-label={t('builder_common_clear', undefined, 'Clear')}
                >
                  <XIcon className="w-1.5 h-1.5" />
                </button>
              )}
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            <FileTree
              files={files}
              selectedFile={activeFile}
              onFileSelect={handleFileSelect}
              getFileStatus={getFileStatus}
            />
          </div>
        </div>
      )}

      {/* Editor Area */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden relative">
        {/* Tabs */}
        <div className="flex items-center border-b overflow-x-auto">
          {/* Mobile: File tree toggle button */}
          {isBelowSmBreakpoint && (
            <Button
              onClick={() => setShowFileTree(true)}
              className="!px-2 !py-0.5 flex-shrink-0"
              design="stateless"
              title={t('builder_common_show_files')}
              icon={<HamburgerIcon className="!size-2.5" />}
              text={t('builder_common_files')}
            />
          )}

          {openFiles.length > 0 && (
            <>
              {openFiles.map((file) => (
                <div
                  key={file.path}
                  className={clsx(
                    "relative flex items-center gap-0.5 pl-1 pr-0.5 py-1 border-b-4 border-r cursor-pointer text-sm whitespace-nowrap transition-opacity duration-200 flex-shrink-0", {
                      "opacity-50 border-b-transparent": activeFile !== file.path
                    }
                  )}
                  onClick={() => setActiveFile(file.path)}
                >
                  {file.isSearch ? <SearchIcon /> : <PageIcon />}
                  <span className={clsx(isBelowSmBreakpoint ? "max-w-[80px] truncate" : "")}>{file.name}</span>

                  {/* Save status indicators - not shown for search tab */}
                  {!file.isSearch && (saving === file.path || recentlySaved === file.path || file.isDirty) && (
                    <div className={clsx(
                      "absolute top-1 left-1 w-1 h-1 bg-intents-ux-feedbackHighContrastCritical-feedbackColor rounded-full", {
                        "bg-intents-ux-feedbackHighContrastSuccess-feedbackColor": recentlySaved === file.path,
                        "bg-intents-ux-feedbackHighContrastCritical-feedbackColor animate-pulse": saving === file.path,
                        "bg-intents-ux-feedbackHighContrastCritical-feedbackColor": file.isDirty,
                      }
                    )} />
                  )}

                  <Button
                    onClick={(e) => {
                      e.stopPropagation()
                      handleCloseFile(file.path)
                    }}
                    className="!p-0.5"
                    title={t('builder_code_close_file', undefined, 'Close file')}
                    aria-label={t('builder_code_close_file', undefined, 'Close file')}
                    design="control"
                    icon={<XIcon className="!size-1.5" />}
                  />
                </div>
              ))}

              {/* Save all button - hide on mobile if space is tight */}
              {openFiles.some(f => f.isDirty) && !isBelowSmBreakpoint && (
                <Button
                  onClick={() => {
                    openFiles.forEach(file => {
                      if (file.isDirty) handleSaveFile(file.path)
                    })
                  }}
                  icon={<DownloadIcon />}
                  text={t('builder_code_save_all')}
                  design="stateless"
                  size="sm"
                  className="!ml-0.5"
                />
              )}

              {/* Markdown preview toggle - show for .md files */}
              {currentFile && currentFile.language === 'markdown' && (
                <button
                  onClick={() => setShowMarkdownPreview(!showMarkdownPreview)}
                  className={clsx(
                    "ml-auto px-3 py-1 text-xs font-medium rounded transition-colors cursor-pointer",
                    showMarkdownPreview
                      ? "bg-blue-100 text-blue-700 hover:bg-blue-200"
                      : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                  )}
                >
                  {showMarkdownPreview ? 'Edit' : 'Preview'}
                </button>
              )}
            </>
          )}
        </div>

        {/* Editor */}
        <div className="flex-1 overflow-auto">
          {currentFile?.isSearch ? (
            // Search tab content
            <UnifiedSearch
              appId={effectiveAppId}
              files={files}
              onResultClick={(path, line) => {
                handleFileSelect(path, line)
              }}
              initialState={searchState}
              onStateChange={setSearchState}
            />
          ) : currentFile ? (
            <>
              {/* Conflict banner - show when file has unsaved changes and was modified by agent */}
              {currentFile && hasConflict(currentFile.path) && (
                <div className="bg-intents-ux-feedbackInfo-feedbackColor border-b border-intents-ux-feedbackInfo-feedbackColor px-2 py-1.5 flex items-center justify-between">
                  <div className="flex items-center gap-1">
                    <span className="text-sm font-medium">
                      {t('builder_code_updated_agent')}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      onClick={() => handleReloadFile(currentFile.path)}
                      size="sm"
                      design="primary"
                      text={t('builder_common_reload')}
                    />
                    <Button
                      onClick={() => handleKeepMyChanges(currentFile.path)}
                      size="sm"
                      design="secondary"
                      text={t('builder_code_keep_changes')}
                    />
                  </div>
                </div>
              )}

              {showMarkdownPreview && currentFile.language === 'markdown' ? (
                <div className="h-full p-6 overflow-auto bg-white">
                  <div className="max-w-4xl mx-auto markdown-preview">
                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                      {currentFile.content}
                    </ReactMarkdown>
                  </div>
                </div>
              ) : IMAGE_FILE_REGEX.test(currentFile.path) ? (
                // Image preview - content is a URL for binary files
                <div className="h-full flex items-center justify-center bg-gray-900 p-4">
                  <img /* eslint-disable-line @next/next/no-img-element */
                    src={currentFile.content}
                    alt={currentFile.name}
                    className="max-w-full max-h-full object-contain"
                  />
                </div>
              ) : currentFile.path.endsWith('.pdf') ? (
                // PDF preview - content is a URL for binary files
                <div className="h-full bg-gray-900">
                  <embed
                    src={currentFile.content}
                    type="application/pdf"
                    width="100%"
                    height="100%"
                  />
                </div>
              ) : VIDEO_FILE_REGEX.test(currentFile.path) ? (
                // Video preview - content is a URL for binary files
                <div className="h-full flex items-center justify-center bg-gray-900 p-4">
                  <video
                    src={currentFile.content}
                    controls
                    className="max-w-full max-h-full"
                  >
                    {t('builder_code_video_unsupported')}
                  </video>
                </div>
              ) : (
                <MonacoEditor
                  height="100%"
                  language={currentFile.language}
                  value={currentFile.content}
                  onChange={handleEditorChange}
                  beforeMount={handleEditorWillMount}
                  onMount={(editor) => {
                    editorRef.current = editor
                    // Navigate to pending line if any
                    if (pendingLineNumberRef.current) {
                      const lineNum = pendingLineNumberRef.current
                      editor.revealLineInCenter(lineNum)
                      editor.setPosition({ lineNumber: lineNum, column: 1 })
                      pendingLineNumberRef.current = null
                    }
                  }}
                  theme="vs-dark"
                  options={{
                    minimap: { enabled: false },
                    fontSize: 14,
                    lineNumbers: 'on',
                    roundedSelection: false,
                    scrollBeyondLastLine: false,
                    automaticLayout: true,
                    tabSize: 2,
                    insertSpaces: true,
                    wordWrap: 'on'
                  }}
                />
              )}
            </>
          ) : (
            <div className="h-full flex flex-col items-center justify-center">
              <PageIcon className="mx-auto mb-2" />
              <h3 className="text-lg font-medium">{t('builder_code_no_file_selected')}</h3>
              <p className="text-sm">{t('builder_code_select_file')}</p>
            </div>
          )}
        </div>
      </div>
    </div>
    </>
  )
}
