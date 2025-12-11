/* eslint-disable react/display-name */
'use client'

import { useState, useCallback, useMemo, memo } from 'react'
import clsx from 'clsx'
import Button from '@ux/button'
import SiblingSet from '@ux/sibling-set'
import Modal from '@ux/modal'
import TextInput from '@ux/text-input'
import { PostCardPreview } from './PostCardPreview'
import { SocialPostData } from '@/types/social-posts'
import { getCharacterCount, getPlatformLimits, isPostOverLimit } from '@/utils/social-post-validation'
import text from '@ux/text'


interface HashtagEditorProps {
  hashtags: string[]
  hashtagInput: string
  onHashtagInputChange: (value: string) => void
  onAddHashtag: (tag: string) => void
  onRemoveHashtag: (index: number) => void
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
  onRemoveHashtag
}: HashtagEditorProps) => (
  <div className="mt-2">
    <text.span as="label" size={-1} className="block mb-1">Hashtags</text.span>
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
            className="text-gray-400 hover:text-red-500 text-xs opacity-0 group-hover:opacity-100"
            aria-label={`Remove ${tag}`}
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
        placeholder="+ Add hashtag"
        className="text-sm border-0 outline-none w-24 placeholder:text-gray-400"
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

const CharacterCounter = memo(({ charCount, maxChars, isOverLimit, platform }: CharacterCounterProps) => (
  <div className="mt-1">
    <text.span as="label" size={-1} className="block mb-0.5 capitalize">{platform} Character Limits</text.span>
    <div className={clsx('text-xs', isOverLimit ? 'text-red-500' : 'text-gray-400')}>
      {charCount}/{maxChars} characters
    </div>
  </div>
))

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
}

const PostEditorForm = memo(({
  post,
  hashtagInput,
  validation,
  onChange,
  onHashtagInputChange,
  onAddHashtag,
  onRemoveHashtag
}: PostEditorFormProps) => (
  <div className="w-full max-w-[450px] mx-auto border border-gray-200 shadow-sm pb-2">
    <div className="px-2 mx-1 mb-1 pt-2">
      <TextInput
        id="post-content"
        label="Post Content"
        multiline
        value={post.content}
        onChange={(targetValue: string) => onChange('content', targetValue)}
        placeholder="Write your post content..."
        size={6}
      />

      <div className="mt-2">
        <TextInput
          id='call-to-action'
          label="Call to Action"
          value={post.callToAction || ''}
          onChange={(targetValue: string) => onChange('callToAction', targetValue)}
          placeholder="Add call to action..."
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
  onClose: () => void
  onSave?: (updatedPost: SocialPostData) => void
}

/**
 * Modal component for viewing and editing a social post
 * Combines preview, edit, and form functionality in a single component
 */
export const SocialPostModal = memo(({ post, onClose, onSave }: SocialPostModalProps) => {
  const [isEditMode, setIsEditMode] = useState(false)
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

  return (
    <Modal
      title={post.styleLabel}
      onClose={onClose}
      actions={
        isEditMode ? (
          <SiblingSet gap="md">
            <Button
              design="secondary"
              text="Cancel"
              size="sm"
              onClick={handleCancel}
            />
            <Button
              design="primary"
              text="Save Changes"
              onClick={handleSave}
              size="sm"
              disabled={validation.isOverLimit}
            />
          </SiblingSet>
        ) : (
          <SiblingSet gap="md">
            <Button
              design="secondary"
              text="Edit"
              size='sm'
              onClick={handleEditClick}
            />
          </SiblingSet>
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
            />
          ) : (
              <PostCardPreview post={editedPost} />
          )}
        </div>
      </div>
    </Modal>
  )
})
