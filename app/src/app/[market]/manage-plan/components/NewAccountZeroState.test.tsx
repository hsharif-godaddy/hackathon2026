/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';

import { renderWithProviders } from '@/tests/test-utils';
import NewAccountZeroState from './NewAccountZeroState';

const mockPush = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('@/utils/instrumentation', () => ({
  generateClickEID: vi.fn(function (event: string) { return `${event}.click`; }),
}));

describe('NewAccountZeroState', function newAccountZeroStateTests() {
  beforeEach(function setup() {
    vi.clearAllMocks();
  });

  it('should render welcome title', function renderTitle() {
    renderWithProviders(<NewAccountZeroState />);

    expect(screen.getByText('builder_manageplan_newaccount_title')).toBeInTheDocument();
  });

  it('should render description about creating an app', function renderDescription() {
    renderWithProviders(<NewAccountZeroState />);

    expect(screen.getByText('builder_manageplan_newaccount_description')).toBeInTheDocument();
  });

  it('should render create app button', function renderButton() {
    renderWithProviders(<NewAccountZeroState />);

    expect(screen.getByRole('button', { name: 'builder_manageplan_newaccount_cta' })).toBeInTheDocument();
  });

  it('should navigate to home page when create app button is clicked', async function navigateOnClick() {
    const { user } = renderWithProviders(<NewAccountZeroState />);

    await user.click(screen.getByRole('button', { name: 'builder_manageplan_newaccount_cta' }));

    expect(mockPush).toHaveBeenCalledWith('/');
  });

  it('should have correct analytics EID on button', function correctEid() {
    renderWithProviders(<NewAccountZeroState />);

    const button = screen.getByRole('button', { name: 'builder_manageplan_newaccount_cta' });
    expect(button).toHaveAttribute('data-eid', 'manageplan.new_account.create_app.click');
  });
});
