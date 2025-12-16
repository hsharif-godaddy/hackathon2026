import '@testing-library/jest-dom';

import { describe, expect,it } from 'vitest';
import { screen } from '@testing-library/react';

import { StatusValue } from '@/app/develop/components/types';
import { renderWithProviders } from '@/tests/test-utils';
import BigCard from './BigCard';

describe('BigCard', () => {
  it('should render without crashing', () => {
    renderWithProviders(
      <BigCard>
        <div data-testid="test-content">Content</div>
      </BigCard>
    );

    expect(screen.getByTestId('test-content')).toBeInTheDocument();
  });

  it('should render children', () => {
    renderWithProviders(
      <BigCard>
        <p>Card content</p>
      </BigCard>
    );

    expect(screen.getByText('Card content')).toBeInTheDocument();
  });

  it('should render title when provided', () => {
    renderWithProviders(
      <BigCard title="Card Title">
        <div>Content</div>
      </BigCard>
    );

    expect(screen.getByText('Card Title')).toBeInTheDocument();
  });

  it('should render description when provided', () => {
    renderWithProviders(
      <BigCard description="Card description text">
        <div>Content</div>
      </BigCard>
    );

    expect(screen.getByText('Card description text')).toBeInTheDocument();
  });

  it('should render both title and description', () => {
    renderWithProviders(
      <BigCard title="Card Title" description="Card description">
        <div>Content</div>
      </BigCard>
    );

    expect(screen.getByText('Card Title')).toBeInTheDocument();
    expect(screen.getByText('Card description')).toBeInTheDocument();
  });

  it('should render status when provided', () => {
    const status: StatusValue = {
      type: 'success',
      label: 'Ready',
    };

    renderWithProviders(
      <BigCard status={status}>
        <div>Content</div>
      </BigCard>
    );

    expect(screen.getByText('builder_status_ready')).toBeInTheDocument();
  });

  it('should render button when provided', () => {
    renderWithProviders(
      <BigCard button={<button>Action Button</button>}>
        <div>Content</div>
      </BigCard>
    );

    expect(screen.getByRole('button', { name: /Action Button/i })).toBeInTheDocument();
  });

  it('should render both status and button', () => {
    const status: StatusValue = {
      type: 'success',
      label: 'Ready',
    };

    renderWithProviders(
      <BigCard status={status} button={<button>Action</button>}>
        <div>Content</div>
      </BigCard>
    );

    expect(screen.getByText('builder_status_ready')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Action/i })).toBeInTheDocument();
  });

  it('should apply success color for success status', () => {
    const status: StatusValue = {
      type: 'success',
      label: 'Ready',
    };

    const { container } = renderWithProviders(
      <BigCard status={status}>
        <div>Content</div>
      </BigCard>
    );

    const statusElement = container.querySelector('.text-intents-ux-feedbackHighContrastSuccess-feedbackColor');
    expect(statusElement).toBeInTheDocument();
  });

  it('should apply error color for error status', () => {
    const status: StatusValue = {
      type: 'error',
      label: 'Failed',
    };

    const { container } = renderWithProviders(
      <BigCard status={status}>
        <div>Content</div>
      </BigCard>
    );

    const statusElement = container.querySelector('.text-intents-ux-feedbackHighContrastCritical-feedbackColor');
    expect(statusElement).toBeInTheDocument();
  });

  it('should apply warning color for warning status', () => {
    const status: StatusValue = {
      type: 'warning',
      label: 'Pending',
    };

    const { container } = renderWithProviders(
      <BigCard status={status}>
        <div>Content</div>
      </BigCard>
    );

    const statusElement = container.querySelector('.text-intents-ux-feedbackHighContrastInfo-feedbackColor');
    expect(statusElement).toBeInTheDocument();
  });

  it('should render without title and description', () => {
    renderWithProviders(
      <BigCard>
        <div>Just content</div>
      </BigCard>
    );

    expect(screen.getByText('Just content')).toBeInTheDocument();
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
  });
});
