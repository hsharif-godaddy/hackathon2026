import React, { Component, ReactNode } from 'react';
import Box from '@ux/box';
import Button from '@ux/button';
import text from '@ux/text';

/**
 * Props for the ErrorBoundary component
 */
interface ErrorBoundaryProps {
  /** Child components to render within the error boundary */
  children: ReactNode;
  /** Optional custom fallback component or element to display when an error occurs */
  fallback?: ReactNode | ((error: Error, reset: () => void) => ReactNode);
}

/**
 * State for the ErrorBoundary component
 */
interface ErrorBoundaryState {
  /** Whether an error has been caught */
  hasError: boolean;
  /** The error that was caught */
  error?: Error;
}

/**
 * Error boundary component for catching and handling React component errors
 *
 * Catches JavaScript errors anywhere in the child component tree, logs those errors,
 * and displays a fallback UI instead of crashing the whole component tree.
 *
 * @example
 * ```tsx
 * <ErrorBoundary fallback={<div>Something went wrong</div>}>
 *   <MyComponent />
 * </ErrorBoundary>
 * ```
 *
 * @example
 * ```tsx
 * <ErrorBoundary fallback={(error, reset) => (
 *   <div>
 *     <h3>Error: {error.message}</h3>
 *     <button onClick={reset}>Try Again</button>
 *   </div>
 * )}>
 *   <MyComponent />
 * </ErrorBoundary>
 * ```
 */
export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  /**
   * Creates an instance of ErrorBoundary
   *
   * @param props - Component props
   */
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  /**
   * Update state when an error is caught
   *
   * @param error - The error that was thrown
   * @returns Updated state object
   */
  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  /**
   * Log error information when an error is caught
   *
   * @param error - The error that was thrown
   * @param errorInfo - Additional error information including component stack
   */
  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error('Error caught by ErrorBoundary:', error, errorInfo);
  }

  /**
   * Reset the error boundary state
   *
   * Clears the error state and allows the component tree to re-render.
   * Useful for "Try Again" functionality.
   */
  reset = (): void => {
    this.setState({ hasError: false, error: undefined });
  };

  /**
   * Render the component
   *
   * @returns The child components or fallback UI
   */
  render(): ReactNode {
    if (this.state.hasError && this.state.error) {
      const { fallback } = this.props;

      if (typeof fallback === 'function') {
        return fallback(this.state.error, this.reset);
      }

      if (fallback) {
        return fallback;
      }

      return (
        <Box gap="md" className="bg-intents-ux-boxLowContrast-backgroundColor p-3 rounded-lg">
          <text.h3 as="heading" size={-1}>
            Something went wrong. Please try again.
          </text.h3>
          <Button onClick={this.reset} design="primary" size="md">
            Try Again
          </Button>
        </Box>
      );
    }

    return this.props.children;
  }
}

