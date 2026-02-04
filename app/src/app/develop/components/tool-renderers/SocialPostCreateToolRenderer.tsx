'use client'

import { useCallback, useEffect, useRef,useState } from 'react'
import Chat from '@ux/icon/chat'

import type { DefaultToolRendererProps } from '@/app/develop/components/tool-renderers/DefaultToolRenderer'
import DefaultToolRenderer from '@/app/develop/components/tool-renderers/DefaultToolRenderer'
import ToolHeader from '@/app/develop/components/tool-renderers/ToolHeader'
import { SocialPostList } from '@/app/develop/components/widgets/SocialPostList'
import { useToolResultSync } from '@/hooks/useToolResultSync'
import { useTranslations } from '@/hooks/useTranslations'
import { useStreamingConversationStore } from '@/stores/useStreamingConversationStore'
import type { SocialPostData } from '@/types/social-posts'
import { SocialPostState } from '@/types/social-posts'
import { onPostPublished } from '@/utils/social'

/**
 * Custom renderer for socialPostCreate tool
 *
 * Displays social media posts in a list with preview and edit capabilities
 */
export default function SocialPostCreateToolRenderer({
  toolName: _toolName,
  toolStatus,
  result,
  toolId,
  conversationId,
  ...rest
}: DefaultToolRendererProps) {
  const t = useTranslations()
  const currentAppId = useStreamingConversationStore(state => state.currentAppId)

  const [isVisible] = useState(true)

  const [posts, setPosts] = useState<SocialPostData[]>([])
  const initializedRef = useRef(false)

  // Initialize posts from result when it arrives
  useEffect(() => {
    if (initializedRef.current || toolStatus !== 'completed' || !result || typeof result !== 'object') return

    const resultObj = result as any
    let postsFromResult: SocialPostData[] = []

    if (resultObj.widget?.widgetData?.posts && Array.isArray(resultObj.widget.widgetData.posts)) {
      postsFromResult = resultObj.widget.widgetData.posts
    } else if (resultObj.posts && Array.isArray(resultObj.posts)) {
      postsFromResult = resultObj.posts
    }

    if (postsFromResult.length > 0) {
      initializedRef.current = true
      setPosts(postsFromResult)
    }
  }, [toolStatus, result])

  // Listen for post published events to mark posts as published
  useEffect(() => {
    const unsubscribe = onPostPublished((postId) => {
      setPosts(prevPosts =>
        prevPosts.map(p =>
          p.id === postId
            ? { ...p, publishedState: SocialPostState.PUBLISHED }
            : p
        )
      )
    })
    return unsubscribe
  }, [])

  // Handle post edits from modal (updates posts state for history sync)
  const handlePostUpdate = useCallback((updatedPost: SocialPostData) => {
    setPosts(prevPosts =>
      prevPosts.map(p => p.id === updatedPost.id ? updatedPost : p)
    )
  }, [])

  // Sync updated posts back to tool result for history preservation
  useToolResultSync(
    {
      widget: {
        widgetData: {
          posts
        }
      }
    },
    { conversationId: conversationId || null, toolId: toolId || '', appId: currentAppId || '' },
    {
      debounceMs: 200,
      enabled: toolStatus === 'completed' && posts.length > 0 && !!conversationId && !!toolId && !!currentAppId
    }
  )


  if (!isVisible) {
    return null
  }

  const hasPosts = posts.length > 0

  // On error or no posts generated, fall back to DefaultToolRenderer to show error details
  if (toolStatus === 'error' || (toolStatus === 'completed' && !hasPosts)) {
    return <DefaultToolRenderer toolName={_toolName} toolStatus={toolStatus} result={result} toolId={toolId} conversationId={conversationId} {...rest} />
  }

  const displayName = (toolStatus === 'completed' && hasPosts)
    ? `${t('builder_tools_social_create_title')} (${posts.length} ${t('builder_common_options')})`
    : t('builder_tools_social_create_title')

  return (
    <div>
      <ToolHeader
        icon={<Chat className="w-2 h-2" />}
        displayName={displayName}
        toolStatus={toolStatus}
        hasDetails={hasPosts}
        onOpenModal={undefined}
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
            <span className="text-sm"> {t('builder_tools_social_create_svg_text')}</span>
          </div>
          <SocialPostList posts={posts} appId={currentAppId || undefined} onPostUpdate={handlePostUpdate} />
        </div>
      )}
    </div>
  )
}
