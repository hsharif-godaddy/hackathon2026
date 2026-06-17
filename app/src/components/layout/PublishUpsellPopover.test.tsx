/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

import { PAYWALL_ITC } from '@/lib/paywall/shared';
import { renderWithProviders } from '@/tests/test-utils';
import PublishUpsellPopover from './PublishUpsellPopover';

const mockOpenUpgradeModal = vi.fn();
const mockLogClickEvent = vi.fn(() => vi.fn());
const mockLogImpressionEvent = vi.fn(() => vi.fn());

let mockIsBelowSmBreakpoint = false;

vi.mock('@/utils/instrumentation', () => ({
  logClickEvent: (...args: unknown[]) => { mockLogClickEvent(...args); return vi.fn(); },
  logImpressionEvent: (...args: unknown[]) => { mockLogImpressionEvent(...args); return vi.fn(); },
}));
vi.mock('@/stores/usePaywallStore', () => ({
  usePaywallStore: (selector: any) => selector({ openUpgradeModal: mockOpenUpgradeModal }),
}));
vi.mock('@/hooks/useBreakpoints', () => ({
  useBreakpoints: () => ({ isBelowSmBreakpoint: mockIsBelowSmBreakpoint }),
}));

describe('PublishUpsellPopover', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsBelowSmBreakpoint = false;
  });

  it('renders the Publish trigger', () => {
    renderWithProviders(<PublishUpsellPopover appId="app-1" triggerLabel="Publish" />);
    expect(screen.getByTestId('publish-upsell-trigger')).toBeInTheDocument();
  });

  it('opens the popup on click and fires view + publish_click', async () => {
    const { user } = renderWithProviders(<PublishUpsellPopover appId="app-1" triggerLabel="Publish" />);
    await user.click(screen.getByTestId('publish-upsell-trigger'));
    await waitFor(() => {
      expect(screen.getByText('builder_publish_upsell_title')).toBeInTheDocument();
    });
    expect(mockLogClickEvent).toHaveBeenCalledWith('develop.publish_upsell.publish_click', { appId: 'app-1' });
    expect(mockLogImpressionEvent).toHaveBeenCalledWith('develop.publish_upsell.view', { appId: 'app-1' });
  });

  it('See Plans fires its EID, closes, and opens the UPP modal', async () => {
    const { user } = renderWithProviders(<PublishUpsellPopover appId="app-1" triggerLabel="Publish" />);
    await user.click(screen.getByTestId('publish-upsell-trigger'));
    await user.click(await screen.findByTestId('publish-upsell-see-plans'));
    expect(mockLogClickEvent).toHaveBeenCalledWith('develop.publish_upsell.see_plans', { appId: 'app-1' });
    expect(mockLogClickEvent).not.toHaveBeenCalledWith('develop.publish_upsell.dismiss_outside', { appId: 'app-1' });
    expect(mockOpenUpgradeModal).toHaveBeenCalledWith('publish_upsell.see_plans', PAYWALL_ITC.PUBLISH);
    await waitFor(() => {
      expect(screen.queryByText('builder_publish_upsell_title')).not.toBeInTheDocument();
    });
  });

  it('X fires dismiss_x and closes, without dismiss_outside', async () => {
    const { user } = renderWithProviders(<PublishUpsellPopover appId="app-1" triggerLabel="Publish" />);
    await user.click(screen.getByTestId('publish-upsell-trigger'));
    await user.click(await screen.findByTestId('publish-upsell-close'));
    expect(mockLogClickEvent).toHaveBeenCalledWith('develop.publish_upsell.dismiss_x', { appId: 'app-1' });
    expect(mockLogClickEvent).not.toHaveBeenCalledWith('develop.publish_upsell.dismiss_outside', { appId: 'app-1' });
    await waitFor(() => {
      expect(screen.queryByText('builder_publish_upsell_title')).not.toBeInTheDocument();
    });
  });

  it('Escape fires dismiss_outside', async () => {
    const { user } = renderWithProviders(<PublishUpsellPopover appId="app-1" triggerLabel="Publish" />);
    await user.click(screen.getByTestId('publish-upsell-trigger'));
    await screen.findByText('builder_publish_upsell_title');
    await user.keyboard('{Escape}');
    expect(mockLogClickEvent).toHaveBeenCalledWith('develop.publish_upsell.dismiss_outside', { appId: 'app-1' });
  });

  it('renders the full-width mobile content when below the sm breakpoint', async () => {
    mockIsBelowSmBreakpoint = true;
    const { user } = renderWithProviders(<PublishUpsellPopover appId="app-1" triggerLabel="Publish" />);
    await user.click(screen.getByTestId('publish-upsell-trigger'));
    const title = await screen.findByText('builder_publish_upsell_title');
    const content = title.closest('[class*="w-[calc(100vw-2rem)]"]');
    expect(content).not.toBeNull();
    expect(content).toHaveClass('w-[calc(100vw-2rem)]');
    expect(content).not.toHaveClass('w-[300px]');
  });

  it('emits events without clickContext when appId is undefined', async () => {
    const { user } = renderWithProviders(<PublishUpsellPopover appId={undefined} triggerLabel="Publish" />);
    await user.click(screen.getByTestId('publish-upsell-trigger'));
    await user.click(await screen.findByTestId('publish-upsell-see-plans'));
    expect(mockLogClickEvent).toHaveBeenCalledWith('develop.publish_upsell.publish_click', undefined);
    expect(mockLogImpressionEvent).toHaveBeenCalledWith('develop.publish_upsell.view', undefined);
    expect(mockLogClickEvent).toHaveBeenCalledWith('develop.publish_upsell.see_plans', undefined);
  });
});
