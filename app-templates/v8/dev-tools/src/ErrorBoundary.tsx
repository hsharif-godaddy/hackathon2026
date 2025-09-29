import React from 'react';
import { safePostMessage } from './utils/postMessage';

interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ComponentType<{ error: Error; reset: () => void }>;
}

/**
 * Send error message to parent window using secure postMessage utility
 * 
 * @param errorMessage - The error message to send to parent for fixing
 */
const sendMessageToParent = (errorMessage: string) => {
  console.log('Sending error message to parent:', errorMessage);
  try {
    // Use the secure postMessage utility from dev-tools
    safePostMessage(window.parent, {
      type: 'error-fix-request',
      errorMessage: errorMessage
    });
    console.log('Message sent to parent window via secure postMessage');
  } catch (err) {
    console.error('Failed to send message to parent:', err);
  }
};

const DefaultErrorFallback = ({ error, reset }: { error: Error; reset: () => void }) => {
  // Determine error type based on error name and message
  const isCompileError = error.name?.includes('Error') && (
    error.name.includes('Compile') || 
    error.name.includes('Syntax') || 
    error.name.includes('Import') ||
    error.message.includes('SyntaxError') ||
    error.message.includes('Module not found') ||
    error.message.includes('Cannot resolve')
  );

  const handleAskAiroToFix = () => {
    const errorType = isCompileError ? 'Compilation Error' : 'Runtime Error';
    const errorMessage = `${errorType}: ${error.message || 'An unexpected error occurred'}`;
    
    // Include more context for compile errors
    if (isCompileError && error.stack) {
      const context = error.stack.split('\n').slice(0, 3).join('\n');
      sendMessageToParent(`${errorMessage}\n\nContext:\n${context}`);
    } else {
      sendMessageToParent(errorMessage);
    }
  };

  return (
    <div style={{ 
      minHeight: '100vh', 
      display: 'flex', 
      alignItems: 'center', 
      justifyContent: 'center', 
      backgroundColor: '#ffffff' 
    }}>
      <div style={{ 
        maxWidth: '28rem', 
        margin: '0 auto', 
        textAlign: 'center',
        padding: '0 1rem'
      }}>
        <h1 style={{ 
          fontSize: '1.5rem', 
          fontWeight: 'bold', 
          color: '#dc2626', 
          marginBottom: '1rem' 
        }}>
          Something went wrong
        </h1>
        <p style={{ 
          color: '#6b7280', 
          marginBottom: '1.5rem' 
        }}>
          {error.message}
        </p>
        <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', flexWrap: 'wrap' }}>
          <button
            onClick={handleAskAiroToFix}
            style={{
              backgroundColor: '#6b46c1',
              color: 'white',
              padding: '0.5rem 1rem',
              borderRadius: '0.375rem',
              border: 'none',
              cursor: 'pointer',
              transition: 'background-color 0.2s ease-in-out',
              fontSize: '0.875rem',
              fontWeight: '500'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = '#5a32b0';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = '#6b46c1';
            }}
          >
            Ask Airo to fix
          </button>
        </div>
      </div>
    </div>
  );
};

export default class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('Error caught by ErrorBoundary:', error, errorInfo);
  }

  render() {
    if (this.state.hasError && this.state.error) {
      const FallbackComponent = this.props.fallback || DefaultErrorFallback;
      return (
        <FallbackComponent
          error={this.state.error}
          reset={() => this.setState({ hasError: false, error: undefined })}
        />
      );
    }

    return this.props.children;
  }
}
