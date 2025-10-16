'use client'

import { useState } from 'react'
import clsx from 'clsx'
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

interface FileTreeProps {
  files: FileItem[]
  selectedFile?: string | null
  onFileSelect: (path: string) => void
}

export default function FileTree({ files, selectedFile, onFileSelect }: FileTreeProps) {
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

  const renderFileItem = (item: FileItem, depth: number = 0): React.ReactNode => {
    const Icon = getFileIcon(item)
    const isExpanded = expandedFolders.has(item.path)
    const isSelected = selectedFile === item.path

    return (
      <div key={item.path}>
        <div
          className={clsx(
            "flex items-center pr-2 py-1 hover:bg-intents-ux-box-backgroundColor cursor-pointer text-sm",
            {
              "bg-intents-ux-box-backgroundColor text-intents-ux-box-foregroundColor": isSelected,
              "opacity-75": !isSelected
            }
          )}
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
            <ChevronRightIcon className={clsx(
              "w-4 h-4 mr-1 transition-transform duration-100", {
                "rotate-90": isExpanded
              }
            )} />
          )}
          {item.type === 'file' && <div className="w-4 h-4 mr-1" />}
          <Icon className="w-4 h-4 mr-2" />
          <span className="truncate flex-1">{item.name}</span>
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
    <div className="h-full overflow-auto ">
      <div className="py-2">
        {sortFileItems(files).map(file => renderFileItem(file))}
      </div>
    </div>
  )
}
