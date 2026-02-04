import '@testing-library/jest-dom';

import { describe, expect, it } from 'vitest';
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

  it('should render status Tag with correct emphasis', () => {
    const status: StatusValue = {
      type: 'success',
      label: 'Ready',
    };

    renderWithProviders(
      <BigCard status={status}>
        <div>Content</div>
      </BigCard>
    );

    const tag = screen.getByText('builder_status_ready').closest('[class*="ux-tag"]');
    expect(tag).toBeInTheDocument();
  });

  it('should render critical emphasis Tag when there is an error', () => {
    const status: StatusValue = {
      type: 'critical',
      label: 'Error',
    };

    renderWithProviders(
      <BigCard status={status}>
        <div>Content</div>
      </BigCard>
    );

    expect(screen.getByText('builder_status_error')).toBeInTheDocument();
  });

  it('should render info emphasis Tag in pending status', () => {
    const status: StatusValue = {
      type: 'info',
      label: 'Pending',
    };

    renderWithProviders(
      <BigCard status={status}>
        <div>Content</div>
      </BigCard>
    );

    expect(screen.getByText('builder_status_pending')).toBeInTheDocument();
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
