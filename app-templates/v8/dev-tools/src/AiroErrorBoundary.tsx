import React, { Component, ReactNode } from 'react';
import { safePostMessage } from './utils/postMessage';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export default class AiroErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('Error caught by AiroErrorBoundary:', error, errorInfo);
    this.setState({ error });
  }

  private handleAskAiroToFix = () => {
    const { error } = this.state;
    const message = error?.message || 'An unexpected error occurred';
    const errorMessage = `Runtime Error: ${message}`;

    console.log('Sending runtime error to parent from AiroErrorBoundary:', errorMessage);
    try {
      safePostMessage(window.parent, {
        type: 'error-fix-request',
        errorMessage,
      });
    } catch (err) {
      console.error('Failed to send message to parent from AiroErrorBoundary:', err);
    }
  };

  render() {
    const { error } = this.state;
    if (error) {
      return (
        <div
          style={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: '#ffffff',
          }}
        >
          <div
            style={{
              maxWidth: '28rem',
              margin: '0 auto',
              textAlign: 'center',
              padding: '0 1rem',
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
              Something went wrong
            </h1>
            <p
              style={{
                color: '#6b7280',
                marginBottom: '1.5rem',
                maxHeight: '400px',
                overflowY: 'scroll',
              }}
            >
              {error.message}
            </p>
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <button
                onClick={this.handleAskAiroToFix}
                style={{
                  backgroundColor: '#6b46c1',
                  color: 'white',
                  padding: '0.5rem 1rem',
                  borderRadius: '0.375rem',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: '0.875rem',
                  fontWeight: 500,
                }}
              >
                Ask Airo to Fix Code
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children as React.ReactElement;
  }
}
