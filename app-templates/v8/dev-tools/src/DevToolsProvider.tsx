import { ReactNode, useEffect } from 'react'
import DevelopmentMode from './components/DevelopmentMode'
import { injectDevToolsStyles } from './utils/injectDevToolsStyles'

interface DevToolsProviderProps {
  children: ReactNode
}

/**
 * Provider component that wraps the entire app to include dev tools
 * Only renders dev tools in development mode
 */
export default function DevToolsProvider({ children }: DevToolsProviderProps) {
  useEffect(() => {
    injectDevToolsStyles();
    // Only in development
    if (import.meta.env.MODE === 'development') {
      console.log('🎨 Airo Dev Tools activated! Press Ctrl/Cmd + Shift + E to start editing.')

      
      // Add global keyboard shortcut to toggle select mode
      const handleKeydown = (e: KeyboardEvent) => {
        console.log('🔧 Key pressed:', e.key, 'Ctrl:', e.ctrlKey, 'Meta:', e.metaKey, 'Shift:', e.shiftKey)
        
        // Ctrl/Cmd + Shift + E to toggle select mode
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'E') {
          e.preventDefault()
          // Dispatch custom event that the DevelopmentMode component can listen for
          window.dispatchEvent(new CustomEvent('toggleDevSelectMode'))
        }
      }

      document.addEventListener('keydown', handleKeydown)

      return () => {
        document.removeEventListener('keydown', handleKeydown)
      }
    }
  }, [])

  return (
    <>
      {children}
      {import.meta.env.MODE === 'development' && <DevelopmentMode />}
    </>
  )
}
