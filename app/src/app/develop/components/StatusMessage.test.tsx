import '@testing-library/jest-dom';

import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';

import { renderWithProviders } from '@/tests/test-utils';
import StatusMessage from './StatusMessage';

describe('StatusMessage', () => {
  it('should render without crashing', () => {
    renderWithProviders(<StatusMessage status="executing_tools" message="Processing..." />);

    expect(screen.getByText('Processing...')).toBeInTheDocument();
  });

  it('should display message text', () => {
    renderWithProviders(<StatusMessage status="completed" message="Task completed" />);

    expect(screen.getByText('Task completed')).toBeInTheDocument();
  });

  it('should render executing_tools status with blue styling', () => {
    const { container } = renderWithProviders(
      <StatusMessage status="executing_tools" message="Executing..." />
    );

    const statusDiv = container.querySelector('.bg-blue-50');
    expect(statusDiv).toBeInTheDocument();
  });

  it('should render completed status with green styling', () => {
    const { container } = renderWithProviders(
      <StatusMessage status="completed" message="Completed" />
    );

    const statusDiv = container.querySelector('.bg-green-50');
    expect(statusDiv).toBeInTheDocument();
  });

  it('should render error status with red styling', () => {
    const { container } = renderWithProviders(
      <StatusMessage status="error" message="Error occurred" />
    );

    const statusDiv = container.querySelector('.bg-red-50');
    expect(statusDiv).toBeInTheDocument();
  });

  it('should render default status with gray styling', () => {
    const { container } = renderWithProviders(
      <StatusMessage status="unknown" message="Unknown status" />
    );

    const statusDiv = container.querySelector('.bg-gray-50');
    expect(statusDiv).toBeInTheDocument();
  });

  it('should render clock icon for executing_tools status', () => {
    const { container } = renderWithProviders(
      <StatusMessage status="executing_tools" message="Processing..." />
    );

    const icon = container.querySelector('svg');
    expect(icon).toBeInTheDocument();
    expect(icon).toHaveClass('animate-spin');
  });

  it('should render check icon for completed status', () => {
    const { container } = renderWithProviders(
      <StatusMessage status="completed" message="Done" />
    );

    const icon = container.querySelector('svg');
    expect(icon).toBeInTheDocument();
    expect(icon).toHaveClass('text-green-500');
  });

  it('should render warning icon for error status', () => {
    const { container } = renderWithProviders(
      <StatusMessage status="error" message="Failed" />
    );

    const icon = container.querySelector('svg');
    expect(icon).toBeInTheDocument();
    expect(icon).toHaveClass('text-red-500');
  });

  it('should render with different message texts', () => {
    const { rerender } = renderWithProviders(
      <StatusMessage status="executing_tools" message="First message" />
    );

    expect(screen.getByText('First message')).toBeInTheDocument();

    rerender(<StatusMessage status="executing_tools" message="Second message" />);

    expect(screen.getByText('Second message')).toBeInTheDocument();
  });
});
