/* eslint-disable react/display-name */
/* eslint-disable @next/next/no-img-element */
'use client'

import clsx from 'clsx'
import { memo,useCallback, useEffect, useMemo, useState } from 'react'
import AlertIcon from '@ux/icon/alert'
import EditIcon from '@ux/icon/edit'
import ImageIcon from '@ux/icon/image'
import text from '@ux/text'

import { useTranslations } from '@/hooks/useTranslations'
import { SocialPostData } from '@/types/social-posts'
import { SocialPostModal } from './SocialPostModal'

interface PostImageThumbnailProps {
  post: SocialPostData
}

const PostImageThumbnail = memo(({ post }: PostImageThumbnailProps) => {
  const t = useTranslations();

  const imagesRequested = !!(post as any).imagePrompt || (post.images && post.images.length > 0)
  const hasValidImage = post.images && post.images.length > 0

  const containerClasses = clsx(
    'flex-shrink-0 w-10 h-10 rounded-sm overflow-hidden flex items-center justify-center',
    !hasValidImage && 'border-2 border-dashed border-intents-ux-border-borderColor bg-intents-ux-boxLowContrast-backgroundColor'
  )

  if (hasValidImage) {
    const imageUrl = post.images[0].url
    return (
      <div className={containerClasses}>
        <img src={imageUrl} alt={post.styleLabel} className="h-full w-full object-cover" />
      </div>
    )
  }

  if (imagesRequested) {
    return (
      <div className={containerClasses}>
        <div className="flex flex-col items-center justify-center gap-1">
          <AlertIcon className="w-3 h-3 text-intents-ux-critical-textColor" />
          <span className="text-[10px] text-intents-ux-textSubtle-textColor">{t('builder_common_error')}</span>
        </div>
      </div>
    )
  }

  return (
    <div className={containerClasses}>
      <div className="flex flex-col items-center justify-center gap-1">
        <ImageIcon className="w-3 h-3 text-intents-ux-textSubtle-textColor" />
        <span className="text-[10px] text-intents-ux-textSubtle-textColor">{t('builder_common_no_image')}</span>
      </div>
    </div>
  )
})

interface PostContentPreviewProps {
  content: string
}

const PostContentPreview = memo(({ content }: PostContentPreviewProps) => (
  <text.span as="paragraph" size={-2} className="text-xs md:text-sm line-clamp-3">
    {content.substring(0, 300)}{content.length > 300 ? '...' : ''}
  </text.span>
))

interface PostListItemProps {
  post: SocialPostData
  onClick: (post: SocialPostData) => void
}

const PostListItem = memo(({ post, onClick }: PostListItemProps) => (
  <div
    className="border rounded-sm hover:bg-intents-ux-boxLowContrast-backgroundColor hover:border-intents-ux-border-borderColorHover transition-all cursor-pointer relative group"
    onClick={() => onClick(post)}
  >
    <div className="absolute mt-3 bottom-1 right-1 block">
      <EditIcon className="w-2 h-2 text-gray-400" />
    </div>

    <div className="p-1">
      <div className="flex gap-1.5 items-start">
        <PostImageThumbnail post={post} />

        <div className="flex-grow min-w-0">
          <PostContentPreview content={post.content}/>
        </div>
      </div>
    </div>
  </div>
))

interface SocialPostListProps {
  posts?: SocialPostData[]
}

/**
 * Social Post List Widget
 *
 * Displays social posts in a list view with preview modal for editing
 *
 * @param posts - Array of social posts to display
 * @returns List widget component with post management interface
 */
export function SocialPostList({
  posts: propsPosts = []
}: SocialPostListProps = {}) {

  const [localPosts, setLocalPosts] = useState<SocialPostData[]>([])
  const [selectedPost, setSelectedPost] = useState<SocialPostData | null>(null)

  // Initialize local posts when props posts changes
  useEffect(() => {
    if (propsPosts) {
      setLocalPosts(propsPosts)
    }
  }, [propsPosts])

  const posts = useMemo(() => {
    return localPosts.length > 0 ? localPosts : propsPosts
  }, [propsPosts, localPosts]);

  const handlePostClick = useCallback((post: SocialPostData) => {
    setSelectedPost(post)
  }, [])

  const handleSaveEdit = useCallback((updatedPost: SocialPostData) => {
    setLocalPosts(prevPosts =>
      prevPosts.map(p => p.id === updatedPost.id ? updatedPost : p)
    )
  }, [])

  return (
    <>
      <div className="flex flex-col w-full gap-1.5 max-w-4xl mx-auto py-1">
        <div className="rounded-sm shadow-xs border">
          <div className="px-1 pb-2 mt-1">
            <div className="max-h-[500px] overflow-y-auto">
              <div className="space-y-1.5">
                {posts.map((post) => (
                  <PostListItem
                    key={post.id}
                    post={post}
                    onClick={handlePostClick}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {selectedPost && (
        <SocialPostModal
          post={selectedPost}
          onClose={() => setSelectedPost(null)}
          onSave={handleSaveEdit}
        />
      )}
    </>
  )
}
