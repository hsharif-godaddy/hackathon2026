'use client'

import { useSearchParams } from 'next/navigation'
import { useEffect } from 'react'
import { validate as validateUUID } from 'uuid'

/**
 * Client-side component to store conversationId from URL in cookies
 *
 * Checks for conversationId in the URL query parameters and stores it
 * in a cookie when present. This allows the conversationId to persist
 * across page navigations and be accessible server-side.
 *
 * Validates that the conversationId is a valid UUID before storing
 * to prevent invalid or malicious values from being persisted.
 */
export default function ConversationIdCookie() {
  const searchParams = useSearchParams()

  useEffect(function storeConversationId() {
    if (typeof window === 'undefined') return

    const conversationId = searchParams.get('conversationId')
    if (conversationId && validateUUID(conversationId)) {
      // Set cookie with 1 year expiration
      const maxAge = 60 * 60 * 24 * 1
      document.cookie = `conversationId=${encodeURIComponent(conversationId)}; path=/; max-age=${maxAge}; SameSite=Lax`
    }
  }, [searchParams])

  return null
}
