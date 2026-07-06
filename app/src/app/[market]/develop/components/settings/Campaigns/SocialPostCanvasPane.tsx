'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Box from '@ux/box'
import Button from '@ux/button'
import Growl from '@ux/growl'
import ChevronLeftIcon from '@ux/icon/chevron-left'
import FacebookIcon from '@ux/icon/facebook'
import InstagramIcon from '@ux/icon/instagram'
import ThumbsUpIcon from '@ux/icon/thumbs-up'
import text from '@ux/text'

import { PostCardPreview } from '@/app/[market]/develop/components/social/post/preview/PostCardPreview'
import { useChatContext } from '@/contexts/ChatContext'
import { useScheduling } from '@/hooks/useScheduling'
import { useSiteAssociations } from '@/hooks/useSocial'
import { useTranslations } from '@/hooks/useTranslations'
import { logger } from '@/lib/request-context'
import { PLATFORM_TRANSFORMS, type PublishablePlatform } from '@/lib/social-platforms'
import { CONNECT_REQUEST_FROM_PUBLISH } from '@/types/social'
import { PublishTiming, SocialPostData } from '@/types/social-posts'
import { formatHashtags, formatPlatformName } from '@/utils/social/format'
import { getCharacterCount, getPlatformLimits } from '@/utils/social/validation'

interface PlatformContent {
  content: string
  callToAction: string
  hashtags: string[]
}

interface SocialPostCanvasPaneProps {
  post: SocialPostData
  appId: string
  onBack: () => void
  onPublish?: (post: SocialPostData) => void
  initialTiming?: PublishTiming
  initialDate?: string
  initialTime?: string
  initialPlatforms?: PublishablePlatform[]
}

