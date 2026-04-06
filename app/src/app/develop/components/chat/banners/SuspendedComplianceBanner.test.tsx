/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';

import { renderWithProviders } from '@/tests/test-utils';
import SuspendedComplianceBanner from './SuspendedComplianceBanner';

vi.mock('react-intl', async () => {
  const actual = await vi.importActual<typeof import('react-intl')>('react-intl');
  return {
    ...actual,
    FormattedMessage: ({ id, values }: { id: string; values?: Record<string, React.ReactNode> }) => (
      <>
        {id}
        {values && Object.values(values)}
      </>
    ),
  };
});

describe('SuspendedComplianceBanner', function suspendedComplianceBannerTests() {
  beforeEach(function setup() {
    vi.clearAllMocks();
  });

  describe('rendering', function renderingTests() {
    it('should render the compliance suspension message key', function renderMessage() {
      renderWithProviders(<SuspendedComplianceBanner />);

      expect(screen.getByText('builder_chat_suspended_compliance_with_link_message')).toBeInTheDocument();
    });

    it('should render the action button', function renderButton() {
      renderWithProviders(<SuspendedComplianceBanner />);

      expect(
        screen.getByRole('link', { name: 'builder_unpublish_contact_support' })
      ).toBeInTheDocument();
    });

    it('should use critical variant styling', function criticalVariant() {
      const { container } = renderWithProviders(<SuspendedComplianceBanner />);

      expect(
        container.querySelector('.bg-intents-ux-feedbackCritical-feedbackColor')
      ).toBeInTheDocument();
    });

    it('should link to the contact-us page', function contactLink() {
      renderWithProviders(<SuspendedComplianceBanner />);

      const link = screen.getByRole('link', {
        name: 'builder_unpublish_contact_support',
      });
      expect(link).toHaveAttribute('href', expect.stringContaining('/contact-us'));
      expect(link).toHaveAttribute('target', '_blank');
    });
  });
});
