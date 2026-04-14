/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/hooks/useIsEmbedded', () => ({
  useIsEmbedded: vi.fn(),
}));

vi.mock('@/components/security/allowed-frame-ancestors', () => ({
  getParentOrigin: vi.fn(),
}));

vi.mock('@/utils/instrumentation', () => ({
  generateClickEID: (eid: string) => `appbuilder.${eid}.click`,
}));

import { getParentOrigin } from '@/components/security/allowed-frame-ancestors';
import { useIsEmbedded } from '@/hooks/useIsEmbedded';
import IframeCloseButton from './IframeCloseButton';

const mockUseIsEmbedded = vi.mocked(useIsEmbedded);
const mockGetParentOrigin = vi.mocked(getParentOrigin);

describe('IframeCloseButton', () => {
  beforeEach(() => {
    mockGetParentOrigin.mockReturnValue('https://dashboard.godaddy.com');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders nothing when not embedded', () => {
    mockUseIsEmbedded.mockReturnValue(false);

    const { container } = render(<IframeCloseButton location="homepage" />);
    expect(container.innerHTML).toBe('');
  });

  it('renders close button when embedded in an iframe', () => {
    mockUseIsEmbedded.mockReturnValue(true);

    render(<IframeCloseButton location="homepage" />);

    expect(screen.getByTestId('iframe-close-button')).toBeInTheDocument();
  });

  it('sends postMessage to the resolved parent origin when clicked', async () => {
    mockUseIsEmbedded.mockReturnValue(true);
    mockGetParentOrigin.mockReturnValue('https://dashboard.godaddy.com');
    const postMessageSpy = vi.spyOn(window.parent, 'postMessage');

    render(<IframeCloseButton location="homepage" />);

    const user = userEvent.setup();
    await user.click(screen.getByTestId('iframe-close-button'));

    expect(postMessageSpy).toHaveBeenCalledWith(
      { action: 'close', sender: 'airo-hq' },
      'https://dashboard.godaddy.com'
    );
  });

  it('sends postMessage to dev origin when parent is dev dashboard', async () => {
    mockUseIsEmbedded.mockReturnValue(true);
    mockGetParentOrigin.mockReturnValue('https://dashboard.dev-godaddy.com');
    const postMessageSpy = vi.spyOn(window.parent, 'postMessage');

    render(<IframeCloseButton location="homepage" />);

    const user = userEvent.setup();
    await user.click(screen.getByTestId('iframe-close-button'));

    expect(postMessageSpy).toHaveBeenCalledWith(
      { action: 'close', sender: 'airo-hq' },
      'https://dashboard.dev-godaddy.com'
    );
  });

  it('does not send postMessage when parent origin is not allowed', async () => {
    mockUseIsEmbedded.mockReturnValue(true);
    mockGetParentOrigin.mockReturnValue(null);
    const postMessageSpy = vi.spyOn(window.parent, 'postMessage');

    render(<IframeCloseButton location="homepage" />);

    const user = userEvent.setup();
    await user.click(screen.getByTestId('iframe-close-button'));

    expect(postMessageSpy).not.toHaveBeenCalled();
  });

  it('has correct data-eid attribute', () => {
    mockUseIsEmbedded.mockReturnValue(true);

    render(<IframeCloseButton location="homepage" />);

    const button = screen.getByTestId('iframe-close-button');
    expect(button).toHaveAttribute('data-eid', 'appbuilder.homepage.iframe_close.button.click');
  });

  it('has correct aria-label', () => {
    mockUseIsEmbedded.mockReturnValue(true);

    render(<IframeCloseButton location="homepage" />);

    const button = screen.getByTestId('iframe-close-button');
    expect(button).toHaveAttribute('aria-label', 'Close');
  });
});
