/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

import FirstPublishCongratsModal from '@/components/layout/FirstPublishCongratsModal';
import { renderWithProviders } from '@/tests/test-utils';
import { resolveSiteFqdn } from '@/utils/domain';
import { logImpressionEvent } from '@/utils/instrumentation';

vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () => (key: string) => key,
}));

const mockDevelopStore = {
  publishStates: {} as Record<string, { showFirstPublishCongrats?: boolean }>,
  getPublishState(appId: string) {
    const slice = mockDevelopStore.publishStates[appId];
    return {
      showFirstPublishCongrats: slice?.showFirstPublishCongrats ?? false,
    };
  },
  setShowFirstPublishCongrats: vi.fn(),
};

const mockSiteStore = {
  getSite: vi.fn(),
};

vi.mock('@/stores/useDevelopPageStore', () => ({
  useDevelopPageStore: (selector: (state: typeof mockDevelopStore) => unknown) => selector(mockDevelopStore),
}));

vi.mock('@/stores/useSiteStore', () => ({
  useSiteStore: (selector: (state: typeof mockSiteStore) => unknown) => selector(mockSiteStore),
}));

vi.mock('@/utils/domain', () => ({
  resolveSiteFqdn: vi.fn(),
}));

vi.mock('@/utils/instrumentation', () => ({
  generateClickEID: vi.fn(function (event: string) { return `${event}.click`; }),
  logAiroHQEvent: vi.fn(function () { return vi.fn(); }),
  logImpressionEvent: vi.fn(function () { return vi.fn(); }),
}));

vi.mock('canvas-confetti', () => ({
  default: vi.fn(),
}));

vi.mock('@ux/icon/checkmark', () => ({
  default: () => <span data-testid="first-publish-checkmark-icon" />,
}));

vi.mock('@ux/icon/copy', () => ({
  default: () => <span data-testid="first-publish-copy-icon" />,
}));

vi.mock('@ux/modal', () => ({
  default: ({
    title,
    children,
    onClose,
    description,
  }: {
    title: string;
    children: ReactNode;
    onClose: () => void;
    description?: string;
  }) => (
    <div role="dialog" aria-label={title}>
      <h2>{title}</h2>
      {description ? <p>{description}</p> : null}
      <button type="button" onClick={onClose} aria-label="Close">
        Close
      </button>
      <div>{children}</div>
    </div>
  ),
}));

vi.mock('@ux/text', () => ({
  default: {
    label: ({ children }: { children: ReactNode }) => <label>{children}</label>,
    span: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  },
}));

describe('FirstPublishCongratsModal', function firstPublishCongratsModalTests() {
  const appId = 'app-test-1';
  const baseNavigator = globalThis.navigator;

  beforeEach(function setup() {
    vi.clearAllMocks();
    mockDevelopStore.publishStates = {};
    mockSiteStore.getSite.mockReturnValue(null);
    vi.mocked(resolveSiteFqdn).mockReturnValue('');
  });

  afterEach(function teardown() {
    vi.unstubAllGlobals();
  });

  it('should render nothing when first publish congrats is not shown', function hidden() {
    mockDevelopStore.publishStates[appId] = { showFirstPublishCongrats: false };

    renderWithProviders(<FirstPublishCongratsModal appId={appId} />);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('should render the congrats dialog with i18n title and description when shown', function showsDialog() {
    mockDevelopStore.publishStates[appId] = { showFirstPublishCongrats: true };
    vi.mocked(resolveSiteFqdn).mockReturnValue('https://myapp.airoapp.ai');

    renderWithProviders(<FirstPublishCongratsModal appId={appId} />);

    expect(screen.getByRole('dialog', { name: 'builder_first_publish_congrats_title_v2' })).toBeInTheDocument();
    expect(screen.getByText('builder_first_publish_congrats_description_v2')).toBeInTheDocument();
  });

  it('should log impression when the modal is shown', async function impression() {
    mockDevelopStore.publishStates[appId] = { showFirstPublishCongrats: true };
    vi.mocked(resolveSiteFqdn).mockReturnValue('https://myapp.airoapp.ai');

    renderWithProviders(<FirstPublishCongratsModal appId={appId} />);

    await waitFor(() => {
      expect(logImpressionEvent).toHaveBeenCalledWith('develop.publish.first_publish_congrats.view');
    });
  });

  it('should render nothing when congrats is pending but FQDN is not available yet', function noDialogUntilFqdn() {
    mockDevelopStore.publishStates[appId] = { showFirstPublishCongrats: true };
    vi.mocked(resolveSiteFqdn).mockReturnValue('');

    renderWithProviders(<FirstPublishCongratsModal appId={appId} />);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(logImpressionEvent).not.toHaveBeenCalled();
  });

  it('should show the published URL display and copy control when FQDN is available', function domainDisplay() {
    mockDevelopStore.publishStates[appId] = { showFirstPublishCongrats: true };
    vi.mocked(resolveSiteFqdn).mockReturnValue('https://myapp.airoapp.ai');

    renderWithProviders(<FirstPublishCongratsModal appId={appId} />);

    expect(screen.getByText('builder_domain_title')).toBeInTheDocument();
    expect(screen.getByText('myapp.airoapp.ai')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'builder_common_copy_clipboard' })).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('should copy the full FQDN when copy is clicked', async function copyClick() {
    mockDevelopStore.publishStates[appId] = { showFirstPublishCongrats: true };
    vi.mocked(resolveSiteFqdn).mockReturnValue('https://myapp.airoapp.ai');

    const clipboardWriteTextMock = vi.fn().mockResolvedValue(undefined);
    const { user } = renderWithProviders(<FirstPublishCongratsModal appId={appId} />);

    // userEvent.setup() (inside renderWithProviders) replaces global navigator; re-stub before click
    vi.stubGlobal('navigator', {
      ...baseNavigator,
      clipboard: { writeText: clipboardWriteTextMock },
    } as Navigator);

    await user.click(screen.getByRole('button', { name: 'builder_common_copy_clipboard' }));

    expect(clipboardWriteTextMock).toHaveBeenCalledWith('https://myapp.airoapp.ai');
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'builder_common_copied' })).toBeInTheDocument();
      expect(screen.getByTestId('first-publish-checkmark-icon')).toBeInTheDocument();
    });
  });

  it('should dismiss via close and clear the store flag', async function dismiss() {
    mockDevelopStore.publishStates[appId] = { showFirstPublishCongrats: true };
    vi.mocked(resolveSiteFqdn).mockReturnValue('https://myapp.airoapp.ai');

    const { user } = renderWithProviders(<FirstPublishCongratsModal appId={appId} />);

    await user.click(screen.getByRole('button', { name: 'Close' }));

    expect(mockDevelopStore.setShowFirstPublishCongrats).toHaveBeenCalledWith(appId, false);
  });
});
