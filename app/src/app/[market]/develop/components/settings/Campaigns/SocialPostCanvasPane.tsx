'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Box from '@ux/box'
import Button from '@ux/button'
import DateInput from '@ux/date-input'
import Growl from '@ux/growl'
import ChevronLeftIcon from '@ux/icon/chevron-left'
import FacebookIcon from '@ux/icon/facebook'
import InstagramIcon from '@ux/icon/instagram'
import ThumbsUpIcon from '@ux/icon/thumbs-up'
import Modal from '@ux/modal'
import text from '@ux/text'
import TimePicker from '@ux/time-picker'

import { PostCardPreview } from '@/app/[market]/develop/components/social/post/preview/PostCardPreview'
import { useChatContext } from '@/contexts/ChatContext'
import { useScheduling } from '@/hooks/useScheduling'
import { useSiteAssociations } from '@/hooks/useSocial'
import { useTranslations } from '@/hooks/useTranslations'
import { useUserLocale } from '@/hooks/useUserLocale'
import { logger } from '@/lib/request-context'
import {
  DEFAULT_SCHEDULING_PLATFORMS,
  isSchedulingEnabled,
  PLATFORM_TRANSFORMS,
  type PublishablePlatform,
} from '@/lib/social-platforms'
import { CONNECT_REQUEST_FROM_PUBLISH, SocialPlatform } from '@/types/social'
import { PublishTiming, SocialPostData } from '@/types/social-posts'
import { formatHashtags, formatPlatformName } from '@/utils/social/format'
import { createLocalDateTime, getMaximumScheduleTime } from '@/utils/social/scheduling'
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

