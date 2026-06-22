
'use client'

import { memo, useCallback, useMemo, useState } from 'react'
import Box from '@ux/box'
import Button from '@ux/button'
import Checkbox from '@ux/checkbox'
import Modal from '@ux/modal'
import text from '@ux/text'

import { useChatContext } from '@/contexts/ChatContext'
import { useScheduling } from '@/hooks/useScheduling'
import { useSiteAssociations } from '@/hooks/useSocial'
import { useTranslations } from '@/hooks/useTranslations'
import { PLATFORM_TRANSFORMS, type PublishablePlatform } from '@/lib/social-platforms'
import { CONNECT_REQUEST_FROM_PUBLISH, type SiteAssociation } from '@/types/social'
import { PublishTiming, SocialPostData, SocialPostState } from '@/types/social-posts'
import { formatHashtags, formatPlatformName } from '@/utils/social/format'
import { getCharacterCount } from '@/utils/social/validation'
import { ContentEditor, type PlatformContent } from './editor/ContentEditor'
import { PlatformSelector } from './platform-select/PlatformSelector'
import { PostCardPreview } from './preview/PostCardPreview'
import { PreviewTabs } from './preview/PreviewTabs'
import { SchedulingSection } from './scheduling/SchedulingSection'

interface SocialPostModalProps {
  post: SocialPostData
  appId: string
  onClose: () => void
  onSave?: (updatedPost: SocialPostData) => void
  onPublish?: (post: SocialPostData) => void
  associations?: SiteAssociation[]
  initialTiming?: PublishTiming
  initialDate?: string
  initialTime?: string
  initialPlatforms?: PublishablePlatform[]
}

/**
 * Modal component for viewing and editing a social post
 * Combines preview, edit, and form functionality in a single component
 * Supports multi-platform publishing with scheduling
 */
