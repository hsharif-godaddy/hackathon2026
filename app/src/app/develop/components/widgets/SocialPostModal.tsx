/* eslint-disable react/display-name */
'use client'

import { memo, useCallback, useMemo, useState } from 'react'
import Box from '@ux/box'
import Button from '@ux/button'
import Modal from '@ux/modal'
import text from '@ux/text'
import TextInput from '@ux/text-input'

import { SchedulingView } from '@/app/develop/components/social/post/SchedulingView'
import { PostCardPreview } from '@/app/develop/components/widgets/PostCardPreview'
import { useScheduling } from '@/hooks/useScheduling'
import { useSocialPublish } from '@/hooks/useSocialPublish'
import { useTranslations } from '@/hooks/useTranslations'
import { type SiteAssociation } from '@/types/social'
import { PublishTiming, SocialPostData, SocialPostState } from '@/types/social-posts'
import { formatPlatformName } from '@/utils/social/format'
import { getCharacterCount, getPlatformLimits, isPostOverLimit } from '@/utils/social/validation'

interface HashtagEditorProps {
  hashtags: string[]
  hashtagInput: string
  onHashtagInputChange: (value: string) => void
  onAddHashtag: (tag: string) => void
  onRemoveHashtag: (index: number) => void
  t: (key: string) => string
}

/**
 * HashtagEditor component
 * Note: Intentionally using native HTML button and input elements instead of UXCore components
 * to create a custom inline hashtag editing experience with proper styling and behavior
 */
const HashtagEditor = memo(({
  hashtags,
  hashtagInput,
  onHashtagInputChange,
  onAddHashtag,
  onRemoveHashtag,
  t
}: HashtagEditorProps) => (
  <div className="mt-2">
    <text.span as="label" size={-1} className="block mb-1">
      {t('builder_widgets_socialpost_hashtags')}
    </text.span>
    <div className="flex flex-wrap gap-0.5 items-center">
      {hashtags?.map((tag, i) => (
        <div
          key={i}
          className="inline-flex items-center gap-0.5 text-sm group"
          style={{ color: '#145FA9' }}
        >
          #{tag}
          <button
            onClick={() => onRemoveHashtag(i)}
            className="text-xs opacity-0 group-hover:opacity-100"
            aria-label={`${t('builder_common_remove')} ${tag}`}
          >
            ×
          </button>
        </div>
      ))}
      <input
        type="text"
        value={hashtagInput}
        onChange={(e) => onHashtagInputChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && hashtagInput.trim()) {
            onAddHashtag(hashtagInput.trim())
            e.preventDefault()
          }
        }}
        placeholder={`+ ${t('builder_widgets_socialpost_hashtag_add')}`}
        className="text-sm border-0 outline-none w-24"
        style={{ color: '#145FA9' }}
      />
    </div>
  </div>
))

interface CharacterCounterProps {
  charCount: number
  maxChars: number
  isOverLimit: boolean
  platform: string
}

const CharacterCounter = memo(({ charCount, maxChars, isOverLimit, platform }: CharacterCounterProps) => {
  const t = useTranslations()
  const platformName = formatPlatformName(platform)

  return (
    <div className="mt-1">
      <text.span as="label" size={-1} className="block mb-0.5">{t('builder_social_character_limits', { platform: platformName })}</text.span>
      <text.span as="paragraph" size={-2} emphasis={isOverLimit ? 'warning' : 'passive'}>
        {t('builder_social_character_count', { charCount, maxChars })}
      </text.span>
    </div>
  )
})

interface PostEditorFormProps {
  post: SocialPostData
  hashtagInput: string
  validation: {
    charCount: number
    maxChars: number
    isOverLimit: boolean
  }
  onChange: (field: keyof SocialPostData, value: any) => void
  onHashtagInputChange: (value: string) => void
  onAddHashtag: (tag: string) => void
  onRemoveHashtag: (index: number) => void
  t: (key: string) => string
}

const PostEditorForm = memo(({
  post,
  hashtagInput,
  validation,
  onChange,
  onHashtagInputChange,
  onAddHashtag,
  onRemoveHashtag,
  t
}: PostEditorFormProps) => (
  <div className="w-full border border-intents-ux-border-borderColor shadow-sm pb-2">
    <div className="px-2 mx-1 mb-1 pt-2">
      <TextInput
        id="post-content"
        label={t('builder_widgets_socialpost_label_write')}
        multiline
        value={post.content}
        onChange={(targetValue: string) => onChange('content', targetValue)}
        placeholder={t('builder_widgets_socialpost_placeholder_write')}
        size={6}
      />

      <div className="mt-2">
        <TextInput
          id='call-to-action'
          label={t('builder_widgets_socialpost_label_add_cta')}
          value={post.callToAction || ''}
          onChange={(targetValue: string) => onChange('callToAction', targetValue)}
          placeholder={t('builder_widgets_socialpost_placeholder_add_cta')}
          multiline
          size={2}
        />
      </div>

      <HashtagEditor
        hashtags={post.hashtags || []}
        hashtagInput={hashtagInput}
        onHashtagInputChange={onHashtagInputChange}
        onAddHashtag={onAddHashtag}
        onRemoveHashtag={onRemoveHashtag}
        t={t}
      />

      <CharacterCounter
        charCount={validation.charCount}
        maxChars={validation.maxChars}
        isOverLimit={validation.isOverLimit}
        platform={post.platform}
      />
    </div>
  </div>
))

