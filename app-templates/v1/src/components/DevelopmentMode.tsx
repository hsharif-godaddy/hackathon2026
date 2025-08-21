'use client'

import { useDevelopmentMode } from '../hooks/useDevelopmentMode'
import ElementEditor from './ElementEditor'

export default function DevelopmentMode() {
  const { 
    isEnabled, 
    isSelectMode, 
    selectedElement, 
    showEditor, 
    editorPosition,
    clearSelection 
  } = useDevelopmentMode()

  if (!isEnabled) return null

  return (
    <>
      {/* Development Mode Indicator */}
      {isSelectMode && (
        <div 
          style={{
            position: 'fixed',
            top: '20px',
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
            color: 'white',
            padding: '12px 20px',
            borderRadius: '25px',
            fontSize: '14px',
            fontWeight: '600',
            zIndex: 10000,
            pointerEvents: 'none',
            fontFamily: 'system-ui, -apple-system, sans-serif',
            boxShadow: '0 4px 15px rgba(0, 0, 0, 0.2)',
            border: '2px solid rgba(255, 255, 255, 0.1)'
          }}
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
        _onStyleApply={(styles) => {
          // Style applied successfully
          void styles
        }}
      />
    </>
  )
}
