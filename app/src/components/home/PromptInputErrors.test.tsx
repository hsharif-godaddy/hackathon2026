/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';

import { MAX_PROMPT_BYTES } from '@/lib/waf-validation';
import { renderWithProviders } from '@/tests/test-utils';
import { PromptInputErrors } from './PromptInputErrors';

const enNumberFormat = new Intl.NumberFormat('en');

vi.mock('@ux/text', () => ({
  text: {
    p: ({
      children,
      className,
      role,
    }: {
      children: React.ReactNode;
      className?: string;
      role?: string;
    }) => (
      <p className={className} role={role}>
        {children}
      </p>
    ),
  },
}));

describe('PromptInputErrors', () => {
  it('renders the character counter', () => {
    renderWithProviders(
      <PromptInputErrors bytesRemaining={15} isOverLimit={false} fileUploadError={null} />,
    );
    expect(
      screen.getByText(`${enNumberFormat.format(15)} / ${enNumberFormat.format(MAX_PROMPT_BYTES)}`)
    ).toBeInTheDocument();
  });

  it('does not render a file upload error when fileUploadError is null', () => {
    renderWithProviders(
      <PromptInputErrors bytesRemaining={15} isOverLimit={false} fileUploadError={null} />,
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('renders the file upload error when provided', () => {
    renderWithProviders(
      <PromptInputErrors bytesRemaining={15} isOverLimit={false} fileUploadError="File too large" />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('File too large');
  });
});
