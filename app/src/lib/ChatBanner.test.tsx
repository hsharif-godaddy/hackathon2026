import '@testing-library/jest-dom';

/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';

import { renderWithProviders } from '@/tests/test-utils';
import ChatBanner from './ChatBanner';

describe('ChatBanner', function chatBannerTests() {
  beforeEach(function setup() {
    vi.clearAllMocks();
  });

  describe('rendering', function renderingTests() {
    it('should render children content', function renderChildren() {
      renderWithProviders(<ChatBanner>Test message content</ChatBanner>);

      expect(screen.getByText('Test message content')).toBeInTheDocument();
    });

    it('should apply warning variant styles by default', function defaultVariant() {
      const { container } = renderWithProviders(<ChatBanner>Warning message</ChatBanner>);

      const banner = container.firstChild;
      expect(banner).toHaveClass('bg-intents-ux-feedbackWarning-feedbackColor');
    });

    it('should apply info variant styles', function infoVariant() {
      const { container } = renderWithProviders(
        <ChatBanner variant="info">Info message</ChatBanner>
      );

      const banner = container.firstChild;
      expect(banner).toHaveClass('bg-intents-ux-feedbackInfo-feedbackColor');
    });

    it('should apply critical variant styles', function criticalVariant() {
      const { container } = renderWithProviders(
        <ChatBanner variant="critical">Critical message</ChatBanner>
      );

      const banner = container.firstChild;
      expect(banner).toHaveClass('bg-intents-ux-feedbackCritical-feedbackColor');
    });

    it('should apply success variant styles', function successVariant() {
      const { container } = renderWithProviders(
        <ChatBanner variant="success">Success message</ChatBanner>
      );

      const banner = container.firstChild;
      expect(banner).toHaveClass('bg-intents-ux-feedbackSuccess-feedbackColor');
    });

    it('should apply custom className', function customClassName() {
      const { container } = renderWithProviders(
        <ChatBanner className="custom-class">Message</ChatBanner>
      );

      const banner = container.firstChild;
      expect(banner).toHaveClass('custom-class');
    });
  });

  describe('close button', function closeButtonTests() {
    it('should not render close button when onClose is not provided', function noCloseButton() {
      renderWithProviders(<ChatBanner>Message</ChatBanner>);

      expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });

    it('should render close button when onClose is provided', function renderCloseButton() {
      const onClose = vi.fn();
      renderWithProviders(<ChatBanner onClose={onClose}>Message</ChatBanner>);

      expect(screen.getByRole('button')).toBeInTheDocument();
    });

    it('should call onClose when close button is clicked', async function callOnClose() {
      const onClose = vi.fn();
      const { user } = renderWithProviders(
        <ChatBanner onClose={onClose}>Message</ChatBanner>
      );

      await user.click(screen.getByRole('button'));

      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });
});
