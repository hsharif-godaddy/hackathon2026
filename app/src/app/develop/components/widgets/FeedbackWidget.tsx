'use client'

import { useRef, useState } from 'react'
import Button from '@ux/button'
import text from '@ux/text'
import TextInput from '@ux/text-input'

import { useTranslations } from '@/hooks/useTranslations'
import { shipAnalyticsLog } from '@/lib/logging'
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
  { rating: FeedbackRating.Bad, emoji: '😞', labelKey: 'builder_widgets_feedback_bad' },
  { rating: FeedbackRating.Fine, emoji: '😐', labelKey: 'builder_widgets_feedback_fine' },
  { rating: FeedbackRating.Good, emoji: '😊', labelKey: 'builder_widgets_feedback_good' },
]

export default function FeedbackWidget({ conversationId, appId }: FeedbackWidgetProps) {
  const t = useTranslations()
  const [selectedRating, setSelectedRating] = useState<FeedbackRating | null>(null)
  const [comment, setComment] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isSubmitted, setIsSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inactivityTimerRef = useRef<NodeJS.Timeout | null>(null)

  const submitFeedback = async (rating: FeedbackRating, userComment: string) => {
    setIsSubmitting(true)
    setError(null)

    try {
      const rootDomain = getRootDomain()

      // Use mock on localhost/server-side, external API in production
      if (!rootDomain) {
        // Mock delay for localhost
        await new Promise(resolve => setTimeout(resolve, 500))
        setIsSubmitted(true)
        return
      }

      // Production: submit to external API
      const baseUrl = `https://api.companion.hub.${rootDomain}/v1/`

      const keys = ['rate-session-experience', 'comment-session-experience', 'conversation-id', 'app-id']
      const values: (string | undefined)[] = [rating, userComment.trim() || '', conversationId || '', appId || '']

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

  const handleRatingSelect = async (rating: FeedbackRating) => {
    if (isSubmitting || isSubmitted) return

    setSelectedRating(rating)

    // If Good, submit immediately without comment field
    if (rating === FeedbackRating.Good) {
      await submitFeedback(rating, '')
    }
    // If Bad or Fine, show comment field and wait for user input
  }

  const handleCommentChange = (value: string) => {
    setComment(value)

    // Clear existing timer when user types
    if (inactivityTimerRef.current) {
      clearTimeout(inactivityTimerRef.current)
      inactivityTimerRef.current = null
    }
  }

  const handleCommentInput = (value: string) => {
    handleCommentChange(value)
  }

  const handleCommentBlur = () => {
    // Start 5-second inactivity timer when field loses focus
    if (selectedRating && !isSubmitting && !isSubmitted) {
      inactivityTimerRef.current = setTimeout(() => {
        submitFeedback(selectedRating, comment)
      }, 5000)
    }
  }

  const handleCommentFocus = () => {
    // Clear inactivity timer when user focuses back on field
    if (inactivityTimerRef.current) {
      clearTimeout(inactivityTimerRef.current)
      inactivityTimerRef.current = null
    }
  }

  const handleCommentKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && selectedRating && !isSubmitting) {
      // Clear any pending timer
      if (inactivityTimerRef.current) {
        clearTimeout(inactivityTimerRef.current)
        inactivityTimerRef.current = null
      }
      // Submit immediately
      submitFeedback(selectedRating, comment)
    }
  }

  const handleSkip = () => {
    setIsSubmitted(true)
  }

  if (isSubmitted && !error) {
    return (
      <div className="flex flex-col gap-2 p-3 border border-intents-ux-border-borderColor rounded-sm my-2 bg-intents-ux-boxLowContrast-backgroundColor">
        <text.p
          size={-1}
          className="text-intents-ux-feedbackHighContrastSuccess-feedbackColor text-center"
        >
          {selectedRating ? t('builder_widgets_feedback_thank_you') : t('builder_widgets_feedback_skipped')}
        </text.p>
      </div>
    )
  }

  const showCommentField = selectedRating && (selectedRating === FeedbackRating.Bad || selectedRating === FeedbackRating.Fine) && !isSubmitted

  return (
    <div className="flex flex-col gap-1 p-2 bg-intents-ux-boxLowContrast-backgroundColor border border-intents-ux-border-borderColor rounded-sm my-2">
      <text.p size={0} className="!m-0">
        {t('builder_widgets_feedback_header')}
      </text.p>
      <text.p size={-1} className="text-intents-ux-textSubtle-textColor !mb-1">
        {t('builder_widgets_feedback_subtext')}
      </text.p>

      {error && (
        <div className="p-2 bg-intents-ux-error-backgroundColor rounded-sm">
          <text.span size={-2} className="text-intents-ux-error-textColor">
            {error}
          </text.span>
        </div>
      )}

      <div className="flex gap-2 items-center">
        <div className="flex gap-2 flex-1">
          {RATING_OPTIONS.map(({ rating, emoji, labelKey }) => (
            <Button
              key={rating}
              design={selectedRating === rating ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => handleRatingSelect(rating)}
              disabled={isSubmitting || !!selectedRating}
              text={`${emoji} ${t(labelKey)}`}
            />
          ))}
        </div>

        {!selectedRating && (
          <Button
            design="secondary"
            size="sm"
            onClick={handleSkip}
            disabled={isSubmitting || isSubmitted}
            text={t('builder_widgets_feedback_skip')}
          />
        )}
      </div>

      {showCommentField && (
        <div className="mt-2">
          <TextInput
            label={null}
            value={comment}
            onChange={handleCommentInput}
            onBlur={handleCommentBlur}
            onFocus={handleCommentFocus}
            onKeyDown={handleCommentKeyDown}
            placeholder={t('builder_widgets_feedback_comment_placeholder')}
            disabled={isSubmitting}
          />
        </div>
      )}

      {isSubmitting && (
        <text.span size={-2} className="text-intents-ux-textSubtle-textColor text-center">
          {t('builder_widgets_feedback_submitting')}
        </text.span>
      )}
    </div>
  )
}
