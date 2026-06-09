/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { exitDarkRelease, getDarkReleaseVersion } from '@/lib/katana/dark-release';
import DarkReleaseBanner from '../DarkReleaseBanner';

vi.mock('@/lib/katana/dark-release', () => ({
  getDarkReleaseVersion: vi.fn(),
  exitDarkRelease: vi.fn(),
}));

const mockGet = vi.mocked(getDarkReleaseVersion);
const mockExit = vi.mocked(exitDarkRelease);

afterEach(() => {
  vi.clearAllMocks();
  document.documentElement.style.removeProperty('--dark-release-banner-h');
});

describe('DarkReleaseBanner', () => {
  it('renders nothing when not in dark-release mode', () => {
    mockGet.mockReturnValue(undefined);
    const { container } = render(<DarkReleaseBanner />);
    expect(screen.queryByTestId('dark-release-banner')).toBeNull();
    expect(container.firstChild).toBeNull();
  });

  it('shows the last-7 version and an Exit button when the cookie is present', async () => {
    const fullSha = 'ce83bde0e7c4ca598426f0357d8c698a8985ff49';
    mockGet.mockReturnValue(fullSha);
    render(<DarkReleaseBanner />);

    const banner = await screen.findByTestId('dark-release-banner');
    expect(banner.textContent).toContain(fullSha.slice(-7)); // trailing 7 chars
    expect(banner.textContent).not.toContain(fullSha.slice(0, 12)); // not the leading chars
    // full value preserved in the title for hover
    expect(banner.querySelector('[title]')?.getAttribute('title')).toBe(fullSha);

    const exitButton = screen.getByRole('button');
    expect(exitButton.textContent).toContain('Exit');
  });

  it('calls exitDarkRelease when Exit is clicked', async () => {
    mockGet.mockReturnValue('abc123');
    render(<DarkReleaseBanner />);
    await screen.findByTestId('dark-release-banner');

    fireEvent.click(screen.getByRole('button'));
    expect(mockExit).toHaveBeenCalledTimes(1);
  });

  it('sets the --dark-release-banner-h CSS var while shown and clears it on unmount', async () => {
    mockGet.mockReturnValue('abc123');
    const { unmount } = render(<DarkReleaseBanner />);
    await screen.findByTestId('dark-release-banner');
    expect(document.documentElement.style.getPropertyValue('--dark-release-banner-h')).toBe('2.5rem');

    unmount();
    expect(document.documentElement.style.getPropertyValue('--dark-release-banner-h')).toBe('0px');
  });
});
