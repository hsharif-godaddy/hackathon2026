/* eslint-disable @next/next/no-img-element */
'use client'

import clsx from 'clsx'
import { memo, useMemo } from 'react'
import AlertIcon from '@ux/icon/alert'
import FacebookIcon from '@ux/icon/facebook'
import InstagramIcon from '@ux/icon/instagram'
import { text } from '@ux/text'

import { useAppImageUrl } from '@/app/[market]/develop/hooks/useAppImageUrl'
import { useTranslations } from '@/hooks/useTranslations'
import { SocialPlatform } from '@/types/social'
import { SocialPostData } from '@/types/social-posts'
import { formatHashtags } from '@/utils/social/format'

type SelectablePiece = 'content' | 'hashtags' | 'images'

interface PostCardPreviewProps {
  post: SocialPostData
  hidePlatformIcon?: boolean
  isSelectionMode?: boolean
  onSelectPiece?: (piece: SelectablePiece) => void
  selectedPiece?: SelectablePiece
}

const PlatformIcon = {
  facebook: <FacebookIcon className="h-4 w-4" />,
  instagram: <InstagramIcon className="h-4 w-4" />,
}

export const PostCardPreview = memo(function PostCardPreview({
  hidePlatformIcon,
  post,
  isSelectionMode,
  onSelectPiece,
  selectedPiece,
}: PostCardPreviewProps) {
  const t = useTranslations()
  const imageUrl = useAppImageUrl(post.images?.[0]?.url)
  const imagesRequested = !!post.imagePrompt || (post.images?.length || 0) > 0
  const previewDate = useMemo(() => {
    const now = new Date()
    return `${now.toLocaleString('default', { month: 'long' })} ${now.getDate()}, ${now.getFullYear()}`
  }, [])

  return (
    <div className="shadow-xs relative mx-auto flex h-auto w-full flex-col rounded-md border border-intents-ux-border-borderColor pb-1">
      <div className="order-1 flex items-center justify-between px-2 py-1">
        <div className="flex items-center gap-1">
          <div className="flex h-6 w-6 items-center justify-center rounded-full border">
            {hidePlatformIcon ? null : PlatformIcon[post.platform || 'facebook']}
          </div>
          <div className="flex flex-col">
            <text.span as="paragraph" size={-1}>
              {post.name || t('builder_marketing_content_type_social_post', undefined, 'Social Post')}
            </text.span>
            <text.span size={-2} emphasis="passive" as="paragraph">
              {previewDate}
            </text.span>
          </div>
        </div>
      </div>

      <div className={clsx('order-2 mx-1 mb-1 px-2', post.platform === SocialPlatform.INSTAGRAM ? 'order-3' : 'order-2')}>
        <div
          className={clsx('rounded-sm text-sm', isSelectionMode ? 'cursor-pointer border p-0.75' : '', selectedPiece === 'content' ? 'border-intents-ux-primary-borderColor' : 'border-transparent')}
          onClick={() => isSelectionMode && onSelectPiece?.('content')}
        >
          {post.content}{' '}
          {post.callToAction && <span className="font-medium">{post.callToAction} </span>}
        </div>
        <div
          className={clsx('mt-0.5 rounded-sm text-sm text-[#145FA9]', isSelectionMode ? 'cursor-pointer border p-0.75' : '', selectedPiece === 'hashtags' ? 'border-intents-ux-primary-borderColor' : 'border-transparent')}
          onClick={() => isSelectionMode && onSelectPiece?.('hashtags')}
        >
          {post.hashtags?.length ? formatHashtags(post.hashtags) : '#hashtags'}
        </div>
      </div>

      {imagesRequested && (
        <div
          className={clsx('mx-0.5 mt-0.5 flex items-center justify-center', post.platform === SocialPlatform.INSTAGRAM ? 'order-2 mb-1' : 'order-3', isSelectionMode ? 'cursor-pointer rounded-sm border p-0.75' : '', selectedPiece === 'images' ? 'border-intents-ux-primary-borderColor' : 'border-transparent')}
          onClick={() => isSelectionMode && onSelectPiece?.('images')}
        >
          {imageUrl ? (
            <img
              src={imageUrl}
              alt={post.images?.[0]?.prompt || 'Post image'}
              className="h-[300px] w-full object-cover"
            />
          ) : (
            <div className="flex h-[300px] w-full flex-col items-center justify-center gap-1 border-2 border-dashed border-intents-ux-border-borderColor bg-intents-ux-boxLowContrast-backgroundColor">
              <AlertIcon className="h-6 w-6 text-intents-ux-critical-textColor" />
              <span className="text-xs text-intents-ux-textSubtle-textColor">{t('builder_widgets_postcard_error')}</span>
            </div>
          )}
        </div>
      )}

    </div>
  )
})
