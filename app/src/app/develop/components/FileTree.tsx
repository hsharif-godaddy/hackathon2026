'use client'

import { useState } from 'react'
import {
  ChevronDownIcon,
  ChevronRightIcon,
  DocumentIcon,
  FolderIcon,
  FolderOpenIcon
} from '@heroicons/react/24/outline'

export interface FileItem {
  name: string
  type: 'file' | 'folder'
  path: string
  children?: FileItem[]
  extension?: string
}

interface FileTreeProps {
  files: FileItem[]
  selectedFile?: string | null
  onFileSelect: (path: string) => void
  onFileCreate?: (parentPath: string, name: string, type: 'file' | 'folder') => void
  onFileDelete?: (path: string) => void
}

export default function FileTree({ files, selectedFile, onFileSelect, onFileCreate, onFileDelete }: FileTreeProps) {
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set(['/']))

  const toggleFolder = (path: string) => {
    const newExpanded = new Set(expandedFolders)
    if (expandedFolders.has(path)) {
      newExpanded.delete(path)
    } else {
      newExpanded.add(path)
    }
    setExpandedFolders(newExpanded)
  }

  const getFileIcon = (item: FileItem) => {
    if (item.type === 'folder') {
      return expandedFolders.has(item.path) ? FolderOpenIcon : FolderIcon
    }
    
    // File icons based on extension
    const ext = item.extension?.toLowerCase()
    switch (ext) {
      case 'tsx':
      case 'jsx':
      case 'ts':
      case 'js':
      case 'json':
      case 'md':
      case 'css':
      case 'scss':
      case 'html':
      default:
        return DocumentIcon
    }
  }

  const getDepthPadding = (depth: number) => `${depth * 12 + 8}px`

  const renderFileItem = (item: FileItem, depth: number = 0): React.ReactNode => {
    const Icon = getFileIcon(item)
    const isExpanded = expandedFolders.has(item.path)
    const isSelected = selectedFile === item.path

    return (
      <div key={item.path}>
        <div
          className={`flex items-center px-2 py-1 hover:bg-gray-100 cursor-pointer text-sm ${
            isSelected ? 'bg-blue-50 text-blue-700' : 'text-gray-700'
          }`}
          style={{ paddingLeft: getDepthPadding(depth) }}
          onClick={() => {
            if (item.type === 'folder') {
              toggleFolder(item.path)
            } else {
              onFileSelect(item.path)
            }
          }}
        >
          {item.type === 'folder' && (
            isExpanded ? (
              <ChevronDownIcon className="w-4 h-4 mr-1 text-gray-400" />
            ) : (
              <ChevronRightIcon className="w-4 h-4 mr-1 text-gray-400" />
            )
          )}
          {item.type === 'file' && <div className="w-4 h-4 mr-1" />}
          
          <Icon className={`w-4 h-4 mr-2 ${
            item.type === 'folder' 
              ? isExpanded ? 'text-blue-500' : 'text-gray-500'
              : item.extension === 'tsx' || item.extension === 'jsx'
                ? 'text-blue-600'
                : item.extension === 'ts' || item.extension === 'js'
                ? 'text-yellow-600'
                : item.extension === 'json'
                ? 'text-green-600'
                : item.extension === 'css' || item.extension === 'scss'
                ? 'text-pink-600'
                : 'text-gray-500'
          }`} />
          
          <span className="truncate flex-1">{item.name}</span>
        </div>

        {/* Render children if folder is expanded */}
        {item.type === 'folder' && isExpanded && item.children && (
          <div>
            {item.children.map(child => renderFileItem(child, depth + 1))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="h-full overflow-auto bg-gray-50 border-r border-gray-200">
      <div className="p-3 border-b border-gray-200 bg-white">
        <h3 className="text-sm font-medium text-gray-900">Project Files</h3>
      </div>
      <div className="py-2">
        {files.map(file => renderFileItem(file))}
      </div>
    </div>
  )
}
