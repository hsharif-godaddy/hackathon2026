/**
 * Mock authentication system for local development
 * Provides a realistic login flow without requiring actual SSO
 * Core manager - safe for server-side import
 */

interface MockUser {
  id: string
  email: string
  name: string
  plan: string
  avatar?: string
}

interface MockAuthState {
  isAuthenticated: boolean
  user: MockUser | null
  isLoading: boolean
}

// Single mock user for simplified development testing
const MOCK_USER: MockUser = {
  id: 'dev-user-123',
  email: 'developer@example.com',
  name: 'Dev User',
  plan: 'Free',
  avatar: '👨‍💻'
}

class MockAuthManager {
  private state: MockAuthState = {
    isAuthenticated: false,
    user: null,
    isLoading: false
  }
  
  private listeners: Set<(state: MockAuthState) => void> = new Set()
  
  constructor() {
    // Check if user was previously logged in (persisted in localStorage)
    if (typeof window !== 'undefined') {
      const savedUser = localStorage.getItem('mockAuth_user')
      if (savedUser) {
        try {
          this.state = {
            isAuthenticated: true,
            user: JSON.parse(savedUser),
            isLoading: false
          }
        } catch {
          // Invalid saved data, clear it
          localStorage.removeItem('mockAuth_user')
        }
      }
    }
  }
  
  // Subscribe to auth state changes
  subscribe(listener: (state: MockAuthState) => void) {
    this.listeners.add(listener)
    // Immediately call with current state
    listener(this.state)
    
    // Return unsubscribe function
    return () => {
      this.listeners.delete(listener)
    }
  }
  
  // Get current auth state
  getState(): MockAuthState {
    return { ...this.state }
  }
  
  // Simulate login process
  async login(): Promise<void> {
    this.setState({ isLoading: true })
    
    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, 1000))
    
    this.setState({
      isAuthenticated: true,
      user: MOCK_USER,
      isLoading: false
    })
    
    // Persist login state
    if (typeof window !== 'undefined') {
      localStorage.setItem('mockAuth_user', JSON.stringify(MOCK_USER))
    }
    
    console.log('🔧 Mock login successful:', MOCK_USER.name, `(${MOCK_USER.email})`)
  }
  
  // Simulate logout process
  async logout(): Promise<void> {
    this.setState({ isLoading: true })
    
    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, 500))
    
    this.setState({
      isAuthenticated: false,
      user: null,
      isLoading: false
    })
    
    // Clear persisted state
    if (typeof window !== 'undefined') {
      localStorage.removeItem('mockAuth_user')
    }
    
    console.log('🔧 Mock logout successful')
  }
  
  // Quick login (same as regular login now)
  async quickLogin(): Promise<void> {
    return this.login()
  }
  
  private setState(newState: Partial<MockAuthState>) {
    this.state = { ...this.state, ...newState }
    this.listeners.forEach(listener => listener(this.state))
  }
}

// Export singleton instance
export const mockAuthManager = new MockAuthManager()

// Export mock user for UI
export { MOCK_USER, type MockUser, type MockAuthState }

