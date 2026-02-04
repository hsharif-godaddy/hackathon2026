import { create } from 'zustand'

export type FileOperationType = 'create' | 'modify' | 'delete'

export interface FileChange {
  path: string
  operation: FileOperationType
  timestamp: number
  streaming: boolean // true while agent is still working on this file
}

interface CodeSyncStore {
  // Map of file path -> change metadata
  fileChanges: Map<string, FileChange>

  // Files with unsaved changes that need reload confirmation
  conflictingFiles: Set<string>

  // Track which files are currently being modified (during streaming)
  streamingFiles: Set<string>

  // Version counter that increments on any change - used for React reactivity
  changeVersion: number

  // Actions
  markFileStreaming: (path: string, operation: FileOperationType) => void
  markFileComplete: (path: string, operation: FileOperationType) => void
  addConflict: (path: string) => void
  resolveConflict: (path: string) => void
  clearFileChange: (path: string) => void
  clearAllChanges: () => void
  getFileChange: (path: string) => FileChange | undefined
  isFileStreaming: (path: string) => boolean
  hasConflict: (path: string) => boolean
}

export const useCodeSyncStore = create<CodeSyncStore>((set, get) => ({
  fileChanges: new Map(),
  conflictingFiles: new Set(),
  streamingFiles: new Set(),
  changeVersion: 0,

  markFileStreaming: (path: string, operation: FileOperationType) => {
    set((state) => {
      const newChanges = new Map(state.fileChanges)
      const newStreaming = new Set(state.streamingFiles)

      newChanges.set(path, {
        path,
        operation,
        timestamp: Date.now(),
        streaming: true
      })
      newStreaming.add(path)

      return {
        fileChanges: newChanges,
        streamingFiles: newStreaming,
        changeVersion: state.changeVersion + 1
      }
    })
  },

  markFileComplete: (path: string, operation: FileOperationType) => {
    set((state) => {
      const newChanges = new Map(state.fileChanges)
      const newStreaming = new Set(state.streamingFiles)

      newChanges.set(path, {
        path,
        operation,
        timestamp: Date.now(),
        streaming: false
      })
      newStreaming.delete(path)

      return {
        fileChanges: newChanges,
        streamingFiles: newStreaming,
        changeVersion: state.changeVersion + 1
      }
    })
  },

  addConflict: (path: string) => {
    set((state) => ({
      conflictingFiles: new Set(state.conflictingFiles).add(path)
    }))
  },

  resolveConflict: (path: string) => {
    set((state) => {
      const newConflicts = new Set(state.conflictingFiles)
      newConflicts.delete(path)
      return { conflictingFiles: newConflicts }
    })
  },

  clearFileChange: (path: string) => {
    set((state) => {
      const newChanges = new Map(state.fileChanges)
      newChanges.delete(path)
      return {
        fileChanges: newChanges,
        changeVersion: state.changeVersion + 1
      }
    })
  },

  clearAllChanges: () => {
    set((state) => ({
      fileChanges: new Map(),
      conflictingFiles: new Set(),
      streamingFiles: new Set(),
      changeVersion: state.changeVersion + 1
    }))
  },

  getFileChange: (path: string) => {
    return get().fileChanges.get(path)
  },

  isFileStreaming: (path: string) => {
    return get().streamingFiles.has(path)
  },

  hasConflict: (path: string) => {
    return get().conflictingFiles.has(path)
  }
}))
