'use client'

import { useState } from 'react'
import Chat from '@ux/icon/chat'
import type { SocialPostData } from '@/types/social-posts'
import { SocialPostList } from '../widgets/SocialPostList'
import ToolHeader from './ToolHeader'
import type { DefaultToolRendererProps } from './DefaultToolRenderer'

/**
 * Custom renderer for socialPostCreate tool
 *
 * Displays social media posts in a list with preview and edit capabilities
 */
export default function SocialPostCreateToolRenderer({
  toolName: _toolName,
  toolStatus,
  result
}: DefaultToolRendererProps) {

  const [isVisible] = useState(true)

  if (!isVisible) {
    return null
  }

  // Extract posts from result
  let posts: SocialPostData[] = []

  if (toolStatus === 'completed' && result && typeof result === 'object') {
    const resultObj = result as any

    if (resultObj.widget?.widgetData?.posts && Array.isArray(resultObj.widget.widgetData.posts)) {
      posts = resultObj.widget.widgetData.posts
    }
    // Fallback to direct posts array
    else if (resultObj.posts && Array.isArray(resultObj.posts)) {
      posts = resultObj.posts
    }
  }

  const hasPosts = posts.length > 0

  const displayName = (toolStatus === 'completed' && hasPosts)
    ? `Social Post Creation (${posts.length} options)`
    : 'Social Post Creation'

  return (
    <div>
      <ToolHeader
        icon={<Chat className="w-2 h-2" />}
        displayName={displayName}
        toolStatus={toolStatus}
        hasDetails={hasPosts}
      />

      {toolStatus === 'completed' && hasPosts && (
        <div className="max-h-full">
          {/* Helper message */}
          <div className="flex items-center gap-2 text-xs text-intents-ux-textSubtle-textColor my-1">
            <svg
              className="w-4 h-4"
              fill="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path d="M12 2C6.48 2 2 6.48 2 12c0 1.54.36 3 .97 4.29L2 22l5.71-.97C9 21.64 10.46 22 12 22c5.52 0 10-4.48 10-10S17.52 2 12 2zm0 18c-1.38 0-2.68-.3-3.86-.83l-.28-.14-2.86.49.49-2.86-.14-.28A7.95 7.95 0 014 12c0-4.41 3.59-8 8-8s8 3.59 8 8-3.59 8-8 8z"/>
              <path d="M7 9h10v2H7zm0 4h7v2H7z"/>
            </svg>
            <span className="text-sm"> Select a post below to preview and make changes, or ask below for different options</span>
          </div>
          <SocialPostList posts={posts} />
        </div>
      )}
    </div>
  )
}
