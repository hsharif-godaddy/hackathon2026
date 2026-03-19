'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Chat from '@ux/icon/chat'

import { PostList } from '@/app/develop/components/social/post/PostList'
import type { DefaultToolRendererProps } from '@/app/develop/components/tool-renderers/DefaultToolRenderer'
import DefaultToolRenderer from '@/app/develop/components/tool-renderers/DefaultToolRenderer'
import ToolHeader from '@/app/develop/components/tool-renderers/ToolHeader'
import { useSiteAssociations } from '@/hooks/useSocial'
import { useToolResultSync } from '@/hooks/useToolResultSync'
import { useTranslations } from '@/hooks/useTranslations'
import { useStreamingConversationStore } from '@/stores/useStreamingConversationStore'
import type { SocialPostData } from '@/types/social-posts'
import { onPostPublished } from '@/utils/social/events'

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
  const [scheduledDate, setScheduledDate] = useState<string | undefined>()
  const [scheduledTime, setScheduledTime] = useState<string | undefined>()
  const initializedRef = useRef(false)

  // Fetch site associations to detect existing connections for publishing
  const { data: associationsData } = useSiteAssociations(
    currentAppId || '',
    true
  )

  // Sync to conversation history
  const syncResult = useToolResultSync({
    conversationId: conversationId || null,
    toolId: toolId || '',
    appId: currentAppId || ''
  })

  // Initialize posts from result when it arrives
  useEffect(() => {
    if (initializedRef.current || toolStatus !== 'completed' || !result || typeof result !== 'object') return

    const resultObj = result as any
    let postsFromResult: SocialPostData[] = []

    if (resultObj.widget?.widgetData?.posts && Array.isArray(resultObj.widget.widgetData.posts)) {
      postsFromResult = resultObj.widget.widgetData.posts

      // Extract scheduling information from widget data
      if (resultObj.widget.widgetData.scheduledDate) {
        setScheduledDate(resultObj.widget.widgetData.scheduledDate)
      }
      if (resultObj.widget.widgetData.scheduledTime) {
        setScheduledTime(resultObj.widget.widgetData.scheduledTime)
      }
    } else if (resultObj.posts && Array.isArray(resultObj.posts)) {
      postsFromResult = resultObj.posts

      // Extract scheduling information from top-level result
      if (resultObj.scheduledDate) {
        setScheduledDate(resultObj.scheduledDate)
      }
      if (resultObj.scheduledTime) {
        setScheduledTime(resultObj.scheduledTime)
      }
    }

    if (postsFromResult.length > 0) {
      initializedRef.current = true
      setPosts(postsFromResult)
    }
  }, [toolStatus, result])

  // Listen for post published events to mark posts as published/scheduled and sync to history
  useEffect(() => {
    const unsubscribe = onPostPublished((postId, state) => {
      setPosts(prevPosts => {
        const newPosts = prevPosts.map(p =>
          p.id === postId
            ? { ...p, publishedState: state }
            : p
        )
        syncResult({ widget: { widgetData: { posts: newPosts } } })
        return newPosts
      })
    })
    return unsubscribe
  }, [syncResult])

  // Handle post edits from modal - sync immediately after edit
  const handlePostUpdate = useCallback((updatedPost: SocialPostData) => {
    setPosts(prevPosts => {
      const newPosts = prevPosts.map(p => p.id === updatedPost.id ? updatedPost : p)
      syncResult({ widget: { widgetData: { posts: newPosts } } })
      return newPosts
    })
  }, [syncResult])


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
              <path d="M12 2C6.48 2 2 6.48 2 12c0 1.54.36 3 .97 4.29L2 22l5.71-.97C9 21.64 10.46 22 12 22c5.52 0 10-4.48 10-10S17.52 2 12 2zm0 18c-1.38 0-2.68-.3-3.86-.83l-.28-.14-2.86.49.49-2.86-.14-.28A7.95 7.95 0 014 12c0-4.41 3.59-8 8-8s8 3.59 8 8-3.59 8-8 8z" />
              <path d="M7 9h10v2H7zm0 4h7v2H7z" />
            </svg>
            <span className="text-sm"> {t('builder_tools_social_create_svg_text')}</span>
          </div>
          <PostList
            posts={posts}
            appId={currentAppId || undefined}
            onPostUpdate={handlePostUpdate}
            associations={associationsData?.associations || []}
            initialScheduledDate={scheduledDate}
            initialScheduledTime={scheduledTime}
          />
        </div>
      )}
    </div>
  )
}
