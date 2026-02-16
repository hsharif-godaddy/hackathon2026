'use client'

import clsx from 'clsx'
import { useState } from 'react'
import ChevronRightIcon from '@ux/icon/chevron-right'
import FolderIcon from '@ux/icon/folder'
import FolderOpenIcon from '@ux/icon/folder-open'
import PageIcon from '@ux/icon/page'

export interface FileItem {
  name: string
  type: 'file' | 'folder'
  path: string
  children?: FileItem[]
  extension?: string
}

export type FileStatus = 'streaming' | 'modified' | 'deleted' | 'normal'

interface FileTreeProps {
  files: FileItem[]
  selectedFile?: string | null
  onFileSelect: (path: string) => void
  getFileStatus?: (path: string) => FileStatus
}

export default function FileTree({ files, selectedFile, onFileSelect, getFileStatus }: FileTreeProps) {
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
    return PageIcon
  }

  const getDepthPadding = (depth: number) => `${depth * 12 + 8}px`

  const sortFileItems = (items: FileItem[]): FileItem[] => {
    return items.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === 'folder' ? -1 : 1
      }
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
    })
  }

  const getStatusClasses = (status: FileStatus): string => {
    switch (status) {
      case 'streaming':
        return 'bg-intents-ux-feedbackInfo-feedbackColor/20 border-l-2 border-intents-ux-feedbackInfo-feedbackColor animate-pulse'
      case 'modified':
        return 'bg-intents-ux-feedbackSuccess-feedbackColor/20 border-l-2 border-intents-ux-feedbackSuccess-feedbackColor'
      case 'deleted':
        return 'bg-intents-ux-feedbackCritical-feedbackColor/20 border-l-2 border-intents-ux-feedbackCritical-feedbackColor line-through opacity-50'
      default:
        return ''
    }
  }

  const hasBorder = (status: FileStatus): boolean => {
    return status === 'streaming' || status === 'modified' || status === 'deleted'
  }

  const renderFileItem = (item: FileItem, depth: number = 0): React.ReactNode => {
    const Icon = getFileIcon(item)
    const isExpanded = expandedFolders.has(item.path)
    const isSelected = selectedFile === item.path
    const status = getFileStatus ? getFileStatus(item.path) : 'normal'
    const statusClasses = getStatusClasses(status)
    const borderWidth = hasBorder(status) ? 2 : 0

    return (
      <div key={item.path}>
        <div
          className={clsx(
            "flex items-center pr-1 py-0.5 hover:bg-intents-ux-box-backgroundColor cursor-pointer text-sm relative",
            {
              "bg-intents-ux-box-backgroundColor text-intents-ux-box-foregroundColor": isSelected,
              "opacity-75": !isSelected && status === 'normal'
            },
            statusClasses
          )}
          style={{ paddingLeft: `${depth * 12 + 8 - borderWidth}px` }}
          onClick={() => {
            if (item.type === 'folder') {
              toggleFolder(item.path)
            } else {
              onFileSelect(item.path)
            }
          }}
        >
          {item.type === 'folder' && (
            <ChevronRightIcon className={clsx(
              "w-2 h-2 mr-0.5 transition-transform duration-100", {
                "rotate-90": isExpanded
              }
            )} />
          )}
          {item.type === 'file' && <div className="w-2 h-2 mr-0.5" />}
          <Icon className="w-2 h-2 mr-1" />
          <span className="truncate flex-1">{item.name}</span>

          {/* Status indicator badge */}
          {status !== 'normal' && (
            <div className={clsx(
              "ml-1 w-1.5 h-1.5 rounded-full flex-shrink-0",
              {
                "bg-intents-ux-feedbackInfo-feedbackColor animate-pulse": status === 'streaming',
                "bg-intents-ux-feedbackSuccess-feedbackColor": status === 'modified',
                "bg-intents-ux-feedbackCritical-feedbackColor": status === 'deleted'
              }
            )} />
          )}
        </div>

        {/* Render children if folder is expanded */}
        {item.type === 'folder' && isExpanded && item.children && (
          <div>
            {sortFileItems(item.children).map(child => renderFileItem(child, depth + 1))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 overflow-auto">
        <div className="py-1">
          {sortFileItems(files).map(file => renderFileItem(file))}
        </div>
      </div>
    </div>
  )
}
