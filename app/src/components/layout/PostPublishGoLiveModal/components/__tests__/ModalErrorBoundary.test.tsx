/**
 * Tests for ModalErrorBoundary component
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { ModalErrorBoundary } from '../ModalErrorBoundary';

// Mock logger using vi.hoisted to ensure it's available for the mock
const mocks = vi.hoisted(() => {
  return {
    logger: {
      error: vi.fn()
    }
  };
});

vi.mock('@/lib/request-context', () => ({
  logger: mocks.logger
}));

const ThrowError = ({ shouldThrow }: { shouldThrow: boolean }) => {
  if (shouldThrow) {
    throw new Error('Test error');
  }
  return <div>Child component</div>;
};

describe('ModalErrorBoundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Suppress console.error for these tests
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('should render children when no error', () => {
    render(
      <ModalErrorBoundary stepName="test-step" appId="app-123">
        <div>Test content</div>
      </ModalErrorBoundary>
    );

    expect(screen.getByText('Test content')).toBeInTheDocument();
  });

  it('should catch and display error', () => {
    render(
      <ModalErrorBoundary stepName="test-step" appId="app-123">
        <ThrowError shouldThrow={true} />
      </ModalErrorBoundary>
    );

    expect(screen.getByText('Something Went Wrong')).toBeInTheDocument();
    expect(
      screen.getByText(/An error occurred while rendering this step/)
    ).toBeInTheDocument();
    expect(screen.getByText('Test error')).toBeInTheDocument();
  });

  it('should log error to logger', () => {
    render(
      <ModalErrorBoundary stepName="qa-step" appId="app-456">
        <ThrowError shouldThrow={true} />
      </ModalErrorBoundary>
    );

    expect(mocks.logger.error).toHaveBeenCalledWith(
      'go-live.modal.render-error',
      expect.objectContaining({
        stepName: 'qa-step',
        appId: 'app-456',
        error: 'Test error'
      })
    );
  });

  it('should reset error state when Try Again is clicked', () => {
    const onReset = vi.fn();
    let shouldThrow = true;

    const { rerender } = render(
      <ModalErrorBoundary stepName="test-step" appId="app-123" onReset={onReset} key="1">
        <ThrowError shouldThrow={shouldThrow} />
      </ModalErrorBoundary>
    );

    // Error boundary should be showing
    expect(screen.getByText('Something Went Wrong')).toBeInTheDocument();

    // Click Try Again
    const tryAgainButton = screen.getByText('Try Again');
    fireEvent.click(tryAgainButton);

    // onReset callback should be called
    expect(onReset).toHaveBeenCalled();

    // Change the child to not throw and rerender with a different key to force remount
    shouldThrow = false;
    rerender(
      <ModalErrorBoundary stepName="test-step" appId="app-123" onReset={onReset} key="2">
        <ThrowError shouldThrow={shouldThrow} />
      </ModalErrorBoundary>
    );

    // Should show child component again
    expect(screen.getByText('Child component')).toBeInTheDocument();
  });

  it('should handle reset without onReset callback', () => {
    let shouldThrow = true;

    const { rerender } = render(
      <ModalErrorBoundary stepName="test-step" appId="app-123" key="1">
        <ThrowError shouldThrow={shouldThrow} />
      </ModalErrorBoundary>
    );

    const tryAgainButton = screen.getByText('Try Again');

    // Should not throw error when clicking without onReset
    expect(() => fireEvent.click(tryAgainButton)).not.toThrow();

    // Change the child to not throw and rerender with different key
    shouldThrow = false;
    rerender(
      <ModalErrorBoundary stepName="test-step" appId="app-123" key="2">
        <ThrowError shouldThrow={shouldThrow} />
      </ModalErrorBoundary>
    );

    expect(screen.getByText('Child component')).toBeInTheDocument();
  });

  it('should display error message', () => {
    render(
      <ModalErrorBoundary stepName="test-step" appId="app-123">
        <ThrowError shouldThrow={true} />
      </ModalErrorBoundary>
    );

    expect(screen.getByText('Test error')).toBeInTheDocument();
  });

  it('should render without appId', () => {
    render(
      <ModalErrorBoundary stepName="test-step">
        <ThrowError shouldThrow={true} />
      </ModalErrorBoundary>
    );

    expect(screen.getByText('Something Went Wrong')).toBeInTheDocument();
  });
});
