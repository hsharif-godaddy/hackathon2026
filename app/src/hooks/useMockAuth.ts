'use client'

/**
 * Client-side React hook for mock authentication
 * This file is marked as 'use client' to allow React hooks
 */

import { useState, useEffect } from 'react'
import { mockAuthManager, type MockAuthState } from '@/lib/mock-auth'

// React hook for components to use mock auth
export function useMockAuth() {
  const [state, setState] = useState<MockAuthState>(mockAuthManager.getState())
  
  useEffect(() => {
    return mockAuthManager.subscribe(setState)
  }, [])
  
  return {
    ...state,
    login: mockAuthManager.login.bind(mockAuthManager),
    logout: mockAuthManager.logout.bind(mockAuthManager),
    quickLogin: mockAuthManager.quickLogin.bind(mockAuthManager)
  }
}