/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';

import { StatusValue } from '@/app/[market]/develop/components/types';
import { renderWithProviders } from '@/tests/test-utils';
import SettingsSection from './SettingsSection';

describe('SettingsSection', () => {
  it('should render without crashing', () => {
    renderWithProviders(
      <SettingsSection>
        <div data-testid="test-content">Content</div>
      </SettingsSection>
    );

    expect(screen.getByTestId('test-content')).toBeInTheDocument();
  });

  it('should render children', () => {
    renderWithProviders(
      <SettingsSection>
        <p>Section content</p>
      </SettingsSection>
    );

    expect(screen.getByText('Section content')).toBeInTheDocument();
  });

  it('should render title when provided', () => {
    renderWithProviders(
      <SettingsSection title="Section Title">
        <div>Content</div>
      </SettingsSection>
    );

    expect(screen.getByText('Section Title')).toBeInTheDocument();
  });

  it('should render description when provided', () => {
    renderWithProviders(
      <SettingsSection description="Section description text">
        <div>Content</div>
      </SettingsSection>
    );

    expect(screen.getByText('Section description text')).toBeInTheDocument();
  });

  it('should render both title and description', () => {
    renderWithProviders(
      <SettingsSection title="Section Title" description="Section description">
        <div>Content</div>
      </SettingsSection>
    );

    expect(screen.getByText('Section Title')).toBeInTheDocument();
    expect(screen.getByText('Section description')).toBeInTheDocument();
  });

  it('should render status when provided', () => {
    const status: StatusValue = {
      type: 'success',
      label: 'Ready',
    };

    renderWithProviders(
      <SettingsSection status={status}>
        <div>Content</div>
      </SettingsSection>
    );

    expect(screen.getByText('builder_status_ready')).toBeInTheDocument();
  });

  it('should render button when provided', () => {
    renderWithProviders(
      <SettingsSection button={<button>Action Button</button>}>
        <div>Content</div>
      </SettingsSection>
    );

    expect(screen.getByRole('button', { name: /Action Button/i })).toBeInTheDocument();
  });

  it('should render both status and button', () => {
    const status: StatusValue = {
      type: 'success',
      label: 'Ready',
    };

    renderWithProviders(
      <SettingsSection status={status} button={<button>Action</button>}>
        <div>Content</div>
      </SettingsSection>
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
      <SettingsSection status={status}>
        <div>Content</div>
      </SettingsSection>
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
      <SettingsSection status={status}>
        <div>Content</div>
      </SettingsSection>
    );

    expect(screen.getByText('builder_status_error')).toBeInTheDocument();
  });

  it('should render info emphasis Tag in pending status', () => {
    const status: StatusValue = {
      type: 'info',
      label: 'Pending',
    };

    renderWithProviders(
      <SettingsSection status={status}>
        <div>Content</div>
      </SettingsSection>
    );

    expect(screen.getByText('builder_status_pending')).toBeInTheDocument();
  });

  it('should render without title and description', () => {
    renderWithProviders(
      <SettingsSection>
        <div>Just content</div>
      </SettingsSection>
    );

    expect(screen.getByText('Just content')).toBeInTheDocument();
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
  });
});
