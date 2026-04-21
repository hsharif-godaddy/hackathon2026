'use client'

import { usePathname } from 'next/navigation'
import { useEffect } from 'react'

import { useAuthContext } from '@/components/providers/AuthProvider'
import { JourneyTracker } from '@/lib/journeyTracker'

export default function JourneyTrackerInit() {
  const pathname = usePathname()

  useEffect(function init() {
    if (typeof window === 'undefined') return
    JourneyTracker.start({})
    return () => JourneyTracker.stop()
  }, [])

  useEffect(function syncPage() {
    if (pathname) {
      JourneyTracker.current()?.setPage(pathname)
    }
  }, [pathname])

  return null
}

export function JourneyTrackerAuth() {
  const { getUserInfo } = useAuthContext()
  const customerId = getUserInfo()?.customerId

  useEffect(function syncCustomerId() {
    if (customerId) {
      JourneyTracker.setCustomerId(String(customerId))
    }
  }, [customerId])

  return null
}
