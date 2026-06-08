'use client'

import { useReducedMotion } from 'framer-motion'
import { useEffect, useRef, useState } from 'react'

import { THINKING_TIPS } from '@/app/[market]/develop/components/chat/thinking-tips-content'
import { CARD_DWELL_MS } from '@/app/[market]/develop/components/tips/Tips'
import { shuffleArray } from '@/app/[market]/develop/components/tips/tips-content'
import { useSwitchboard } from '@/hooks/useSwitchboard'
import { useTranslations } from '@/hooks/useTranslations'

const SHOW_DELAY_MS = 1000
const TIP_FADE_MS = 300

export default function ThinkingTip() {
  const isThinkingTipsEnabled = useSwitchboard('appbuilder-thinking-tips') === true
  const prefersReducedMotion = useReducedMotion()
  const t = useTranslations()
  const [orderedTips] = useState<string[]>(() => shuffleArray(THINKING_TIPS))
  const [tipIndex, setTipIndex] = useState(0)
  const [visible, setVisible] = useState(false)
  const [tipVisible, setTipVisible] = useState(true)
  const fadeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(function show() {
    if (!isThinkingTipsEnabled) {
      return undefined
    }

    const timeoutId = setTimeout(() => {
      setVisible(true)
    }, SHOW_DELAY_MS)

    return () => {
      clearTimeout(timeoutId)
    }
  }, [isThinkingTipsEnabled])

  useEffect(function rotate() {
    if (!isThinkingTipsEnabled || !visible || orderedTips.length < 2) {
      return undefined
    }

    const intervalId = setInterval(function tick() {
      setTipVisible(false)
      if (fadeTimeoutRef.current) {
        clearTimeout(fadeTimeoutRef.current)
      }
      fadeTimeoutRef.current = setTimeout(function showNext() {
        setTipIndex(function advance(index) {
          return (index + 1) % orderedTips.length
        })
        setTipVisible(true)
      }, TIP_FADE_MS)
    }, CARD_DWELL_MS)

    return () => {
      clearInterval(intervalId)
      if (fadeTimeoutRef.current) {
        clearTimeout(fadeTimeoutRef.current)
      }
    }
  }, [isThinkingTipsEnabled, orderedTips.length, visible])

  const selectedKey = orderedTips[tipIndex] ?? ''
  if (!isThinkingTipsEnabled || !visible || !selectedKey) {
    return null
  }

  const tipLabel = t('builder_thinking_tip_label', undefined, 'Tip:')
  const tipText = t(selectedKey, undefined, '')

  return (
    <div
      className={`text-[13px] leading-relaxed ${prefersReducedMotion ? '' : 'transition-opacity duration-300'} ${visible ? 'opacity-100' : 'opacity-0'}`}
    >
      <div className="rounded-t-lg rounded-b-none bg-[var(--color-ai)]/5 px-2 py-1">
        <span className="font-medium text-[var(--color-ai)]">{tipLabel} </span>
        <span
          data-testid="thinking-tip-text"
          className={`text-intents-ux-textSubtle-textColor ${prefersReducedMotion ? '' : 'transition-opacity duration-300'} ${tipVisible ? 'opacity-100' : 'opacity-0'}`}
        >
          {tipText}
        </span>
      </div>
    </div>
  )
}
