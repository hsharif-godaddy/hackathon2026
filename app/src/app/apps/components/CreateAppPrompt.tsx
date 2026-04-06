'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'
import Alert from '@ux/alert'
import Box from '@ux/box'
import Button from '@ux/button'
import SendIcon from '@ux/icon/send'
import Spinner from '@ux/spinner'
import { text } from '@ux/text'

import { useBreakpoints } from '@/hooks/useBreakpoints'
import { useQuickCreate } from '@/hooks/useQuickCreate'
import { useSsoSignIn } from '@/hooks/useSsoSignIn'
import { useTranslations } from '@/hooks/useTranslations'
import { logger } from '@/lib/request-context'

export default function CreateAppPrompt() {
  const t = useTranslations()
  const router = useRouter()
  const searchParams = useSearchParams()
  const { create, isLoading, error, clearError } = useQuickCreate()
  const { signIn } = useSsoSignIn()
  const [prompt, setPrompt] = useState('')
  const [animatedPlaceholder, setAnimatedPlaceholder] = useState('')
  const placeholderTimerRef = useRef<NodeJS.Timeout | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const { isBelowSmBreakpoint } = useBreakpoints()

  useEffect(() => {
    if (searchParams.get('create') === 'true' && textareaRef.current) {
      textareaRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
      textareaRef.current.focus({ preventScroll: true })
    }
  }, [searchParams])

  const isSafari = useMemo(() => {
    if (typeof window === 'undefined') return false
    return /^((?!chrome|android).)*safari/i.test(navigator.userAgent)
  }, [])

  const placeholders = useMemo(() => {
    if (isBelowSmBreakpoint) {
      return [
        t('builder_homepage_placeholder_mobile_1'),
        t('builder_homepage_placeholder_mobile_2'),
        t('builder_homepage_placeholder_mobile_3'),
      ]
    }
    return [
      t('builder_homepage_placeholder_1'),
      t('builder_homepage_placeholder_2'),
      t('builder_homepage_placeholder_3'),
      t('builder_homepage_placeholder_4'),
      t('builder_homepage_placeholder_5'),
    ].sort(() => Math.random() - 0.5)
  }, [isBelowSmBreakpoint, t])

  useEffect(() => {
    if (prompt.trim().length > 0) {
      setAnimatedPlaceholder('')
      return
    }

    if (isSafari) {
      setAnimatedPlaceholder(placeholders[0])
      return
    }

    let currentIndex = 0
    let currentCharIndex = 0
    let isDeleting = false

    function animate() {
      const currentText = placeholders[currentIndex]

      if (!isDeleting) {
        if (currentCharIndex <= currentText.length) {
          setAnimatedPlaceholder(currentText.slice(0, currentCharIndex))
          currentCharIndex++
          placeholderTimerRef.current = setTimeout(animate, 50)
        } else {
          placeholderTimerRef.current = setTimeout(() => {
            isDeleting = true
            animate()
          }, 2000)
        }
      } else {
        if (currentCharIndex > 0) {
          currentCharIndex--
          setAnimatedPlaceholder(currentText.slice(0, currentCharIndex))
          placeholderTimerRef.current = setTimeout(animate, 30)
        } else {
          isDeleting = false
          currentIndex = (currentIndex + 1) % placeholders.length
          currentCharIndex = 0
          placeholderTimerRef.current = setTimeout(animate, 500)
        }
      }
    }

    animate()

    return () => {
      if (placeholderTimerRef.current) {
        clearTimeout(placeholderTimerRef.current)
      }
    }
  }, [prompt, isSafari, placeholders])

  useEffect(() => {
    return () => {
      if (placeholderTimerRef.current) {
        clearTimeout(placeholderTimerRef.current)
      }
    }
  }, [])

  async function handleSubmit() {
    if (!prompt.trim() || isLoading) return

    try {
      const result = await create(prompt)
      if (result) {
        router.push(result.redirectUrl)
      }
    } catch (err) {
      if (err instanceof Error && err.message === 'AUTH_REQUIRED') {
        signIn()
        return
      }
      logger.error('create-app-prompt.submit.unexpected', {
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  return (
    <div className="flex flex-col items-center gap-4 py-8 md:py-12 mb-6">
      <text.h2
        as="heading"
        size={3}
        className="text-center"
      >
        {t('builder_apps_what_to_build', undefined, 'What do you want to build?')}
      </text.h2>

      <div className="w-full max-w-2xl">
        <Box
          className="relative rounded-2xl! border border-intents-ux-boxHighContrast-borderColor overflow-hidden"
          elevation="float"
        >
          <textarea
            ref={textareaRef}
            data-testid="create-app-prompt-input"
            value={prompt}
            onChange={(e) => {
              setPrompt(e.target.value)
              if (error) clearError()
            }}
            onKeyDown={handleKeyDown}
            placeholder={animatedPlaceholder}
            rows={3}
            disabled={isLoading}
            className="w-full resize-none border-0 bg-transparent px-4 pt-3 pb-10 text-base focus:ring-0 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
          />
          <div className="absolute bottom-2 right-2">
            <Button
              data-testid="create-app-prompt-submit"
              onClick={handleSubmit}
              disabled={!prompt.trim() || isLoading}
              design="primary"
              className="!rounded-full aspect-square !border-none"
              icon={isLoading ? <Spinner size="sm" /> : <SendIcon />}
              aria-label={t('builder_homepage_hero_prompt_button', undefined, 'Start building')}
              size="sm"
            />
          </div>
        </Box>

        {error && (
          <div className="mt-2">
            <Alert
              emphasis="critical"
              title={t('builder_status_error', undefined, 'Error')}
              actions={<Button text={t('builder_common_dismiss', undefined, 'Dismiss')} onClick={clearError} />}
            >
              {error}
            </Alert>
          </div>
        )}
      </div>
    </div>
  )
}
