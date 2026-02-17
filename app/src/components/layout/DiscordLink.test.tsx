import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';

import { renderWithProviders } from '@/tests/test-utils';
import DiscordLink, { DiscordLinkVariant } from './DiscordLink';

vi.mock('@/utils/instrumentation', () => ({
  generateClickEID: vi.fn((id) => id),
}));

describe('DiscordLink', function discordLinkTests() {
  const mockWindowOpen = vi.fn();

  beforeEach(function setup() {
    vi.clearAllMocks();
    // Mock window.open
    vi.stubGlobal('open', mockWindowOpen);
  });

  describe('IconButton variant', function iconButtonTests() {
    it('should render as icon-only button by default', function renderDefault() {
      renderWithProviders(<DiscordLink location="header" />);

      const button = screen.getByRole('button');
      expect(button).toBeInTheDocument();
      // Should not have text visible (icon-only)
      expect(screen.queryByText('builder_usermenu_discord')).not.toBeInTheDocument();
    });

    it('should open Discord link when clicked', async function clickOpensDiscord() {
      const { user } = renderWithProviders(<DiscordLink location="header" />);

      await user.click(screen.getByRole('button'));

      expect(mockWindowOpen).toHaveBeenCalledWith(
        'https://discord.gg/EfybfxAXg8',
        '_blank',
        'noopener,noreferrer'
      );
    });

    it('should have correct analytics data-eid for header', function analyticsEid() {
      renderWithProviders(<DiscordLink location="header" />);

      const button = screen.getByRole('button');
      expect(button).toHaveAttribute('data-eid', 'header.header.discord');
    });
  });

  describe('MenuItem variant', function menuItemTests() {
    it('should render with text when MenuItem variant', function renderMenuItem() {
      renderWithProviders(
        <DiscordLink location="develop" variant={DiscordLinkVariant.MenuItem} />
      );

      // Default message is shown when translation key is not found
      expect(screen.getByText('builder_usermenu_discord')).toBeInTheDocument();
    });

    it('should open Discord link when clicked', async function clickOpensDiscord() {
      const { user } = renderWithProviders(
        <DiscordLink location="develop" variant={DiscordLinkVariant.MenuItem} />
      );

      await user.click(screen.getByRole('button'));

      expect(mockWindowOpen).toHaveBeenCalledWith(
        'https://discord.gg/EfybfxAXg8',
        '_blank',
        'noopener,noreferrer'
      );
    });

    it('should have correct analytics data-eid for user menu', function analyticsEid() {
      renderWithProviders(
        <DiscordLink location="develop" variant={DiscordLinkVariant.MenuItem} />
      );

      const button = screen.getByRole('button');
      expect(button).toHaveAttribute('data-eid', 'develop.user_menu.discord');
    });
  });
});
