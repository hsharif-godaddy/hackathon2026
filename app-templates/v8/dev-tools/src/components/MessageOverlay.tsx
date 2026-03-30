import React from 'react';

interface MessageOverlayProps {
  title: string;
  message: string;
  button: React.ReactNode;
}

function MessageOverlay({
  title,
  message,
  button
}: MessageOverlayProps) {
  return (
    <div
      data-airo-dev-tool
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.15)',
        backdropFilter: 'blur(2px)',
        zIndex: 9999998,
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '1rem',
          maxWidth: '40rem',
          textAlign: 'left',
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          backgroundColor: 'var(--color-surface)',
          padding: '2rem',
          borderRadius: '1rem',
          boxShadow: '0 0 10px 0 rgba(0, 0, 0, 0.1)',
          width: 'calc(100vw - 2em)',
        }}
      >
        <h1
          style={{
            fontSize: '1.5rem',
            fontWeight: '600',
            color: 'var(--color-text-primary)',
          }}
        >
          {title}
        </h1>

        <pre
          style={{
            color: 'var(--color-text-tertiary)',
            fontSize: '0.875rem',
            marginBottom: '1rem',
            whiteSpace: 'pre-wrap',
            fontFamily: 'inherit',
            margin: 0,
            lineHeight: '1.4',
          }}
        >
          {message}
        </pre>

        <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          {button}
        </div>
      </div>
    </div>
  )
}

export default MessageOverlay;
