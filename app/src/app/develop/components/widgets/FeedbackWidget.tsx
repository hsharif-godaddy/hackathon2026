'use client'

import { useState } from 'react'
import Button from '@ux/button'
import text from '@ux/text'
import TextInput from '@ux/text-input'

import { getFullStorySessionUrl } from '@/components/feedback/utils'
import { useTranslations } from '@/hooks/useTranslations'
import { shipAnalyticsLog } from '@/lib/logging'
import { logger } from '@/lib/request-context'
import { getRootDomain } from '@/utils/getRootDomain'

export interface FeedbackWidgetProps {
  conversationId?: string
  appId?: string
}

export enum FeedbackRating {
  Bad = 'bad',
  Fine = 'fine',
  Good = 'good'
}

const FEEDBACK_PK = 'airo#app-builder-chat'

interface RatingOption {
  rating: FeedbackRating
  emoji: string
  labelKey: string
}

const RATING_OPTIONS: RatingOption[] = [
  { rating: FeedbackRating.Bad, emoji: '☹️', labelKey: 'builder_widgets_feedback_bad' },
  { rating: FeedbackRating.Fine, emoji: '😐', labelKey: 'builder_widgets_feedback_fine' },
  { rating: FeedbackRating.Good, emoji: '🙂', labelKey: 'builder_widgets_feedback_good' },
]

const COMMENT_PLACEHOLDER_KEYS: Record<FeedbackRating, string> = {
  [FeedbackRating.Bad]: 'builder_widgets_feedback_placeholder_bad',
  [FeedbackRating.Fine]: 'builder_widgets_feedback_placeholder_fine',
  [FeedbackRating.Good]: 'builder_widgets_feedback_placeholder_good',
}

const RATING_SLACK_EMOJIS: Record<FeedbackRating, string> = {
  [FeedbackRating.Bad]: ':white_frowning_face: - Session rated as Bad',
  [FeedbackRating.Fine]: ':neutral_face: - Session rated as Neutral',
  [FeedbackRating.Good]: ':slightly_smiling_face: - Session rated as Good',
}

