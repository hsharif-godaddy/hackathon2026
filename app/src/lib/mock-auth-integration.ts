/**
 * Integration layer between mock authentication and GoDaddy auth system
 * This makes the existing auth checks work with mock authentication
 */

import { useEffect,useState } from 'react'

import { isFeatureEnabled } from '@/lib/features'
import { MOCK_USER,mockAuthManager } from '@/lib/mock-auth'

/**
 * Mock auth state that mimics GoDaddy's useAuthState return type
 */
export interface MockAuthState {
  valid: boolean
  details?: {
    shopperId?: string
    cid?: string
    email?: string
    name?: string
  }
}

/**
 * Creates a mock auth state that looks like GoDaddy's auth state
 * when mock login is enabled and user is authenticated
 */
export function createMockAuthState(): MockAuthState {
  const mockAuth = mockAuthManager.getState()
  
  if (!isFeatureEnabled.mockLogin()) {
    // Mock login disabled, return invalid state (let real auth handle it)
    return { valid: false }
  }
  
  if (!mockAuth.isAuthenticated || !mockAuth.user) {
    // Mock login enabled but user not authenticated
    return { valid: false }
  }
  
  // Mock login enabled and user is authenticated
  return {
    valid: true,
    details: {
      shopperId: MOCK_USER.id,
      cid: MOCK_USER.id,
      email: MOCK_USER.email,
      name: MOCK_USER.name
    }
  }
}

/**
 * Hook that wraps GoDaddy's useAuthState and returns mock data when appropriate
 * This needs to be reactive to mock auth state changes
 */
export function useIntegratedAuthState(originalAuthState: any): MockAuthState {
  const [mockAuthState, setMockAuthState] = useState(mockAuthManager.getState())
  
  // Subscribe to mock auth state changes
  useEffect(() => {
    if (!isFeatureEnabled.mockLogin()) {
      return
    }
    
    return mockAuthManager.subscribe(setMockAuthState)
  }, [])
  
  if (!isFeatureEnabled.mockLogin()) {
    // Mock login disabled, return original auth state
    return originalAuthState
  }
  
  // Mock login enabled, use reactive mock auth state
  if (!mockAuthState.isAuthenticated || !mockAuthState.user) {
    return { valid: false }
  }
  
  // User is authenticated with mock auth
  return {
    valid: true,
    details: {
      shopperId: MOCK_USER.id,
      cid: MOCK_USER.id,
      email: MOCK_USER.email,
      name: MOCK_USER.name
    }
  }
}

/**
 * Check if user is authenticated (considering both real and mock auth)
 */
export function isUserAuthenticated(): boolean {
  if (!isFeatureEnabled.mockLogin()) {
    // Mock auth disabled, this function shouldn't be used
    // The calling code should use the original auth system
    return false
  }
  
  const mockAuth = mockAuthManager.getState()
  return mockAuth.isAuthenticated
}

/**
 * Get user details (considering both real and mock auth)
 */
export function getUserDetails() {
  if (!isFeatureEnabled.mockLogin()) {
    return null
  }
  
  const mockAuth = mockAuthManager.getState()
  if (!mockAuth.isAuthenticated || !mockAuth.user) {
    return null
  }
  
  return {
    shopperId: MOCK_USER.id,
    cid: MOCK_USER.id,
    email: MOCK_USER.email,
    name: MOCK_USER.name
  }
}