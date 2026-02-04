import '@testing-library/jest-dom';

import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';

import { renderWithProviders } from '@/tests/test-utils';
import TextBlock from './TextBlock';

describe('TextBlock', () => {
  it('should render without crashing', () => {
    renderWithProviders(
      <TextBlock title="Test Title">
        Test description
      </TextBlock>
    );

    expect(screen.getByText('Test Title')).toBeInTheDocument();
  });

  it('should render title and children', () => {
    renderWithProviders(
      <TextBlock title="Main Title">
        This is the description text
      </TextBlock>
    );

    expect(screen.getByText('Main Title')).toBeInTheDocument();
    expect(screen.getByText('This is the description text')).toBeInTheDocument();
  });

  it('should render preTitle when provided', () => {
    renderWithProviders(
      <TextBlock preTitle="Pre-Title" title="Main Title">
        Description
      </TextBlock>
    );

    expect(screen.getByText('Pre-Title')).toBeInTheDocument();
    expect(screen.getByText('Main Title')).toBeInTheDocument();
  });

  it('should not render preTitle when not provided', () => {
    renderWithProviders(
      <TextBlock title="Main Title">
        Description
      </TextBlock>
    );

    expect(screen.queryByText('Pre-Title')).not.toBeInTheDocument();
  });

  it('should render link button when link and linkText provided', () => {
    renderWithProviders(
      <TextBlock
        title="Main Title"
        link="https://example.com"
        linkText="Learn More"
      >
        Description
      </TextBlock>
    );

    const link = screen.getByRole('link', { name: /Learn More/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', 'https://example.com');
  });

  it('should not render link button when link is missing', () => {
    renderWithProviders(
      <TextBlock title="Main Title" linkText="Learn More">
        Description
      </TextBlock>
    );

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('should not render link button when linkText is missing', () => {
    renderWithProviders(
      <TextBlock title="Main Title" link="https://example.com">
        Description
      </TextBlock>
    );

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});
