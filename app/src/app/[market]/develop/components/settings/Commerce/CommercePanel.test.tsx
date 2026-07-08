/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';

import type { CommerceBinding } from '@/hooks/useCommerceBinding';
import { useCommerceBinding } from '@/hooks/useCommerceBinding';
import { renderWithProviders } from '@/tests/test-utils';
import { CommercePanel } from './CommercePanel';

vi.mock('@/hooks/useCommerceBinding', () => ({
  useCommerceBinding: vi.fn(),
}));

vi.mock('@/utils/getRootDomain', () => ({
  getRootDomain: () => 'godaddy.com',
}));

vi.mock('./SettingsApiClient', () => ({
  fetchSettingsApi: vi.fn().mockResolvedValue({ sections: [] }),
}));

vi.mock('./CommerceSettingDetail', () => ({
  CommerceSettingDetail: ({ storeId }: { storeId: string }) => (
    <div data-testid="commerce-setting-detail">{storeId}</div>
  ),
}));

vi.mock('./Components', () => ({
  CommerceHomeLinkCard: ({
    title,
    to,
  }: {
    icon?: React.ReactNode;
    title: string;
    content: string;
    to: string;
  }) => (
    <button type="button" onClick={() => window.open(to, '_blank')}>
      {title}
    </button>
  ),
  DebugState: () => null,
  ItemRow: () => null,
  LoadingSpinner: () => <div role="status" aria-label="Loading commerce" />,
  NoticePlaceholder: ({ title }: { title: string }) => <div>{title}</div>,
  SectionHeader: ({ title }: { title: string }) => <div>{title}</div>,
}));

vi.mock('@ux/button', () => ({
  default: ({
    text,
    onClick,
    role,
    'aria-selected': ariaSelected,
    'aria-controls': ariaControls,
    tabIndex,
  }: {
    text: string;
    onClick?: () => void;
    role?: string;
    'aria-selected'?: boolean;
    'aria-controls'?: string;
    tabIndex?: number;
  }) => (
    <button
      type="button"
      role={role}
      aria-selected={ariaSelected}
      aria-controls={ariaControls}
      tabIndex={tabIndex}
      onClick={onClick}
    >
      {text}
    </button>
  ),
}));

vi.mock('@ux/icon/products', () => ({
  default: () => <span data-testid="products-icon" />,
}));

vi.mock('@ux/icon/receipt', () => ({
  default: () => <span data-testid="receipt-icon" />,
}));

vi.mock('@ux/icon/transactions', () => ({
  default: () => <span data-testid="transactions-icon" />,
}));

vi.mock('@ux/text', () => ({
  default: {
    p: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  },
}));

vi.mock('@ux/text-lockup', () => ({
  default: ({
    title,
    children,
  }: {
    title: string;
    children?: React.ReactNode;
  }) => (
    <section>
      <h2>{title}</h2>
      {children}
    </section>
  ),
}));

const mockUseCommerceBinding = vi.mocked(useCommerceBinding);

function mockCommerceBindingQuery(overrides: Record<string, unknown>) {
  mockUseCommerceBinding.mockReturnValue({
    data: undefined,
    error: null,
    isFetching: false,
    isLoading: false,
    refetch: vi.fn(),
    ...overrides,
  } as ReturnType<typeof useCommerceBinding>);
}

function storeBinding(storeId: string): CommerceBinding {
  return {
    appId: 'app-1',
    storeId,
    status: 'store_bound',
    source: 'tool_setup',
    lastVerifiedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('CommercePanel', () => {
  it('renders a loading state instead of dashboard links while the store context resolves', () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    mockCommerceBindingQuery({ isLoading: true });

    renderWithProviders(<CommercePanel appId="app-1" />);

    expect(screen.getByRole('status', { name: 'Loading commerce' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Manage Orders' })).not.toBeInTheDocument();
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('opens Commerce Home links with the resolved store id', async () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    mockCommerceBindingQuery({
      data: { configured: true, binding: storeBinding('store-1') },
    });

    const { user } = renderWithProviders(<CommercePanel appId="app-1" />);

    await user.click(screen.getByRole('button', { name: 'Manage Orders' }));

    expect(openSpy).toHaveBeenCalledWith(
      'https://spa.commerce.godaddy.com/orders?storeId=store-1',
      '_blank'
    );
  });
});
