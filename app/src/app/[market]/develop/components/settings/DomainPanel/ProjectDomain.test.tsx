/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';

import { DomainStatus, DomainType } from '@/lib/control-plane/types';
import { createMockSite, mockInstrumentation } from '@/tests/mocks';
import { renderWithProviders } from '@/tests/test-utils';
import ProjectDomain from './ProjectDomain';

const mockUseDomainValidationQuery = vi.fn();

vi.mock('@/hooks/useDomainValidationQuery', () => ({
  useDomainValidationQuery: (...args: unknown[]) => mockUseDomainValidationQuery(...args),
}));

vi.mock('@/hooks/useAppName', () => ({
  useAppNameUpdate: vi.fn(() => ({
    mutateAsync: vi.fn(),
    isPending: false,
    error: null,
    reset: vi.fn(),
  })),
}));

vi.mock('@/app/[market]/develop/components/utils', () => ({
  useAppIdFromParams: vi.fn(() => 'my-app-id'),
}));

vi.mock('@/stores/useSiteStore', () => ({
  useSiteStore: vi.fn(),
}));

vi.mock('@/utils/instrumentation', () => mockInstrumentation());

vi.mock('@/lib/logging', () => ({
  shipAnalyticsLog: vi.fn(),
}));

vi.mock('@ux/growl', () => ({
  default: {
    addGrowlMessage: vi.fn(),
  },
}));

vi.mock('@/hooks/useBreakpoints', () => ({
  useBreakpoints: vi.fn(() => ({
    isBelowSmBreakpoint: false,
    isSmBreakpoint: true,
    isMdBreakpoint: true,
    isLgBreakpoint: true,
    isXlBreakpoint: true,
  })),
}));

function setupSite(prefix = 'my-app-id') {
  const mockSite = createMockSite({
    variants: ['publish'],
    id: 'my-app-id',
    domains: [
      {
        domainType: DomainType.PREFIX,
        status: DomainStatus.ACTIVE,
        prefix,
        fqdn: `${prefix}.airoapp.ai`,
      },
    ],
  });

  return mockSite;
}