export function SocialPostCanvasPane({
  post,
  appId,
  onBack,
  onPublish,
  initialTiming,
  initialDate,
  initialTime,
  initialPlatforms,
}: SocialPostCanvasPaneProps) {
  const t = useTranslations()
  const { sendMessage } = useChatContext()
  const { data: associationsData } = useSiteAssociations(appId)
  const scheduling = useScheduling({
    initialTiming,
    initialDate,
    initialTime,
  })

  const [images, setImages] = useState(post.images)
  const [isPublishing, setIsPublishing] = useState(false)
  const [platformFilter, setPlatformFilter] = useState<'all' | PublishablePlatform>('all')
  const [previewPlatform, setPreviewPlatform] = useState<PublishablePlatform>(initialPlatforms?.[0] || 'facebook')
  const [selectedPlatforms, setSelectedPlatforms] = useState<Set<PublishablePlatform>>(
    new Set(initialPlatforms || ['facebook', 'instagram']),
  )
  const [platformContent, setPlatformContent] = useState<Record<PublishablePlatform, PlatformContent>>(() => ({
    facebook: { content: post.content || '', callToAction: post.callToAction || '', hashtags: post.hashtags || [] },
    instagram: { content: post.content || '', callToAction: post.callToAction || '', hashtags: post.hashtags || [] },
  }))

  useEffect(() => {
    setImages(post.images)
    setPlatformContent({
      facebook: { content: post.content || '', callToAction: post.callToAction || '', hashtags: post.hashtags || [] },
      instagram: { content: post.content || '', callToAction: post.callToAction || '', hashtags: post.hashtags || [] },
    })
  }, [post.callToAction, post.content, post.hashtags, post.images])

  const platformValidation = useMemo(() => {
    const imageCount = images?.length || 0
    const facebookLimit = getPlatformLimits('facebook').maxCharacters
    const instagramLimit = getPlatformLimits('instagram').maxCharacters
    const results: Record<PublishablePlatform, { valid: boolean; charCount: number; maxChars: number; errors: string[] }> = {
      facebook: {
        valid: true,
        charCount: getCharacterCount({ ...post, ...platformContent.facebook }),
        maxChars: facebookLimit,
        errors: [],
      },
      instagram: {
        valid: true,
        charCount: getCharacterCount({ ...post, ...platformContent.instagram }),
        maxChars: instagramLimit,
        errors: [],
      },
    }
    if (results.facebook.charCount > facebookLimit) {
      results.facebook.valid = false
      results.facebook.errors.push(t('builder_social_validation_over_limit', { over: results.facebook.charCount - facebookLimit }))
    }
    if (results.instagram.charCount > instagramLimit) {
      results.instagram.valid = false
      results.instagram.errors.push(t('builder_social_validation_over_limit', { over: results.instagram.charCount - instagramLimit }))
    }
    if (imageCount === 0) {
      results.instagram.valid = false
      results.instagram.errors.push(t('builder_social_error_instagram_image_required'))
    }
    return results
  }, [images, platformContent, post, t])

  const validation = useMemo(() => {
    const selectedResults = Array.from(selectedPlatforms).map((platform) => platformValidation[platform])
    return {
      anyValid: selectedResults.length > 0 && selectedResults.some((result) => result.valid),
      selectedCount: selectedPlatforms.size,
    }
  }, [platformValidation, selectedPlatforms])

  const isPublishDisabled = useMemo(() => (
    isPublishing || !validation.anyValid || validation.selectedCount === 0
  ), [isPublishing, validation])

  const previewPost = useMemo(() => ({
    ...post,
    ...platformContent[previewPlatform],
    platform: previewPlatform,
    images,
  }), [images, platformContent, post, previewPlatform])

  const applyFilter = useCallback((filter: 'all' | PublishablePlatform) => {
    setPlatformFilter(filter)
    if (filter === 'all') {
      setPreviewPlatform('facebook')
      setSelectedPlatforms(new Set(['facebook', 'instagram']))
      return
    }
    setPreviewPlatform(filter)
    setSelectedPlatforms(new Set([filter]))
  }, [])

  const handlePublishClick = useCallback(async () => {
    setIsPublishing(true)
    try {
      const associations = associationsData?.associations || []
      const selectedPlatformsArray = Array.from(selectedPlatforms)
      if (selectedPlatformsArray.length === 0) return
      const firstPlatform = selectedPlatformsArray[0]
      const currentContent = platformContent[firstPlatform]
      const scheduledAt = scheduling.timing === PublishTiming.LATER && scheduling.date.length && scheduling.time
        ? new Date(`${scheduling.date[0]}T${scheduling.time}`)
        : undefined
      const platformData = selectedPlatformsArray.map((platform) => ({
        platform: PLATFORM_TRANSFORMS.toDisplay(platform) as PublishablePlatform,
        message: [platformContent[platform].content, platformContent[platform].callToAction, formatHashtags(platformContent[platform].hashtags)]
          .filter(Boolean)
          .join('\n\n'),
        imageUrls: images?.map((image) => image.url) || [],
        scheduledAt,
      }))
      const pendingPublish = {
        platforms: selectedPlatformsArray.map((platform) => PLATFORM_TRANSFORMS.toDisplay(platform) as PublishablePlatform),
        platformData,
        message: platformData[0]?.message ?? '',
        imageUrls: platformData[0]?.imageUrls ?? [],
        scheduledAt,
      }
      const notConnected = selectedPlatformsArray.filter(
        (platform) => !associations.some((association) => association.platform.toLowerCase() === platform.toLowerCase()),
      )
      if (notConnected.length === 0) {
        await sendMessage({
          content: scheduledAt
            ? `Schedule ${post.styleLabel} to ${selectedPlatformsArray.map((platform) => formatPlatformName(platform)).join(' and ')}`
            : `Post ${post.styleLabel} to ${selectedPlatformsArray.map((platform) => formatPlatformName(platform)).join(' and ')}`,
          isActionRequest: true,
          customContext: {
            type: 'social_publish_ready',
            data: {
              platforms: selectedPlatformsArray,
              connectionVerified: true,
              pendingPublish,
              postData: { ...post, ...currentContent, images },
            },
            persistence: 'save',
          },
        })
      } else {
        const firstMissing = notConnected[0]
        if (!firstMissing) return
        await sendMessage({
          content: `Connect to ${formatPlatformName(firstMissing)}`,
          isActionRequest: true,
          customContext: {
            type: CONNECT_REQUEST_FROM_PUBLISH,
            data: {
              platforms: notConnected,
              pendingPublish,
              postData: { ...post, ...currentContent, images },
            },
            persistence: 'save',
          },
        })
      }
      if (onPublish) onPublish({ ...post, ...currentContent, images, platform: firstPlatform })
      onBack()
    } catch (error) {
      logger.error('social-post-canvas.publish.failed', {
        appId,
        postId: post.id,
        error: error instanceof Error ? error.message : String(error),
      })
      Growl.addGrowlMessage({
        id: 'social-post-publish-failed',
        title: t('builder_social_publish_error', undefined, 'Unable to publish social post'),
        emphasis: 'critical',
        lifetime: 4000,
      })
    } finally {
      setIsPublishing(false)
    }
  }, [appId, associationsData, images, onBack, onPublish, platformContent, post, scheduling, selectedPlatforms, sendMessage, t])

  return (
    <div className="flex h-full flex-col gap-4 p-5">
      <Box orientation="horizontal" blockAlignChildren="spaceBetween" inlineAlignChildren="center" gap="md">
        <Box orientation="horizontal" inlineAlignChildren="center" gap="sm" className="min-w-0 flex-1">
          <Button
            design="inline"
            size="small"
            icon={<ChevronLeftIcon className="size-2.5 rtl:scale-x-[-1]" />}
            aria-label={t('builder_common_back')}
            onClick={onBack}
          />
          <text.span as="title" size={2} className="truncate">
            {t('builder_marketing_content_type_social_post', undefined, 'Social Post')}
          </text.span>
        </Box>
        <Box orientation="horizontal" gap="md">
          <Button
            design="primary"
            text={t('builder_social_schedule_title', undefined, 'Schedule')}
            size="sm"
            onClick={handlePublishClick}
            disabled={isPublishDisabled}
            className="cursor-pointer border-[#4F39F6]! bg-[#4F39F6]! text-white"
          />
        </Box>
      </Box>

      <div className="border-t pt-4" />

      <div className="w-full">
        <div className="mb-3 flex justify-center">
          <div className="inline-flex rounded-full bg-intents-ux-boxLowContrast-backgroundColor p-0.5">
            <button
              type="button"
              className={`cursor-pointer flex items-center gap-0.5 rounded-full border border-transparent px-1.5 py-0.5 text-sm ${platformFilter === 'all' ? 'border-intents-ux-box-borderColor bg-intents-ux-box-backgroundColor shadow-sm' : ''}`}
              onClick={() => applyFilter('all')}
            >
              <ThumbsUpIcon className="size-2" />
              <span>{t('builder_social_platform_all', undefined, 'All platforms')}</span>
            </button>
            <button
              type="button"
              className={`cursor-pointer flex items-center gap-0.5 rounded-full border border-transparent px-1.5 py-0.5 text-sm ${platformFilter === 'facebook' ? 'border-intents-ux-box-borderColor bg-intents-ux-box-backgroundColor shadow-sm' : ''}`}
              onClick={() => applyFilter('facebook')}
            >
              <FacebookIcon className="size-2" />
              <span>{t('builder_social_platform_facebook')}</span>
            </button>
            <button
              type="button"
              className={`cursor-pointer flex items-center gap-0.5 rounded-full border border-transparent px-1.5 py-0.5 text-sm ${platformFilter === 'instagram' ? 'border-intents-ux-box-borderColor bg-intents-ux-box-backgroundColor shadow-sm' : ''}`}
              onClick={() => applyFilter('instagram')}
            >
              <InstagramIcon className="size-2" />
              <span>{t('builder_social_platform_instagram')}</span>
            </button>
          </div>
        </div>

        <div className="mx-auto w-full max-w-[760px] rounded-lg bg-intents-ux-box-backgroundColor p-2">
          <PostCardPreview post={previewPost} hidePlatformIcon={platformFilter === 'all'} />
        </div>

        <text.p as="paragraph" className="mx-auto mt-1 max-w-[760px] px-0.5 text-center italic text-intents-ux-textSubtle-textColor" size={-1}>
          {t('builder_social_post_chat_edit_hint', undefined, 'Please use the chat to update and edit this post')}
        </text.p>
      </div>
    </div>
  )
}
