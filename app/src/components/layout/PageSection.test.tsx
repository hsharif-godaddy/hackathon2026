import '@testing-library/jest-dom';

import { describe, expect,it } from 'vitest';
import { screen } from '@testing-library/react';

import { renderWithProviders } from '@/tests/test-utils';
import PageSection from './PageSection';

describe('PageSection', () => {
  it('should render without crashing', () => {
    renderWithProviders(
      <PageSection>
        <div data-testid="test-content">Test Content</div>
      </PageSection>
    );

    expect(screen.getByTestId('test-content')).toBeInTheDocument();
  });

  it('should render children', () => {
    renderWithProviders(
      <PageSection>
        <p>Child content</p>
      </PageSection>
    );

    expect(screen.getByText('Child content')).toBeInTheDocument();
  });

  it('should apply default overflow hidden', () => {
    const { container } = renderWithProviders(
      <PageSection>
        <div>Content</div>
      </PageSection>
    );

    const section = container.firstChild;
    expect(section).not.toHaveClass('overflow-visible');
  });

  it('should apply overflow visible when allowOverflow is true', () => {
    const { container } = renderWithProviders(
      <PageSection allowOverflow={true}>
        <div>Content</div>
      </PageSection>
    );

    const section = container.firstChild;
    expect(section).toHaveClass('overflow-visible');
  });

  it('should apply responsive padding classes', () => {
    const { container } = renderWithProviders(
      <PageSection>
        <div>Content</div>
      </PageSection>
    );

    const section = container.firstChild;
    expect(section).toHaveClass('px-2', 'sm:px-3', 'lg:px-4', 'py-4', 'md:py-8', 'lg:py-14');
  });
});
