import React, { Component, ReactNode } from 'react';
import { injectDevToolsStyles } from './utils/injectDevToolsStyles';
import { safePostMessage } from './utils/postMessage';
import type { RuntimeErrorData } from './types';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
  isFixing: boolean;
}

export default class AiroErrorBoundary extends Component<Props, State> {
  state: State = { error: null, errorInfo: null, isFixing: false };
  private hmrAfterUpdateHandler?: () => void;

  componentDidMount() {
    injectDevToolsStyles();
    // Reset error state on HMR updates so fixed code can render
    if (import.meta.hot) {
      this.hmrAfterUpdateHandler = () => {
        if (this.state.error) {
          this.setState({ error: null, errorInfo: null, isFixing: false });
          safePostMessage(window.parent, { type: 'error-fix-resolved' });
        }
      };
      import.meta.hot.on('vite:afterUpdate', this.hmrAfterUpdateHandler);
    }
  }

  componentWillUnmount() {
    // Clean up HMR listener to prevent memory leaks
    if (import.meta.hot && this.hmrAfterUpdateHandler) {
      import.meta.hot.off('vite:afterUpdate', this.hmrAfterUpdateHandler);
    }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('Error caught by AiroErrorBoundary:', error, errorInfo);
    this.setState({ error, errorInfo, isFixing: false });
  }

  private handleAskAiroToFix = () => {
    const { error, errorInfo, isFixing } = this.state;

    if (isFixing) return;

    if (!error) {
      console.error('handleAskAiroToFix called with no error in state');
      return;
    }

    this.setState({ isFixing: true });

    const errorData: RuntimeErrorData = {
      message: error.message || 'An unexpected error occurred',
      name: error.name || 'Error',
      stack: error.stack ?? undefined,
      componentStack: errorInfo?.componentStack ?? undefined,
      url: window.location.href,
      timestamp: Date.now(),
    };

    console.log('Sending runtime error to parent from AiroErrorBoundary:', errorData);
    try {
      safePostMessage(window.parent, {
        type: 'error-fix-request',
        errorData,
      });
    } catch (err) {
      console.error('Failed to send message to parent from AiroErrorBoundary:', err);
      this.setState({ isFixing: false });
    }
  };

  render() {
    const { error } = this.state;
    if (error) {
      return (
        <div
          data-airo-dev-tools
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