function getInitialSelectedPlatforms(initialPlatforms?: PublishablePlatform[]): PublishablePlatform[] {
  if (!initialPlatforms?.length) {
    return DEFAULT_SCHEDULING_PLATFORMS
  }
  const filteredPlatforms = initialPlatforms.filter(isSchedulingEnabled)
  return filteredPlatforms.length ? filteredPlatforms : DEFAULT_SCHEDULING_PLATFORMS
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
  const locale = useUserLocale()
  const { sendMessage } = useChatContext()
  const { data: associationsData } = useSiteAssociations(appId)
  const isCampaignPost = Boolean(post.campaignId || post.campaignContentId)
  const initialSelectedPlatforms = getInitialSelectedPlatforms(initialPlatforms)
  const scheduling = useScheduling({
    initialTiming: initialTiming ?? PublishTiming.LATER,
    initialDate,
    initialTime,
  })

  const [images, setImages] = useState(post.images)
  const [isPublishing, setIsPublishing] = useState(false)
  const [previewTab, setPreviewTab] = useState<'all' | PublishablePlatform>('all')
  const [previewPlatform, setPreviewPlatform] = useState<PublishablePlatform>(SocialPlatform.FACEBOOK)
  const [isScheduleModalOpen, setIsScheduleModalOpen] = useState(false)
  const [selectedPlatforms, setSelectedPlatforms] = useState<Set<PublishablePlatform>>(
    new Set(initialSelectedPlatforms),
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
    const facebookLimit = getPlatformLimits(SocialPlatform.FACEBOOK).maxCharacters
    const instagramLimit = getPlatformLimits(SocialPlatform.INSTAGRAM).maxCharacters
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

  const isBasePublishDisabled = useMemo(() => (
    isPublishing
    || !validation.anyValid
    || validation.selectedCount === 0
  ), [isPublishing, validation])

  const isScheduleDisabled = useMemo(() => (
    isBasePublishDisabled || !scheduling.isValid
  ), [isBasePublishDisabled, scheduling.isValid])

  const previewPost = useMemo<SocialPostData>(() => ({
    ...post,
    ...platformContent[previewPlatform],
    platform: previewPlatform,
    images,
  }), [images, platformContent, post, previewPlatform])

  const timezoneDisplay = useMemo(() => {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
    const abbreviation = new Intl.DateTimeFormat(locale, { timeZoneName: 'short' })
      .formatToParts(new Date())
      .find((part) => part.type === 'timeZoneName')?.value
    return abbreviation ? `${timeZone} (${abbreviation})` : timeZone
  }, [locale])

  const shouldDisableDate = useCallback((dateValue: string) => {
    const selectedDate = new Date(dateValue)
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    return selectedDate < today || selectedDate > getMaximumScheduleTime()
  }, [])

  const executePublish = useCallback(async (timing: PublishTiming) => {
    setIsPublishing(true)
    try {
      const associations = associationsData?.associations || []
      const selectedPlatformsArray = Array.from(selectedPlatforms)
      if (selectedPlatformsArray.length === 0) {
        logger.warn('social-post-canvas.publish.no-platforms-selected', {
          appId,
          postId: post.id,
        })
        return
      }
      const firstPlatform = selectedPlatformsArray[0]
      const currentContent = platformContent[firstPlatform]
      const scheduledAt = timing === PublishTiming.LATER && scheduling.date.length && scheduling.time
        ? createLocalDateTime(scheduling.date[0], scheduling.time)
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
        if (!firstMissing) {
          logger.warn('social-post-canvas.publish.missing-platform-resolution', {
            appId,
            postId: post.id,
            selectedPlatforms: selectedPlatformsArray,
            unresolvedPlatforms: notConnected,
          })
          return
        }
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
        title: t('builder_social_publish_error'),
        emphasis: 'critical',
        lifetime: 4000,
      })
    } finally {
      setIsPublishing(false)
    }
  }, [appId, associationsData, images, onBack, onPublish, platformContent, post, scheduling.date, scheduling.time, selectedPlatforms, sendMessage, t])

  const handlePublishNowClick = useCallback(async () => {
    await executePublish(PublishTiming.NOW)
  }, [executePublish])

  const handleScheduleClick = useCallback(async () => {
    await executePublish(PublishTiming.LATER)
  }, [executePublish])

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
            {t('builder_marketing_content_type_social_post')}
          </text.span>
        </Box>
        <Box orientation="horizontal" gap="md">
          {isCampaignPost && (
            <Button
              design="primary"
              text={t('builder_social_schedule_title')}
              size="sm"
              onClick={() => setIsScheduleModalOpen(true)}
              disabled={isBasePublishDisabled}
              className="cursor-pointer border-[#4F39F6]! bg-[#4F39F6]! text-white"
            />
          )}
        </Box>
      </Box>

      <div className="border-t pt-4" />

      <div className="w-full">
        <div className="mb-3 flex justify-center">
          <div className="inline-flex rounded-full bg-intents-ux-boxLowContrast-backgroundColor p-0.5">
            <button
              type="button"
              className={`cursor-pointer flex items-center gap-0.5 rounded-full border border-transparent px-1.5 py-0.5 text-sm ${previewTab === 'all' ? 'border-intents-ux-box-borderColor bg-intents-ux-box-backgroundColor shadow-sm' : ''}`}
              onClick={() => {
                setPreviewTab('all')
                setPreviewPlatform(SocialPlatform.FACEBOOK)
              }}
            >
              <ThumbsUpIcon className="size-2" />
              <span>{t('builder_social_platform_all')}</span>
            </button>
            <button
              type="button"
              className={`cursor-pointer flex items-center gap-0.5 rounded-full border border-transparent px-1.5 py-0.5 text-sm ${previewTab === SocialPlatform.FACEBOOK ? 'border-intents-ux-box-borderColor bg-intents-ux-box-backgroundColor shadow-sm' : ''}`}
              onClick={() => {
                setPreviewTab(SocialPlatform.FACEBOOK)
                setPreviewPlatform(SocialPlatform.FACEBOOK)
              }}
            >
              <FacebookIcon className="size-2" />
              <span>{t('builder_social_platform_facebook')}</span>
            </button>
            <button
              type="button"
              className={`cursor-pointer flex items-center gap-0.5 rounded-full border border-transparent px-1.5 py-0.5 text-sm ${previewTab === SocialPlatform.INSTAGRAM ? 'border-intents-ux-box-borderColor bg-intents-ux-box-backgroundColor shadow-sm' : ''}`}
              onClick={() => {
                setPreviewTab(SocialPlatform.INSTAGRAM)
                setPreviewPlatform(SocialPlatform.INSTAGRAM)
              }}
            >
              <InstagramIcon className="size-2" />
              <span>{t('builder_social_platform_instagram')}</span>
            </button>
          </div>
        </div>

        <div className="mx-auto w-full max-w-[760px] rounded-lg bg-intents-ux-box-backgroundColor p-2">
          <PostCardPreview post={previewPost} hidePlatformIcon={previewTab === 'all'} />
        </div>

        <text.p as="paragraph" className="mx-auto mt-1 max-w-[760px] px-0.5 text-center italic text-intents-ux-textSubtle-textColor" size={-1}>
          {t('builder_social_post_chat_edit_hint')}
        </text.p>
      </div>

      {isCampaignPost && isScheduleModalOpen && (
        <Modal
          id="social-post-schedule-modal"
          title={t('builder_social_schedule_time_title')}
          onClose={() => setIsScheduleModalOpen(false)}
        >
          <Box orientation="vertical" gap="md" className="md:min-w-[360px]">
            <DateInput
              id="social-post-schedule-date"
              label={t('builder_social_schedule_date_label')}
              value={scheduling.date}
              onChange={scheduling.setDate}
              locale={locale}
              required
              shouldDisableDate={shouldDisableDate}
              portalElem={document.body}
            />
            <TimePicker
              id="social-post-schedule-time"
              label={t('builder_social_schedule_time_label')}
              value={scheduling.time}
              onChange={scheduling.setTime}
              visualSize="md"
              required
              hour12={true}
              minuteInterval={15}
              locale={locale}
              disabled={!scheduling.date.length}
            />
            <text.p as="caption" size={-2} emphasis="passive">
              {t('builder_social_schedule_timezone', { timezone: timezoneDisplay })}
            </text.p>
            <Box orientation="horizontal" gap="sm">
              <Button
                design="secondary"
                text={t('builder_social_schedule_now')}
                onClick={handlePublishNowClick}
                disabled={isBasePublishDisabled}
              />
              <Button
                design="primary"
                text={t('builder_social_schedule_title')}
                onClick={handleScheduleClick}
                disabled={isScheduleDisabled}
              />
            </Box>
          </Box>
        </Modal>
      )}
    </div>
  )
}
