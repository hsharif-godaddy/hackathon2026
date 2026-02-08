import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';

import { renderWithProviders } from '@/tests/test-utils';
import * as getRootDomainModule from '@/utils/getRootDomain';
import TeamPanel from './TeamPanel';

// Mock getRootDomain
vi.mock('@/utils/getRootDomain');

describe('TeamPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render without crashing', async () => {
    renderWithProviders(<TeamPanel />);

    expect(document.body).toBeTruthy();
  });

  it('should display team settings title', () => {
    renderWithProviders(<TeamPanel />);

    expect(screen.getByText('builder_settings_team_title')).toBeInTheDocument();
  });

  it('should display delegation description', () => {
    renderWithProviders(<TeamPanel />);

    expect(screen.getByText('builder_settings_team_description')).toBeInTheDocument();
  });

  it('should have manage delegation button', () => {
    renderWithProviders(<TeamPanel />);

    const button = screen.getByRole('link', { name: /builder_settings_team_manage_access/i });
    expect(button).toBeInTheDocument();
  });

  it('should use production SSO URL when domain is godaddy.com', () => {
    vi.mocked(getRootDomainModule.getRootDomain).mockReturnValue('godaddy.com');

    renderWithProviders(<TeamPanel />);

    const link = screen.getByRole('link', { name: /builder_settings_team_manage_access/i });
    expect(link).toHaveAttribute('href', 'https://sso.godaddy.com/access');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('should use test SSO URL when domain is test-godaddy.com', () => {
    vi.mocked(getRootDomainModule.getRootDomain).mockReturnValue('test-godaddy.com');

    renderWithProviders(<TeamPanel />);

    const link = screen.getByRole('link', { name: /builder_settings_team_manage_access/i });
    expect(link).toHaveAttribute('href', 'https://sso.test-godaddy.com/access');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('should default to production SSO URL when getRootDomain returns null', () => {
    vi.mocked(getRootDomainModule.getRootDomain).mockReturnValue(null);

    renderWithProviders(<TeamPanel />);

    const link = screen.getByRole('link', { name: /builder_settings_team_manage_access/i });
    expect(link).toHaveAttribute('href', 'https://sso.godaddy.com/access');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });
});
