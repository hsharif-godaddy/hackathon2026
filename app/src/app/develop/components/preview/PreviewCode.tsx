'use client'

import { useState, useEffect, useCallback } from 'react'
import { appService } from '@/services/AppService'
import dynamic from 'next/dynamic'
import clsx from 'clsx'
import FileTree, { FileItem } from '@/app/develop/components/FileTree'
import { logger } from '@/lib/request-context'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
import Button from '@ux/button'
import DownloadIcon from '@ux/icon/download'
import Spinner from '@ux/spinner'
import PageIcon from '@ux/icon/page'
import XIcon from '@ux/icon/x'

// Dynamically import Monaco Editor to avoid SSR issues
const MonacoEditor = dynamic(() => import('@monaco-editor/react'), {
  ssr: false,
  loading: () => (
    <div className="h-full flex items-center justify-center text-white">
      <div className="text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 mx-auto mb-2"></div>
        <div className="text-sm">Loading editor...</div>
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
}

interface PreviewCodeProps {
  appId: string
}

export default function PreviewCode({ appId }: PreviewCodeProps) {
  const [files, setFiles] = useState<FileItem[]>([])
  const [openFiles, setOpenFiles] = useState<OpenFile[]>([])
  const [activeFile, setActiveFile] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState<string | null>(null)
  const [recentlySaved, setRecentlySaved] = useState<string | null>(null)

  const setHasUnsavedChanges = useDevelopPageStore((state) => state.setHasUnsavedChanges)

  // Load real files from backend
  const loadFiles = useCallback(async () => {
    if (!(appId)) return

    setIsLoading(true)
    setError(null)

    try {
      // First try to ensure the app is running
      await appService.ensureAppIsRunning(appId)

      // Small delay to let the app fully start
      await new Promise(resolve => setTimeout(resolve, 2000))

      const result = await appService.getFiles(appId, 5)

      if (result.entries && result.entries.length > 0) {
        const fileTree = buildFileTree(result.entries)
        setFiles(fileTree)
      } else {
        setError('Project is initializing... Please wait a moment and refresh.')
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      if (errorMessage.includes('500') || errorMessage.includes('Failed to start app')) {
        setError('Application is starting up. Please wait a moment and try again.')
      } else {
        setError(`Failed to load project files: ${errorMessage}`)
      }

      // Retry after a delay
      setTimeout(() => {
        loadFiles()
      }, 5000)
    } finally {
      setIsLoading(false)
    }
  }, [appId])

  // Convert flat file list to hierarchical tree structure
  const buildFileTree = (entries: Array<{name: string; isDirectory: boolean; path: string; depth: number}>): FileItem[] => {
    const tree: FileItem[] = []
    const pathMap = new Map<string, FileItem>()

    // Sort entries by path depth
    const sortedEntries = entries.sort((a, b) => a.depth - b.depth)

    for (const entry of sortedEntries) {
      const item: FileItem = {
        name: entry.name,
        type: entry.isDirectory ? 'folder' : 'file',
        path: entry.path,
        extension: entry.isDirectory ? undefined : entry.name.split('.').pop(),
        children: entry.isDirectory ? [] : undefined
      }

      pathMap.set(entry.path, item)

      // Find parent directory
      const parentPath = entry.path.split('/').slice(0, -1).join('/')
      const parent = parentPath ? pathMap.get(parentPath) : null

      if (parent && parent.children) {
        parent.children.push(item)
      } else {
        tree.push(item)
      }
    }

    return tree
  }

  // Load file content from backend
  const loadFileContent = useCallback(async (filePath: string): Promise<string> => {
    try {
      const result = await appService.readFile(appId, filePath)
      return result.content
    } catch (error) {
      logger.error('code-editor.file.load-error', { message: 'Error loading file content', error: error instanceof Error ? error.message : String(error) })
      return `// Error loading file: ${error instanceof Error ? error.message : 'Unknown error'}`
    }
  }, [appId])

  // Save file content to backend
  const saveFileContent = useCallback(async (filePath: string, content: string): Promise<boolean> => {
    try {
      const result = await appService.writeFile(appId, filePath, content, 'rewrite')
      return result.success || true
    } catch (error) {
      logger.error('code-editor.file.save-error', { message: 'Error saving file', error: error instanceof Error ? error.message : String(error) })
      return false
    }
  }, [appId])

  useEffect(() => {
    // Load real files from backend
    loadFiles()
  }, [loadFiles])

  // Notify parent about unsaved changes
  useEffect(() => {
    const hasUnsavedChanges = openFiles.some(file => file.isDirty)
    setHasUnsavedChanges(hasUnsavedChanges)
  }, [openFiles, setHasUnsavedChanges])

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

  const handleFileSelect = useCallback(async (path: string) => {
    // Check if file is already open
    const existingFile = openFiles.find(f => f.path === path)
    if (existingFile) {
      setActiveFile(path)
      return
    }

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
  }, [openFiles, loadFileContent])

  const handleCloseFile = useCallback((path: string) => {
    setOpenFiles(prev => prev.filter(f => f.path !== path))
    if (activeFile === path) {
      const remaining = openFiles.filter(f => f.path !== path)
      setActiveFile(remaining.length > 0 ? remaining[remaining.length - 1].path : null)
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
      alert('Failed to save file')
    } finally {
      setSaving(null)
    }
  }, [activeFile, openFiles, saveFileContent])

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

  const currentFile = openFiles.find(f => f.path === activeFile)

  if (isLoading) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-2">
        <Spinner data-partial="gradientAiro" />
        <div className="text-sm">Loading project files...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <div className="text-lg font-semibold mb-2">Project Loading</div>
          <div className="text-sm mb-4">{error}</div>
          <button
            onClick={loadFiles}
            disabled={isLoading}
            className="px-4 py-2 rounded-md disabled:opacity-50"
          >
            {isLoading ? 'Loading...' : 'Retry Loading Files'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full w-full grid grid-cols-[250px_1fr] overflow-hidden">
      <div className="border-r overflow-y-auto min-h-0">
        <div className="">
          <FileTree
            files={files}
            selectedFile={activeFile}
            onFileSelect={handleFileSelect}
          />
        </div>
      </div>

      {/* Editor Area */}
      <div className="flex flex-col w-full min-w-0 overflow-hidden">
        {/* Tabs */}
        {openFiles.length > 0 && (
          <div className="flex items-center border-b overflow-x-auto">
            {openFiles.map((file) => (
              <div
                key={file.path}
                className={clsx(
                  "relative flex items-center gap-1 pl-2 pr-1 py-1 border-b-4 border-r cursor-pointer text-sm whitespace-nowrap transition-opacity duration-200", {
                    "opacity-50 border-b-transparent": activeFile !== file.path
                  }
                )}
                onClick={() => setActiveFile(file.path)}
              >
                <PageIcon className="w-4 h-4" />
                <span>{file.name}</span>

                {/* Save status indicators */}
                {(saving === file.path || recentlySaved === file.path || file.isDirty) && (
                  <div className={clsx(
                    "absolute top-1.5 left-2 w-2 h-2 bg-intents-ux-feedbackHighContrastCritical-feedbackColor rounded-full", {
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
                  className="!p-1"
                  title="Close file"
                  design="control"
                >
                  <XIcon className="w-3 h-3" />
                </Button>
              </div>
            ))}

            {/* Save all button */}
            {openFiles.some(f => f.isDirty) && (
              <Button
                onClick={() => {
                  openFiles.forEach(file => {
                    if (file.isDirty) handleSaveFile(file.path)
                  })
                }}
                icon={<DownloadIcon className="!w-4 !h-4" />}
                text="Save All"
                design="control"
              />
            )}
          </div>
        )}

        {/* Editor */}
        <div className="flex-1">
          {currentFile ? (
            <MonacoEditor
              height="100%"
              language={currentFile.language}
              value={currentFile.content}
              onChange={handleEditorChange}
              beforeMount={handleEditorWillMount}
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
          ) : (
            <div className="h-full flex flex-col items-center justify-center">
              <PageIcon className="size-8 mx-auto mb-4" />
              <h3 className="text-lg font-medium">No file selected</h3>
              <p className="text-sm">Select a file to start editing</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
