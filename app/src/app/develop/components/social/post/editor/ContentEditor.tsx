/* eslint-disable react/display-name */
'use client'

import { memo, useCallback, useState } from 'react'
import Box from '@ux/box'
import text from '@ux/text'
import TextInput from '@ux/text-input'

import { useTranslations } from '@/hooks/useTranslations'
import { type PublishablePlatform } from '@/lib/social-platforms'
import { type SocialPostData } from '@/types/social-posts'

export interface PlatformContent {
  content: string
  callToAction: string
  hashtags: string[]
}

interface PlatformContentEditorProps {
  platformContent: Record<PublishablePlatform, PlatformContent>
  images?: SocialPostData['images']
  onContentChange: (content: Record<PublishablePlatform, PlatformContent>) => void
  validation: Record<PublishablePlatform, { valid: boolean; charCount: number; maxChars: number; errors: string[] }>
  customizePerPlatform: boolean
  activePlatform: PublishablePlatform
}

const HashtagEditor = memo(({
  hashtags,
  onAdd,
  onRemove
}: {
  hashtags: string[]
  onAdd: (tag: string) => void
  onRemove: (index: number) => void
}) => {
  const t = useTranslations()
  const [input, setInput] = useState('')

  const handleAdd = useCallback(() => {
    if (input.trim()) {
      onAdd(input.trim())
      setInput('')
    }
  }, [input, onAdd])

  return (
    <div className="mt-2">
      <text.span as="label" size={-1} className="block mb-1">
        {t('builder_widgets_socialpost_hashtags')}
      </text.span>
      <div className="flex flex-wrap gap-0.5 items-center">
        {hashtags.map((tag, i) => (
          <div
            key={i}
            className="inline-flex items-center gap-0.5 text-sm group"
            style={{ color: '#145FA9' }}
          >
            #{tag}
            <button
              onClick={() => onRemove(i)}
              className="text-xs opacity-0 group-hover:opacity-100"
              aria-label={`${t('builder_common_remove')} ${tag}`}
            >
              ×
            </button>
          </div>
        ))}
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              handleAdd()
              e.preventDefault()
            }
          }}
          placeholder={`+ ${t('builder_widgets_socialpost_hashtag_add')}`}
          className="text-sm border-0 outline-none w-24"
          style={{ color: '#145FA9' }}
        />
      </div>
    </div>
  )
})

export const ContentEditor = memo(({
  platformContent,
  onContentChange,
  validation,
  customizePerPlatform,
  activePlatform
}: PlatformContentEditorProps) => {
  const t = useTranslations()

  const currentContent = customizePerPlatform
    ? platformContent[activePlatform]
    : platformContent.facebook // Use facebook as the unified content

  const handleFieldChange = useCallback((field: keyof PlatformContent, value: string | string[]) => {
    if (customizePerPlatform) {
      // Update only current platform
      onContentChange({
        ...platformContent,
        [activePlatform]: { ...platformContent[activePlatform], [field]: value }
      })
    } else {
      // Update all platforms with same value
      const updated = { ...platformContent }
      Object.keys(updated).forEach(platform => {
        updated[platform as PublishablePlatform] = { ...updated[platform as PublishablePlatform], [field]: value }
      })
      onContentChange(updated)
    }
  }, [customizePerPlatform, activePlatform, platformContent, onContentChange])

  const handleAddHashtag = useCallback((tag: string) => {
    const cleanTag = tag.replace(/^#/, '')
    if (cleanTag && !currentContent.hashtags.includes(cleanTag)) {
      handleFieldChange('hashtags', [...currentContent.hashtags, cleanTag])
    }
  }, [currentContent.hashtags, handleFieldChange])

  const handleRemoveHashtag = useCallback((index: number) => {
    handleFieldChange('hashtags', currentContent.hashtags.filter((_, i) => i !== index))
  }, [currentContent.hashtags, handleFieldChange])

  const currentValidation = validation[activePlatform]

  return (
    <Box orientation="vertical" gap="md">
      <div className="w-full border border-intents-ux-border-borderColor shadow-sm pb-2">
        <div className="px-2 mx-1 mb-1 pt-2">
          <TextInput
            id="post-content"
            label={t('builder_widgets_socialpost_label_write')}
            multiline
            value={currentContent.content}
            onChange={(value: string) => handleFieldChange('content', value)}
            placeholder={t('builder_widgets_socialpost_placeholder_write')}
            size={6}
          />

          <div className="mt-2">
            <TextInput
              id="call-to-action"
              label={t('builder_widgets_socialpost_label_add_cta')}
              value={currentContent.callToAction}
              onChange={(value: string) => handleFieldChange('callToAction', value)}
              placeholder={t('builder_widgets_socialpost_placeholder_add_cta')}
              multiline
              size={2}
            />
          </div>

          <HashtagEditor
            hashtags={currentContent.hashtags}
            onAdd={handleAddHashtag}
            onRemove={handleRemoveHashtag}
          />

          <div className="mt-1">
            <text.span as="label" size={-1} className="block mb-0.5">
              {t('builder_social_character_count_label')}
            </text.span>
            <text.span as="paragraph" size={-2} emphasis={!currentValidation.valid ? 'warning' : 'passive'}>
              {t('builder_social_character_count', {
                charCount: currentValidation.charCount,
                maxChars: currentValidation.maxChars
              })}
            </text.span>
          </div>
        </div>
      </div>
    </Box>
  )
})

ContentEditor.displayName = 'ContentEditor'
