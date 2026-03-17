import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

import { renderWithProviders } from '@/tests/test-utils';
import UPPModal from '../UPPModal';

vi.mock('@ux/modal', () => ({
  default: ({ children, title, onClose }: any) => (
    <div data-testid="modal" data-title={title}>
      <button data-testid="modal-close" onClick={onClose}>Close</button>
      {children}
    </div>
  ),
}));

vi.mock('@ux/spinner', () => ({
  default: () => <div data-testid="spinner">Loading...</div>,
}));

vi.mock('@ux/text', () => ({
  default: {
    p: ({ children, className }: any) => <p className={className}>{children}</p>,
  },
}));

vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('@/lib/logging', () => ({
  shipAnalyticsLog: vi.fn(),
}));

vi.mock('@/lib/request-context', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@/utils/getRootDomain', () => ({
  getRootDomain: () => 'godaddy.com',
}));

describe('UPPModal', () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    domain: 'mybrand.com',
    onPurchaseComplete: vi.fn(),
    onPurchaseError: vi.fn(),
    appId: 'test-app-123',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render nothing when not open', () => {
    const { container } = renderWithProviders(
      <UPPModal {...defaultProps} isOpen={false} />
    );
    expect(container.innerHTML).toBe('');
  });

  it('should render modal with iframe when open', () => {
    renderWithProviders(<UPPModal {...defaultProps} />);

    const iframe = document.querySelector('iframe');
    expect(iframe).toBeTruthy();
    expect(iframe?.src).toContain('mybrand.com');
    expect(iframe?.title).toContain('Purchase mybrand.com');
  });

  it('should show loading spinner initially', () => {
    renderWithProviders(<UPPModal {...defaultProps} />);
    expect(screen.getByText('builder_domain_purchase_loading')).toBeInTheDocument();
  });

  describe('postMessage handling', () => {
    function getIframeSource() {
      return document.querySelector('iframe')?.contentWindow ?? null;
    }

    it('should call onPurchaseComplete for purchase success messages', async () => {
      renderWithProviders(<UPPModal {...defaultProps} />);

      window.dispatchEvent(new MessageEvent('message', {
        origin: 'https://www.godaddy.com',
        data: { type: 'UPP_PURCHASE_COMPLETE' },
        source: getIframeSource(),
      }));

      await waitFor(() => {
        expect(defaultProps.onPurchaseComplete).toHaveBeenCalledWith('mybrand.com');
      });
    });

    it('should call onClose for cancelled messages', async () => {
      renderWithProviders(<UPPModal {...defaultProps} />);

      window.dispatchEvent(new MessageEvent('message', {
        origin: 'https://cart.godaddy.com',
        data: { type: 'UPP_PURCHASE_CANCELLED' },
        source: getIframeSource(),
      }));

      await waitFor(() => {
        expect(defaultProps.onClose).toHaveBeenCalled();
      });
    });

    it('should call onPurchaseError for error messages', async () => {
      renderWithProviders(<UPPModal {...defaultProps} />);

      window.dispatchEvent(new MessageEvent('message', {
        origin: 'https://checkout.godaddy.com',
        data: { type: 'UPP_PURCHASE_ERROR', error: 'Payment declined' },
        source: getIframeSource(),
      }));

      await waitFor(() => {
        expect(defaultProps.onPurchaseError).toHaveBeenCalledWith('Payment declined');
      });
    });

    it('should ignore messages from unknown origins', async () => {
      renderWithProviders(<UPPModal {...defaultProps} />);

      window.dispatchEvent(new MessageEvent('message', {
        origin: 'https://evil.example.com',
        data: { type: 'UPP_PURCHASE_COMPLETE' },
      }));

      // Wait a tick — handler should NOT have been called
      await new Promise(resolve => setTimeout(resolve, 50));
      expect(defaultProps.onPurchaseComplete).not.toHaveBeenCalled();
    });

    it('should ignore messages from subdomain spoofing attempts', async () => {
      renderWithProviders(<UPPModal {...defaultProps} />);

      window.dispatchEvent(new MessageEvent('message', {
        origin: 'https://www.godaddy.com.evil.com',
        data: { type: 'UPP_PURCHASE_COMPLETE' },
      }));

      await new Promise(resolve => setTimeout(resolve, 50));
      expect(defaultProps.onPurchaseComplete).not.toHaveBeenCalled();
    });
  });

  it('should include sandbox attributes on iframe', () => {
    renderWithProviders(<UPPModal {...defaultProps} />);

    const iframe = document.querySelector('iframe');
    expect(iframe?.getAttribute('sandbox')).toContain('allow-scripts');
    expect(iframe?.getAttribute('sandbox')).toContain('allow-forms');
  });
});