interface SocialPostModalProps {
  post: SocialPostData
  appId: string
  onClose: () => void
  onSave?: (updatedPost: SocialPostData) => void
  onPublish?: (post: SocialPostData) => void
  associations?: SiteAssociation[]
}

/**
 * Modal component for viewing and editing a social post
 * Combines preview, edit, and form functionality in a single component
 */
export const SocialPostModal = memo(({ post, onClose, onSave, onPublish, associations = [] }: SocialPostModalProps) => {
  const t = useTranslations()

  const [isEditMode, setIsEditMode] = useState(false)
  const [editedPost, setEditedPost] = useState<SocialPostData>(post)
  const [hashtagInput, setHashtagInput] = useState('')

  // Use scheduling hook for date/time management
  const scheduling = useScheduling()

  // Use social publish hook for publish logic
  const { isPublishing, publish } = useSocialPublish({
    associations,
    onSave,
    onPublish,
    onComplete: onClose,
  })

  const validation = useMemo(() => {
    const limits = getPlatformLimits(editedPost.platform)
    const charCount = getCharacterCount(editedPost)
    const isOverLimit = isPostOverLimit(editedPost)

    return {
      maxChars: limits.maxCharacters,
      charCount,
      isOverLimit
    }
  }, [editedPost])

  const handleEditClick = useCallback(() => {
    setIsEditMode(true)
  }, [])

  const handleChange = useCallback((field: keyof SocialPostData, value: any) => {
    setEditedPost(prev => ({ ...prev, [field]: value }))
  }, [])

  const handleAddHashtag = useCallback((tag: string) => {
    const cleanTag = tag.replace(/^#/, '')
    if (cleanTag && !editedPost.hashtags?.includes(cleanTag)) {
      setEditedPost(prev => ({
        ...prev,
        hashtags: [...(prev.hashtags || []), cleanTag]
      }))
    }
    setHashtagInput('')
  }, [editedPost.hashtags])

  const handleRemoveHashtag = useCallback((index: number) => {
    setEditedPost(prev => ({
      ...prev,
      hashtags: prev.hashtags?.filter((_, idx) => idx !== index)
    }))
  }, [])

  const handleSave = useCallback(() => {
    if (onSave) {
      onSave(editedPost)
    }
    setIsEditMode(false)
  }, [editedPost, onSave])

  const handleCancel = useCallback(() => {
    setEditedPost(post)
    setIsEditMode(false)
    setHashtagInput('')
  }, [post])

  const handlePublishClick = useCallback(async () => {
    await publish({
      post: editedPost,
      timing: scheduling.timing,
      scheduleDate: scheduling.date,
      scheduleTime: scheduling.time,
    })
  }, [publish, editedPost, scheduling])

  const isPublishDisabled = useMemo(() => {
    return isPublishing || validation.isOverLimit || !scheduling.isValid
  }, [isPublishing, validation.isOverLimit, scheduling.isValid])

  const isPublished = editedPost.publishedState === SocialPostState.PUBLISHED
  const isScheduled = editedPost.publishedState === SocialPostState.SCHEDULED
  const isViewOnly = isPublished || isScheduled

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
              disabled={validation.isOverLimit}
            />
          </Box>
        ) : (
          <Box orientation="horizontal" gap="md">
            <Button
              design="secondary"
              text={t('builder_common_edit')}
              size='sm'
              onClick={handleEditClick}
              disabled={isPublishing}
            />
            <Button
              design="primary"
              text={isPublishing ? t('builder_common_loading') : (scheduling.timing === PublishTiming.LATER ? t('builder_social_schedule_post') : t('builder_widgets_socialpublish_publish'))}
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
              <PostEditorForm
                post={editedPost}
                hashtagInput={hashtagInput}
                validation={validation}
                onChange={handleChange}
                onHashtagInputChange={setHashtagInput}
                onAddHashtag={handleAddHashtag}
                onRemoveHashtag={handleRemoveHashtag}
                t={t}
              />
            ) : (
              <PostCardPreview post={editedPost} />
            )}
          </div>
        </div>

        {!isViewOnly && (
          <div className="w-full md:w-[320px] flex-shrink-0 pt-4 md:pt-0 md:pl-4">
            <SchedulingView
              timing={scheduling.timing}
              date={scheduling.date}
              time={scheduling.time}
              onTimingChange={scheduling.setTiming}
              onDateChange={scheduling.setDate}
              onTimeChange={scheduling.setTime}
            />
          </div>
        )}
      </div>
    </Modal>
  )
})