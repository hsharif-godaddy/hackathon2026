'use client'

import { useEffect, useRef } from 'react'

import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
import type { SocialPostData } from '@/types/social-posts'
import { emitPostUpdated } from '@/utils/social/events'
import DefaultToolRenderer, { type DefaultToolRendererProps } from './DefaultToolRenderer'

interface SocialPostEditResult {
  success?: boolean
  post?: {
    id?: string
    rawContent?: unknown
  }
}

interface SocialPostRawContent {
  message?: string
  hashtags?: string[]
  callToAction?: string
  imageUrls?: string[]
}

export function parseRawContent(rawContent: unknown): SocialPostRawContent {
  if (!rawContent) return {}
  if (typeof rawContent === 'string') {
    try {
      return JSON.parse(rawContent) as SocialPostRawContent
    } catch {
      return {}
    }
  }
  if (typeof rawContent === 'object') {
    return rawContent as SocialPostRawContent
  }
  return {}
}

export function buildUpdatedPost(post: SocialPostData, rawContent: SocialPostRawContent): SocialPostData {
  return {
    ...post,
    ...(rawContent.message !== undefined ? { content: rawContent.message } : {}),
    ...(rawContent.hashtags !== undefined ? { hashtags: rawContent.hashtags } : {}),
    ...(rawContent.callToAction !== undefined ? { callToAction: rawContent.callToAction } : {}),
    ...(rawContent.imageUrls !== undefined
      ? {
          images: rawContent.imageUrls.map((url) => ({ url, width: 1024, height: 1024 })),
        }
      : {}),
  }
}

export function buildApplyKey(result: SocialPostEditResult): string | null {
  if (!result.post?.id) return null
  const rawContent = result.post.rawContent
  if (rawContent === undefined) return `${result.post.id}:no-raw`
  if (typeof rawContent === 'string') return `${result.post.id}:${rawContent}`
  try {
    return `${result.post.id}:${JSON.stringify(rawContent)}`
  } catch {
    return `${result.post.id}:unserializable-raw`
  }
}

function parseResult(result: DefaultToolRendererProps['result']): SocialPostEditResult | null {
  if (!result) return null
  if (typeof result === 'string') {
    try {
      return JSON.parse(result) as SocialPostEditResult
    } catch {
      return null
    }
  }
  return result as SocialPostEditResult
}

export default function SocialPostEditToolRenderer(props: DefaultToolRendererProps) {
  const selectedSocialPost = useDevelopPageStore((state) => state.selectedSocialPost)
  const marketingSocialOrigin = useDevelopPageStore((state) => state.marketingSocialOrigin)
  const showMarketingSocialPost = useDevelopPageStore((state) => state.showMarketingSocialPost)
  const lastAppliedRef = useRef<string | null>(null)

  useEffect(() => {
    if (
      props.isLastAssistantMessage !== true
      || props.toolStatus !== 'completed'
      || !selectedSocialPost
      || !marketingSocialOrigin
    ) {
      return
    }

    const result = parseResult(props.result)
    const targetId = selectedSocialPost.campaignContentId ?? selectedSocialPost.id
    if (!result?.post?.id || !targetId) return
    if (result.success === false) return
    if (result.post.id !== targetId) return
    const applyKey = buildApplyKey(result)
    if (!applyKey) return
    const signature = `${props.toolId ?? 'tool-missing'}:${applyKey}`
    if (lastAppliedRef.current === signature) return

    const rawContent = parseRawContent(result.post.rawContent)
    const updatedPost = buildUpdatedPost(selectedSocialPost, rawContent)
    showMarketingSocialPost(updatedPost, marketingSocialOrigin)
    emitPostUpdated(updatedPost)
    lastAppliedRef.current = signature
  }, [
    props.isLastAssistantMessage,
    marketingSocialOrigin,
    props.result,
    props.toolStatus,
    props.toolId,
    selectedSocialPost,
    showMarketingSocialPost,
  ])

  return <DefaultToolRenderer {...props} />
}
