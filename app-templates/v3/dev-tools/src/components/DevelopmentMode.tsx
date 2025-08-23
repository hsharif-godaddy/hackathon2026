import { useDevelopmentMode } from '../hooks/useDevelopmentMode'
import { useState } from 'react'
import ElementEditor from './ElementEditor'

export default function DevelopmentMode() {
  const { 
    isEnabled, 
    isSelectMode, 
    selectedElement, 
    showEditor, 
    editorPosition,
    clearSelection,
    toggleSelectMode 
  } = useDevelopmentMode()

  // State to control indicator visibility on hover
  const [isIndicatorHovered, setIsIndicatorHovered] = useState(false)

  // Check if floating button should be visible via environment variable
  const showFloatingButton = import.meta.env.VITE_SHOW_DEV_TOOLS === 'true'
  
  if (!isEnabled) {
    return null
  }

  return (
    <>
      {/* Development Mode Floating Button - Only show if environment variable is set */}
      {showFloatingButton && (
        <button
        data-dev-tools="floating-button"
        onClick={() => {
          toggleSelectMode()
        }}
        style={{
          position: 'fixed',
          bottom: '20px',
          left: '20px',
          width: '60px',
          height: '60px',
          borderRadius: '50%',
          background: isSelectMode 
            ? 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)' 
            : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
          color: 'white',
          border: '3px solid rgba(255, 255, 255, 0.2)',
          boxShadow: '0 4px 20px rgba(0, 0, 0, 0.3)',
          cursor: 'pointer',
          zIndex: 999999,
          fontSize: '24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          transition: 'all 0.2s ease',
          pointerEvents: 'auto'
        }}
        onMouseOver={(e) => {
          e.currentTarget.style.transform = 'scale(1.1)'
        }}
        onMouseOut={(e) => {
          e.currentTarget.style.transform = 'scale(1)'
        }}
        title={isSelectMode ? 'Exit selection mode' : 'Enter selection mode (Dev Tools)'}
        >
          {isSelectMode ? '✕' : '🎨'}
        </button>
      )}

      {/* Development Mode Indicator */}
      {isSelectMode && (
        <div 
          data-dev-tools="indicator"
          onMouseEnter={() => setIsIndicatorHovered(true)}
          onMouseLeave={() => setIsIndicatorHovered(false)}
          style={{
            position: 'fixed',
            top: '20px',
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'rgba(102, 126, 234, 0.95)',
            backdropFilter: 'blur(10px)',
            color: 'white',
            padding: '12px 20px',
            borderRadius: '25px',
            fontSize: '14px',
            fontWeight: '600',
            zIndex: 999998,
            pointerEvents: 'auto',
            fontFamily: 'system-ui, -apple-system, sans-serif',
            boxShadow: '0 4px 15px rgba(0, 0, 0, 0.2)',
            border: '2px solid rgba(255, 255, 255, 0.1)',
            opacity: isIndicatorHovered ? 0 : 1,
            transition: 'opacity 0.2s ease',
            cursor: 'pointer'
          }}
          title="Hover to temporarily hide this indicator"
        >
          🎯 Click any element to edit its styles
        </div>
      )}

      {/* Element Editor */}
      <ElementEditor
        isOpen={showEditor}
        onClose={clearSelection}
        position={editorPosition}
        selectedElement={selectedElement}
      />
    </>
  )
}
