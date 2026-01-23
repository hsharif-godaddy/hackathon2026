/* eslint-disable react/display-name */
'use client'

import { memo,useCallback, useMemo, useState } from 'react'
import Box from '@ux/box'
import Button from '@ux/button'
import Modal from '@ux/modal'
import text from '@ux/text'
import TextInput from '@ux/text-input'

import { PostCardPreview } from '@/app/develop/components/widgets/PostCardPreview'
import { useWebSocketContext } from '@/contexts/WebSocketContext'
import { useSiteAssociations } from '@/hooks/useSocial'
import { useTranslations } from '@/hooks/useTranslations'
import { CONNECT_REQUEST_FROM_PUBLISH } from '@/types/social'
import { SocialPostData, SocialPostState } from '@/types/social-posts'
import { formatHashtags, formatPlatformName, getCharacterCount, getPlatformLimits, isPostOverLimit } from '@/utils/social'

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
  const platformName = platform.charAt(0).toUpperCase() + platform.slice(1)

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
  <div className="w-full max-w-[450px] mx-auto border border-gray-200 shadow-sm pb-2">
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
}

/**
 * Modal component for viewing and editing a social post
 * Combines preview, edit, and form functionality in a single component
 */
export const SocialPostModal = memo(({ post, appId, onClose, onSave, onPublish }: SocialPostModalProps) => {
  const t = useTranslations();
  const { sendMessage } = useWebSocketContext()
  const { data: associationsData } = useSiteAssociations(appId)

  const [isEditMode, setIsEditMode] = useState(false)
  const [isPublishing, setIsPublishing] = useState(false)
  const [editedPost, setEditedPost] = useState<SocialPostData>(post)
  const [hashtagInput, setHashtagInput] = useState('')

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
    setEditedPost(prev => ({...prev, [field]: value}))
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

  const handlePublish = useCallback(async () => {
    setIsPublishing(true)

    try {
      const associations = associationsData?.associations || []
      const hasConnection = associations.some(a =>
        a.platform.toLowerCase() === editedPost.platform.toLowerCase()
      )

      const platformName = formatPlatformName(editedPost.platform)

      // Save edits to post list before publishing (so history shows edited version)
      if (onSave) {
        onSave(editedPost)
      }

      // Transform post data for publishing
      const pendingPublish = {
        platform: editedPost.platform,
        message: [editedPost.content, editedPost.callToAction, formatHashtags(editedPost.hashtags)].filter(Boolean).join('\n\n'),
        imageUrls: editedPost.images?.map(img => img.url) || [],
      }

      if (hasConnection) {
        await sendMessage(
          `Publish ${editedPost.styleLabel} to ${platformName}`,
          undefined,
          undefined,
          undefined,
          false,
          {
            type: 'social_publish_ready',
            data: {
              platform: editedPost.platform,
              connectionVerified: true,
              pendingPublish,
              postData: editedPost
            },
            persistence: 'ephemeral'
          }
        )
      } else {
        await sendMessage(
          `Connect to ${platformName}`,
          undefined,
          undefined,
          undefined,
          false,
          {
            type: CONNECT_REQUEST_FROM_PUBLISH,
            data: {
              platform: editedPost.platform,
              pendingPublish,
              postData: editedPost
            },
            persistence: 'ephemeral'
          }
        )
      }

      if (onPublish) {
        onPublish(editedPost)
      }

      onClose()
    } finally {
      setIsPublishing(false)
    }
  }, [editedPost, associationsData, sendMessage, onSave, onPublish, onClose])

  const isPublished = editedPost.publishedState === SocialPostState.PUBLISHED

  return (
    <Modal
      title={post.styleLabel}
      onClose={onClose}
      actions={
        isPublished ? (
          // Published state: Only show close button (no edit/publish)
          null
        ) : isEditMode ? (
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
              text={isPublishing ? t('builder_common_loading') : t('builder_widgets_socialpublish_publish')}
              size='sm'
              onClick={handlePublish}
              disabled={isPublishing}
            />
          </Box>
        )
      }
    >
      <div className="w-full max-w-[650px]">
        <div className="max-h-[70vh] overflow-y-auto">
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
    </Modal>
  )
})
