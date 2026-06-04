import '@testing-library/jest-dom';

/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

import DeviceSelector from '@/app/[market]/develop/components/preview/DeviceSelector';
import { PreviewViewMode } from '@/app/[market]/develop/components/types';
import { useDevelopPageStore } from '@/stores/useDevelopPageStore';
import { renderWithProviders } from '@/tests/test-utils';
import { logClickEvent } from '@/utils/instrumentation';

vi.mock('@/app/[market]/develop/components/utils', () => ({
  useAppIdFromParams: () => 'app-123',
}));

vi.mock('@/utils/instrumentation', () => ({
  logClickEvent: vi.fn(() => vi.fn()),
  logImpressionEvent: vi.fn(),
}));

const BREAKPOINT_OPTIONS = [
  {
    labelKey: 'builder_analytics_desktop_laptop',
    mode: PreviewViewMode.DESKTOP,
    deviceId: 'desktop',
    instrumentationId: 'desktop',
  },
  {
    labelKey: 'builder_analytics_tablet',
    mode: PreviewViewMode.TABLET,
    deviceId: 'tablet',
    instrumentationId: 'tablet',
  },
  {
    labelKey: 'builder_analytics_mobile',
    mode: PreviewViewMode.MOBILE,
    deviceId: 'mobile',
    instrumentationId: 'mobile',
  },
] as const;

describe('DeviceSelector', function deviceSelectorTests() {
  beforeEach(function setup() {
    vi.clearAllMocks();
    useDevelopPageStore.setState({
      previewViewMode: PreviewViewMode.DESKTOP,
      selectedDeviceId: 'desktop',
    });
  });

  it('should render three breakpoint options', async function renderOptions() {
    const { user } = renderWithProviders(<DeviceSelector />);

    await user.click(screen.getByTestId('preview-device-selector-trigger'));

    for (const option of BREAKPOINT_OPTIONS) {
      expect(screen.getByRole('button', { name: option.labelKey })).toBeInTheDocument();
    }
  });

  it.each(BREAKPOINT_OPTIONS)(
    'should select $labelKey breakpoint in store',
    async function selectBreakpoint({ labelKey, mode, deviceId, instrumentationId }) {
      const logSelection = vi.fn();
      vi.mocked(logClickEvent).mockReturnValue(logSelection);

      const { user } = renderWithProviders(<DeviceSelector />);

      await user.click(screen.getByTestId('preview-device-selector-trigger'));
      await user.click(screen.getByRole('button', { name: labelKey }));

      const state = useDevelopPageStore.getState();
      expect(state.previewViewMode).toBe(mode);
      expect(state.selectedDeviceId).toBe(deviceId);
      expect(logClickEvent).toHaveBeenCalledWith(
        `develop.preview.device_select_${instrumentationId}`,
        { appId: 'app-123' },
      );
      expect(logSelection).toHaveBeenCalled();
      await waitFor(function popoverClosed() {
        expect(screen.queryByRole('button', { name: labelKey })).not.toBeInTheDocument();
      });
    },
  );

  it('should mark active preview view mode option', async function activeOptionByMode() {
    useDevelopPageStore.setState({
      previewViewMode: PreviewViewMode.TABLET,
      selectedDeviceId: 'ipad',
    });

    const { user } = renderWithProviders(<DeviceSelector />);

    await user.click(screen.getByTestId('preview-device-selector-trigger'));

    expect(screen.getByRole('button', { name: 'builder_analytics_tablet' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('button', { name: 'builder_analytics_desktop_laptop' })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('button', { name: 'builder_analytics_mobile' })).toHaveAttribute('aria-selected', 'false');
  });

  it('should not open menu when disabled', async function disabledMenu() {
    const { user } = renderWithProviders(<DeviceSelector disabled />);

    await user.click(screen.getByTestId('preview-device-selector-trigger'));

    expect(screen.queryByRole('button', { name: 'builder_analytics_mobile' })).not.toBeInTheDocument();
  });

  it('should log when opening the device selector', async function openInstrumentation() {
    const logOpen = vi.fn();
    vi.mocked(logClickEvent).mockReturnValue(logOpen);

    const { user } = renderWithProviders(<DeviceSelector />);

    await user.click(screen.getByTestId('preview-device-selector-trigger'));

    expect(logClickEvent).toHaveBeenCalledWith('develop.preview.device_selector', { appId: 'app-123' });
    expect(logOpen).toHaveBeenCalled();
  });
});
