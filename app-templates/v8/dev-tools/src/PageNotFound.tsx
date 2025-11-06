import React from 'react';
import { useLocation } from 'react-router-dom';
import { safePostMessage } from './utils/postMessage';

/**
 * Send message to parent window to build this page
 *
 * @param path - The path that doesn't exist
 */
const sendBuildPageRequest = (path: string) => {
    console.log('Sending build page request to parent:', path);
    try {
      // Use the secure postMessage utility from dev-tools
      safePostMessage(window.parent, {
        type: 'build-page-request',
        pathToBuild: path
      });
      console.log('Build page request sent to parent window via secure postMessage');
    } catch (err) {
      console.error('Failed to send build page request to parent:', err);
    }
  };

/**
 * Development mode 404 - shows "Build this page" option
 */
function DevelopmentNotFound({ path }: { path: string }) {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#ffffff',
        padding: '1rem',
      }}
    >
      <div
        style={{
          maxWidth: '56rem',
          margin: '0 auto',
          textAlign: 'center',
        }}
      >
        <h1
          style={{
            fontSize: '1.5rem',
            fontWeight: 'bold',
            color: '#dc2626',
            marginBottom: '1rem',
          }}
        >
          Page doesn't exist
        </h1>

        <pre
          style={{
            color: '#6b7280',
            marginBottom: '1.5rem',
            backgroundColor: '#f3f4f6',
            padding: '1rem',
            borderRadius: '0.375rem',
            fontSize: '0.875rem',
            whiteSpace: 'pre-wrap',
            textAlign: 'left',
            maxWidth: '100%',
            fontFamily: 'monospace',
          }}
        >
          {`The page "${path}" hasn't been created yet.\n\nYou can ask Airo to build this page for you.`}
        </pre>

        <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', flexWrap: 'wrap' }}>
          <button
            onClick={() => sendBuildPageRequest(path)}
            style={{
              backgroundColor: '#6b46c1',
              color: 'white',
              padding: '0.5rem 1rem',
              borderRadius: '0.375rem',
              border: 'none',
              cursor: 'pointer',
              transition: 'background-color 0.2s ease-in-out',
              fontSize: '0.875rem',
              fontWeight: '500',
            }}
            onMouseEnter={(e: React.MouseEvent<HTMLButtonElement>) => {
              e.currentTarget.style.backgroundColor = '#5a32b0';
            }}
            onMouseLeave={(e: React.MouseEvent<HTMLButtonElement>) => {
              e.currentTarget.style.backgroundColor = '#6b46c1';
            }}
          >
            Build this page
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * 404 Not Found page component
 *
 * Shows a "Build this page" option to ask Airo to create the page
 * The layout (header/footer) is handled by RootLayout in App.tsx.
 */
export default function NotFoundPage() {
  // Use React Router's useLocation to get current path reactively
  const location = useLocation();

  return <DevelopmentNotFound path={location.pathname} />;
}