export default function FeedbackWidget({ conversationId, appId }: FeedbackWidgetProps) {
  const t = useTranslations()
  const [selectedRating, setSelectedRating] = useState<FeedbackRating | null>(null)
  const [comment, setComment] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isSubmitted, setIsSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const sendToSlack = async (rating: FeedbackRating, userComment: string) => {
    try {
      const feedbackLines = [
        `*Rating*: ${RATING_SLACK_EMOJIS[rating]}`,
      ]

      if (userComment.trim()) {
        feedbackLines.push(`*Comment*: ${userComment.trim()}`)
      }

      if (conversationId) {
        feedbackLines.push(`*Conversation ID*: ${conversationId}`)
      }

      // Get FullStory session URL
      const fullStoryUrl = await getFullStorySessionUrl(true)
      if (fullStoryUrl) {
        feedbackLines.push(`*FullStory Session*: ${fullStoryUrl}`)
      }

      const message = feedbackLines.join('\n')
      const title = `New Session Feedback${appId ? ` for App ID: ${appId}` : ''}`

      await fetch('/api/slack-webhook/feedback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title,
          message,
        }),
      })
    } catch (err) {
      logger.warn('feedback.session.slack.send_failed', {
        appId: appId || '',
        conversationId: conversationId || '',
        rating,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  const submitFeedback = async (rating: FeedbackRating, userComment: string) => {
    setIsSubmitting(true)
    setError(null)

    try {
      const rootDomain = getRootDomain()

      // Use mock on localhost/server-side, external API in production
      if (!rootDomain) {
        // Mock delay for localhost
        await new Promise(resolve => setTimeout(resolve, 500))

        // Send to Slack even in localhost mode
        await sendToSlack(rating, userComment)

        setIsSubmitted(true)
        return
      }

      // Production: submit to external API
      const baseUrl = `https://api.companion.hub.${rootDomain}/v1/`

      const keys = ['rate-session-experience', 'comment-session-experience', 'conversation-id', 'app-id']
      const values: string[] = [rating, userComment.trim() || '', conversationId || '', appId || '']

      const response = await fetch(`${baseUrl}feedbacks/${encodeURIComponent(FEEDBACK_PK)}`, {
        mode: 'cors',
        method: 'POST',
        credentials: 'include',
        headers: {
          'X-XSRF-TOKEN': '1',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url: window?.location?.href,
          keys,
          values,
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to submit feedback')
      }

      setIsSubmitted(true)

      // Send to Slack after successful database save
      await sendToSlack(rating, userComment)

      // Log successful submission to Elasticsearch
      shipAnalyticsLog('feedback.submit.success', {
        appId: appId || '',
        conversationId: conversationId || '',
        rating,
        hasComment: !!userComment.trim(),
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
      setSelectedRating(null)
      setComment('')

      // Log submission failure to Elasticsearch
      shipAnalyticsLog('feedback.submit.failure', {
        appId: appId || '',
        conversationId: conversationId || '',
        error: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleRatingSelect = (rating: FeedbackRating) => {
    if (isSubmitting || isSubmitted) return

    setSelectedRating(rating)
  }

  const handleCommentKeyDown = (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && selectedRating && !isSubmitting) {
      // Submit immediately
      submitFeedback(selectedRating, comment)
    }
  }

  const handleSkip = () => {
    setIsSubmitted(true)
  }

  const handleClear = () => {
    setSelectedRating(null)
    setComment('')
  }

  if (isSubmitted && !error) {
    return (
      <div className="flex items-center justify-center px-2 py-1 border border-intents-ux-border-borderColor rounded-lg my-2">
        <text.span
          size={-1}
          className="text-center"
        >
          {selectedRating ? t('builder_widgets_feedback_thank_you') : t('builder_widgets_feedback_skipped')}
        </text.span>
      </div>
    )
  }

  const showCommentField = selectedRating && !isSubmitted

  return (
    <div className="flex flex-col gap-2 p-2 border border-intents-ux-border-borderColor rounded-lg my-2">
      <div className="flex justify-between items-start">
        <div className="flex flex-col">
          <text.span as="label" size={0} className="!m-0">
            {t('builder_widgets_feedback_header')}
          </text.span>
          <text.span size={-1} emphasis="passive">
            {t('builder_widgets_feedback_subtext')}
          </text.span>
        </div>
          <Button
            design="inline"
            size="sm"
            onClick={handleSkip}
            text={t('builder_widgets_feedback_skip')}
          />
      </div>

      <div className="flex gap-2 items-center">
        <div className="flex gap-1 flex-1">
          {RATING_OPTIONS.map(({ rating, emoji, labelKey }) => (
            <Button
              key={rating}
              design={selectedRating === rating ? 'secondary' : 'control'}
              size="sm"
              onClick={() => handleRatingSelect(rating)}
              disabled={isSubmitting}
              text={`${emoji} ${t(labelKey)}`}
            />
          ))}
        </div>
      </div>

      {showCommentField && (
        <div className="flex flex-col gap-1">
          <TextInput
            multiline
            label={t('builder_widgets_feedback_comment_label')}
            value={comment}
            onChange={setComment}
            onKeyDown={handleCommentKeyDown}
            placeholder={t(COMMENT_PLACEHOLDER_KEYS[selectedRating])}
            disabled={isSubmitting}
            visualSize="sm"
          />
          <div className="flex justify-end gap-1">
            <Button
              design="tertiary"
              size="sm"
              onClick={handleClear}
              text={t('builder_widgets_feedback_clear')}
            />
            <Button
              design="primary"
              size="sm"
              onClick={() => submitFeedback(selectedRating, comment)}
              text={t('builder_widgets_feedback_send')}
            />
          </div>
        </div>
      )}

      {isSubmitting && (
        <text.span size={-2} emphasis="passive" className="text-center">
          {t('builder_widgets_feedback_submitting')}
        </text.span>
      )}

      {error && (
        <text.span size={-2} emphasis="critical">
          {error}
        </text.span>
      )}
    </div>
  )
}
