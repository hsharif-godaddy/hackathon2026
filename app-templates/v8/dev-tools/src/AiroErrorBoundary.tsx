import React, { Component, ReactNode } from 'react';
import { injectDevToolsStyles } from './utils/injectDevToolsStyles';
import { safePostMessage } from './utils/postMessage';
import type { RuntimeErrorData } from './types';
import MessageOverlay from './components/MessageOverlay';
import Button from './components/Button';

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
    const { error, isFixing } = this.state;
    if (error) {
      return (
        <MessageOverlay
          title="Something went wrong"
          message={error.message}
          button={
            <Button
              text={isFixing ? "Processing..." : "Ask Airo to Fix Code"}
              onClick={this.handleAskAiroToFix}
              loading={isFixing}
            />
          }
        />
      );
    }

    return this.props.children as React.ReactElement;
  }
}