export const PostModal = memo(({
  post,
  appId,
  onClose,
  onSave,
  onPublish,
  associations: _associations,
  initialTiming,
  initialDate,
  initialTime,
  initialPlatforms
}: SocialPostModalProps) => {
  const t = useTranslations()
  const { sendMessage } = useChatContext()
  const { data: associationsData, isLoading: isLoadingAssociations, isError: isAssociationsError } = useSiteAssociations(appId)

  const [isEditMode, setIsEditMode] = useState(false)
  const [selectedPlatforms, setSelectedPlatforms] = useState<Set<PublishablePlatform>>(
    new Set(initialPlatforms || ['facebook', 'instagram'])
  )
  const [previewPlatform, setPreviewPlatform] = useState<PublishablePlatform>(
    initialPlatforms?.[0] || 'facebook'
  )
  const [customizePerPlatform, setCustomizePerPlatform] = useState(false)

  // Single source of truth for content - always stored per-platform
  const [platformContent, setPlatformContent] = useState<Record<PublishablePlatform, PlatformContent>>(() => ({
    facebook: { content: post.content || '', callToAction: post.callToAction || '', hashtags: post.hashtags || [] },
    instagram: { content: post.content || '', callToAction: post.callToAction || '', hashtags: post.hashtags || [] }
  }))

  // Scheduling state
  const scheduling = useScheduling({
    initialTiming,
    initialDate,
    initialTime
  })

  // Track images separately (shared across all platforms)
  const [images, setImages] = useState(post.images)

  // Validation
  const platformValidation = useMemo(() => {
    const imageCount = images?.length || 0

    const results: Record<PublishablePlatform, { valid: boolean; charCount: number; maxChars: number; errors: string[] }> = {
      facebook: {
        valid: true,
        charCount: getCharacterCount({ ...post, ...platformContent.facebook }),
        maxChars: 63206,
        errors: []
      },
      instagram: {
        valid: true,
        charCount: getCharacterCount({ ...post, ...platformContent.instagram }),
        maxChars: 2200,
        errors: []
      }
    }

    // Validate Facebook
    if (results.facebook.charCount > 63206) {
      results.facebook.valid = false
      results.facebook.errors.push(t('builder_social_validation_over_limit', { over: results.facebook.charCount - 63206 }))
    }

    // Validate Instagram
    if (results.instagram.charCount > 2200) {
      results.instagram.valid = false
      results.instagram.errors.push(t('builder_social_validation_over_limit', { over: results.instagram.charCount - 2200 }))
    }
    if (imageCount === 0) {
      results.instagram.valid = false
      results.instagram.errors.push(t('builder_social_error_instagram_image_required'))
    }

    return results
  }, [platformContent, images, post, t])

  const validation = useMemo(() => {
    const selectedResults = Array.from(selectedPlatforms).map(p => platformValidation[p])
    const anyValid = selectedResults.length > 0 && selectedResults.some(r => r.valid)

    return {
      anyValid,
      selectedCount: selectedPlatforms.size
    }
  }, [selectedPlatforms, platformValidation])

  // Simple handlers
  const handlePlatformToggle = useCallback((platform: PublishablePlatform) => {
    setSelectedPlatforms(prev => {
      const next = new Set(prev)
      if (next.has(platform)) {
        next.delete(platform)
      } else {
        next.add(platform)
      }
      return next
    })
  }, [])

  const handleScheduleChange = useCallback((update: { date?: string[]; time?: string }) => {
    if (update.date) scheduling.setDate(update.date)
    if (update.time) scheduling.setTime(update.time)
  }, [scheduling])

  const [isPublishing, setIsPublishing] = useState(false)

  const handlePublishClick = useCallback(async () => {
    setIsPublishing(true)

    try {
      const associations = associationsData?.associations || []
      const selectedPlatformsArray = Array.from(selectedPlatforms)

      // Guard: Ensure at least one platform is selected
      if (selectedPlatformsArray.length === 0) {
        return
      }

      // Format platform names with "and" for 2 platforms
      const formatPlatformsList = (platforms: PublishablePlatform[]) => {
        const names = platforms.map(p => formatPlatformName(p))
        if (names.length === 1) return names[0]
        if (names.length === 2) return `${names[0]} and ${names[1]}`
        return names.slice(0, -1).join(', ') + `, and ${names[names.length - 1]}`
      }

      const platformsList = formatPlatformsList(selectedPlatformsArray)

      // Get unified schedule
      let scheduledAt: Date | undefined
      let scheduledDateStr: string | undefined
      if (scheduling.timing === PublishTiming.LATER && scheduling.date.length && scheduling.time) {
        scheduledAt = new Date(`${scheduling.date[0]}T${scheduling.time}`)
        scheduledDateStr = scheduledAt.toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric'
        })
      }

      // Build display message
      const displayMessage = scheduledAt
        ? `Schedule ${post.styleLabel} to ${platformsList} on ${scheduledDateStr}`
        : `Publish ${post.styleLabel} to ${platformsList}`

      // Save edits
      if (onSave) {
        const firstPlatform = selectedPlatformsArray[0]
        const content = platformContent[firstPlatform]
        onSave({ ...post, ...content, images })
      }

      // Check connection status for all platforms
      const notConnectedPlatforms = selectedPlatformsArray.filter(platform =>
        !associations.some(a => a.platform.toLowerCase() === platform.toLowerCase())
      )

      // Build multi-platform pendingPublish (used by both cases)
      const platformData = selectedPlatformsArray.map(platform => {
        const content = platformContent[platform]
        const message = [content.content, content.callToAction, formatHashtags(content.hashtags)]
          .filter(Boolean)
          .join('\n\n')

        return {
          platform: PLATFORM_TRANSFORMS.toDisplay(platform) as PublishablePlatform,
          message,
          imageUrls: images?.map(img => img.url) || [],
          scheduledAt
        }
      })

      const firstPlatformData = platformData[0]
      const pendingPublish = {
        platforms: selectedPlatformsArray.map(p => PLATFORM_TRANSFORMS.toDisplay(p) as PublishablePlatform),
        platformData,
        // Top-level fields for backwards compatibility (use first platform's data)
        message: firstPlatformData?.message ?? '',
        imageUrls: firstPlatformData?.imageUrls ?? [],
        scheduledAt: firstPlatformData?.scheduledAt
      }

      // Case 1: All platforms connected - publish to all in one message
      if (notConnectedPlatforms.length === 0) {
        // Send ONE message for all platforms
        await sendMessage({
          content: displayMessage,
          isActionRequest: false,
          customContext: {
            type: 'social_publish_ready',
            data: {
              platforms: selectedPlatformsArray,
              connectionVerified: true,
              pendingPublish
            },
            persistence: 'save'
          }
        })
      } else {
        // Case 2/3: Some or all platforms not connected
        // Send connect for FIRST platform only (sequential flow)
        const firstPlatform = notConnectedPlatforms[0]
        if (!firstPlatform) {
          // Safety guard: if no platform is available, abort the connect flow
          return
        }
        const platformName = formatPlatformName(firstPlatform)

        // Send connect request with full context (all platforms + pending publish)
        await sendMessage({
          content: `Connect to ${platformName}`,
          isActionRequest: false,
          customContext: {
            type: CONNECT_REQUEST_FROM_PUBLISH,
            data: {
              platforms: notConnectedPlatforms,  // Full list of platforms that need connecting
              pendingPublish,  // Publish data for all platforms
              postData: {
                ...post,
                ...platformContent[selectedPlatformsArray[0]],
                images
              }
            },
            persistence: 'save'
          }
        })
      }

      if (onPublish) {
        const firstPlatform = selectedPlatformsArray[0]
        const content = platformContent[firstPlatform]
        onPublish({ ...post, ...content, images })
      }

      onClose()
    } finally {
      setIsPublishing(false)
    }
  }, [post, selectedPlatforms, associationsData, sendMessage, onSave, onPublish, onClose, scheduling, platformContent, images])

  const isPublishDisabled = useMemo(() => {
    return isPublishing || !validation.anyValid || validation.selectedCount === 0
  }, [isPublishing, validation])

  const isPublished = post.publishedState === SocialPostState.PUBLISHED
  const isScheduled = post.publishedState === SocialPostState.SCHEDULED
  const isViewOnly = isPublished || isScheduled

  // Preview post - combines platform-specific content with base post
  const previewPost = useMemo(() => ({
    ...post,
    ...platformContent[previewPlatform],
    platform: previewPlatform,
    images
  }), [post, platformContent, previewPlatform, images])

  // Edit handlers
  const handleEditClick = useCallback(() => {
    setIsEditMode(true)
  }, [])

  const handleSave = useCallback(() => {
    if (onSave) {
      const firstPlatform = Array.from(selectedPlatforms)[0]
      onSave({ ...post, ...platformContent[firstPlatform], images })
    }
    setIsEditMode(false)
  }, [onSave, post, platformContent, selectedPlatforms, images])

  const handleCancel = useCallback(() => {
    // Reset content to original
    setPlatformContent({
      facebook: { content: post.content || '', callToAction: post.callToAction || '', hashtags: post.hashtags || [] },
      instagram: { content: post.content || '', callToAction: post.callToAction || '', hashtags: post.hashtags || [] }
    })
    setImages(post.images)
    setIsEditMode(false)
  }, [post])

  return (
    <Modal
      title={post.styleLabel}
      onClose={onClose}
      actions={
        isViewOnly ? null : isEditMode ? (
          <Box orientation="horizontal" gap="md">
            <Button
              design="secondary"
              text={t('builder_common_cancel')}
              size="sm"
              onClick={handleCancel}
            />
            <Button
              design="primary"
              text={t('builder_common_save_changes')}
              onClick={handleSave}
              size="sm"
              disabled={false}
            />
          </Box>
        ) : (
          <Box orientation="horizontal" gap="md">
            <Button
              design="secondary"
              text={t('builder_common_edit')}
              size="sm"
              onClick={handleEditClick}
              disabled={isPublishing}
            />
            <Button
              design="primary"
              text={
                isPublishing
                  ? t('builder_common_loading')
                  : scheduling.timing === PublishTiming.LATER
                    ? t('builder_social_schedule_post')
                    : validation.selectedCount > 0
                      ? t('builder_social_publish_to_count', { count: validation.selectedCount })
                      : t('builder_widgets_socialpublish_publish')
              }
              size='sm'
              onClick={handlePublishClick}
              disabled={isPublishDisabled}
            />
          </Box>
        )
      }
    >
      <div className={`flex flex-col md:flex-row gap-4 w-full mx-auto ${isViewOnly ? 'max-w-[450px]' : 'max-w-[850px]'}`}>
        <div className={isViewOnly ? "w-full" : "flex-1 min-w-0"}>
          <div className="min-h-[400px] md:min-h-[500px] overflow-y-auto">
            {isEditMode ? (
              <ContentEditor
                platformContent={platformContent}
                images={images}
                onContentChange={setPlatformContent}
                validation={platformValidation}
                customizePerPlatform={customizePerPlatform}
                activePlatform={previewPlatform}
              />
            ) : (
              <>
                <PreviewTabs
                  selectedPlatform={previewPlatform}
                  onPlatformChange={setPreviewPlatform}
                  selectedPlatforms={selectedPlatforms}
                />
                <PostCardPreview post={previewPost} />
              </>
            )}
          </div>
        </div>

        {!isViewOnly && (
          <div className="w-full md:w-[320px] flex-shrink-0 pt-4 md:pt-0 md:pl-4">
            <Box orientation="vertical" gap="lg">
              <div>
                <text.h4 size={0} className="mb-1">{t('builder_social_publish_to')}</text.h4>
                <PlatformSelector
                  selectedPlatforms={selectedPlatforms}
                  onPlatformToggle={handlePlatformToggle}
                  validation={platformValidation}
                  associations={associationsData?.associations}
                  isAssociationsUnavailable={isLoadingAssociations || isAssociationsError}
                />
              </div>

              <div>
                <text.h4 size={0} className="mb-0.5">{t('builder_social_content')}</text.h4>
                <Checkbox
                  id="customize-content"
                  name="customize-content"
                  checked={customizePerPlatform}
                  onChange={setCustomizePerPlatform}
                  label={t('builder_social_customize_per_platform')}
                />
                <text.p size={-2} emphasis="passive" className="mt-0.5 ml-3">
                  {t('builder_social_customize_description')}
                </text.p>
              </div>

              <div>
                <text.h4 size={0} className="mb-1">{t('builder_social_when_to_publish')}</text.h4>
                <SchedulingSection
                  timing={scheduling.timing}
                  date={scheduling.date}
                  time={scheduling.time}
                  onTimingChange={scheduling.setTiming}
                  onScheduleChange={handleScheduleChange}
                />
              </div>
            </Box>
          </div>
        )}
      </div>
    </Modal>
  )
})