import { ReactNode, useEffect } from 'react'
import DevelopmentMode from './components/DevelopmentMode'

interface DevToolsProviderProps {
  children: ReactNode
}

/**
 * Provider component that wraps the entire app to include dev tools
 * Only renders dev tools in development mode
 */
export default function DevToolsProvider({ children }: DevToolsProviderProps) {
  useEffect(() => {
    // Only in development
    if (import.meta.env.MODE === 'development') {
      console.log('🎨 Airo Dev Tools activated! Press Ctrl/Cmd + Shift + E to start editing.')
      console.log('🔧 DevToolsProvider mounted successfully')
      
      // Add global keyboard shortcut to toggle select mode
      const handleKeydown = (e: KeyboardEvent) => {
        console.log('🔧 Key pressed:', e.key, 'Ctrl:', e.ctrlKey, 'Meta:', e.metaKey, 'Shift:', e.shiftKey)
        
        // Ctrl/Cmd + Shift + E to toggle select mode
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'E') {
          console.log('🎯 Dev tools shortcut triggered!')
          e.preventDefault()
          // Dispatch custom event that the DevelopmentMode component can listen for
          window.dispatchEvent(new CustomEvent('toggleDevSelectMode'))
        }
      }

      document.addEventListener('keydown', handleKeydown)
      console.log('🔧 Keyboard listener attached')
      
      return () => {
        console.log('🔧 DevToolsProvider unmounting, removing keyboard listener')
        document.removeEventListener('keydown', handleKeydown)
      }
    }
  }, [])

  console.log('🔧 DevToolsProvider rendering, development mode:', import.meta.env.MODE === 'development')

  return (
    <>
      {children}
      {import.meta.env.MODE === 'development' && (
        <>
          {console.log('🔧 About to render DevelopmentMode component')}
          <DevelopmentMode />
        </>
      )}
    </>
  )
}