describe('ProjectDomain input validation', function projectDomainValidationTests() {
  beforeEach(function setup() {
    vi.clearAllMocks();
    mockUseDomainValidationQuery.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: false,
    });
  });

  async function renderProjectDomain(prefix = 'my-app-id') {
    const { useSiteStore } = await import('@/stores/useSiteStore');
    const mockSite = setupSite(prefix);

    vi.mocked(useSiteStore).mockImplementation((selector: (state: unknown) => unknown) => {
      const state = {
        getSite: vi.fn(() => mockSite),
        fetchSite: vi.fn(),
        loading: {},
      };
      return selector(state);
    });

    renderWithProviders(<ProjectDomain />);
  }

  async function renderEditingProjectDomain(prefix = 'my-app-id') {
    await renderProjectDomain(prefix);
    fireEvent.click(screen.getByTestId('project-domain-url-display'));
  }

  it('enters edit mode when the URL bar is clicked', async function entersEditModeFromUrlBar() {
    await renderProjectDomain();

    fireEvent.click(screen.getByTestId('project-domain-url-display'));

    await waitFor(function waitForEditInput() {
      expect(document.getElementById('project-domain-name')).toBe(document.activeElement);
    });
  });

  it('opens a bottom sheet on mobile when Edit URL is clicked', async function opensEditSheetOnMobile() {
    const { useBreakpoints } = await import('@/hooks/useBreakpoints');
    vi.mocked(useBreakpoints).mockReturnValue({
      isBelowSmBreakpoint: true,
      isSmBreakpoint: false,
      isMdBreakpoint: false,
      isLgBreakpoint: false,
      isXlBreakpoint: false,
    });

    await renderProjectDomain();

    fireEvent.click(screen.getByRole('button', { name: 'Edit URL' }));

    expect(screen.getByTestId('project-domain-edit-sheet')).toBeInTheDocument();
    expect(screen.getByTestId('project-domain-url-bar')).toBeInTheDocument();
    expect(screen.getByTestId('project-domain-edit-actions')).toBeInTheDocument();
    expect(document.getElementById('project-domain-name')).toBeInTheDocument();
  });

  it('shows the domain suffix in edit mode', async function showsDomainSuffix() {
    await renderEditingProjectDomain();

    const input = document.getElementById('project-domain-name');
    const suggestion = input
      ?.closest('.ux-text-entry-shell')
      ?.querySelector('.ux-text-entry-suggestion');

    expect(suggestion).toHaveTextContent('my-app-id.airoapp.ai');
  });

  it('shows a min-length error when fewer than 5 characters are entered', async function showsMinLengthError() {
    await renderEditingProjectDomain();

    const input = document.getElementById('project-domain-name');
    expect(input).toBeTruthy();
    fireEvent.change(input!, { target: { value: 'abcd' } });

    expect(
      screen.getByText('You must enter at least 5 characters.'),
    ).toBeInTheDocument();
  });

  it('shows a green availability message when the domain is available', async function showsAvailableMessage() {
    await renderEditingProjectDomain();

    const input = document.getElementById('project-domain-name');
    expect(input).toBeTruthy();
    fireEvent.change(input!, { target: { value: 'new-domain' } });

    mockUseDomainValidationQuery.mockReturnValue({
      data: { available: true, errors: [] },
      isLoading: false,
      isError: false,
    });

    await waitFor(function waitForAvailableMessage() {
      expect(screen.getByText('Domain is available')).toBeInTheDocument();
    });

    expect(screen.getByText('Domain is available')).toHaveClass('text-intents-ux-success-textColor');
  });

  it('shows a taken message when the subdomain is already in use', async function showsTakenMessage() {
    await renderEditingProjectDomain();

    const input = document.getElementById('project-domain-name');
    expect(input).toBeTruthy();
    fireEvent.change(input!, { target: { value: 'taken-name' } });

    mockUseDomainValidationQuery.mockReturnValue({
      data: {
        available: false,
        errors: [{ code: 'DOMAIN_NOT_UNIQUE', message: 'Already taken', field: 'projectPrefix' }],
      },
      isLoading: false,
      isError: false,
    });

    await waitFor(function waitForTakenMessage() {
      expect(
        screen.getByText('This URL is already in use. Please choose a different one.'),
      ).toBeInTheDocument();
    });
  });

  it('shows a network error message when validation fails', async function showsNetworkErrorMessage() {
    await renderEditingProjectDomain();

    const input = document.getElementById('project-domain-name');
    expect(input).toBeTruthy();
    fireEvent.change(input!, { target: { value: 'new-domain' } });

    mockUseDomainValidationQuery.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
    });

    await waitFor(function waitForNetworkErrorMessage() {
      expect(screen.getByText('Something went wrong. Please try again.')).toBeInTheDocument();
    });
  });

  it('shows a custom domain hint for .com style input', async function showsCustomDomainHint() {
    await renderEditingProjectDomain();

    const input = document.getElementById('project-domain-name') as HTMLInputElement;
    expect(input).toBeTruthy();
    fireEvent.change(input!, { target: { value: 'example.com' } });

    expect(
      screen.getByText('To add a custom domain visit External Domain section above'),
    ).toBeInTheDocument();
  });

  it('shows an invalid characters error for disallowed special characters', async function showsInvalidCharactersError() {
    await renderEditingProjectDomain();

    const input = document.getElementById('project-domain-name') as HTMLInputElement;
    expect(input).toBeTruthy();
    fireEvent.change(input!, { target: { value: 'my_site' } });

    expect(input.value).toBe('my_site');
    expect(
      screen.getByText('Only letters, numbers, periods (.), and hyphens (-) are allowed.'),
    ).toBeInTheDocument();
  });

  it('shows a bounds error when the URL starts with a special character', async function showsInvalidBoundsErrorForLeadingSpecialCharacter() {
    await renderEditingProjectDomain();

    const input = document.getElementById('project-domain-name') as HTMLInputElement;
    expect(input).toBeTruthy();
    fireEvent.change(input!, { target: { value: '-myapp' } });

    expect(
      screen.getByText('URL must start and end with a letter or number'),
    ).toBeInTheDocument();
  });

  it('shows a bounds error as soon as the first character is special', async function showsInvalidBoundsErrorForFirstCharacter() {
    await renderEditingProjectDomain();

    const input = document.getElementById('project-domain-name') as HTMLInputElement;
    expect(input).toBeTruthy();
    fireEvent.change(input!, { target: { value: '/' } });

    expect(
      screen.getByText('URL must start and end with a letter or number'),
    ).toBeInTheDocument();
    expect(
      screen.queryByText('You must enter at least 5 characters.'),
    ).not.toBeInTheDocument();
  });

  it('shows a bounds error when the URL ends with a special character', async function showsInvalidBoundsErrorForTrailingSpecialCharacter() {
    await renderEditingProjectDomain();

    const input = document.getElementById('project-domain-name') as HTMLInputElement;
    expect(input).toBeTruthy();
    fireEvent.change(input!, { target: { value: 'myapp-' } });

    expect(
      screen.getByText('URL must start and end with a letter or number'),
    ).toBeInTheDocument();
  });
});
