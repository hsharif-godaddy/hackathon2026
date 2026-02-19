import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

import { renderWithProviders } from '@/tests/test-utils';
import PlatformSelector from './PlatformSelector';

describe('PlatformSelector', () => {
  const mockOnChange = vi.fn();
  const defaultProps = {
    selectedPlatforms: new Set<'facebook' | 'instagram'>(['facebook', 'instagram']),
    onChange: mockOnChange,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render platform selector label', () => {
    renderWithProviders(<PlatformSelector {...defaultProps} />);

    expect(screen.getByText('builder_marketing_select_platforms')).toBeInTheDocument();
  });

  it('should render Facebook platform option', () => {
    renderWithProviders(<PlatformSelector {...defaultProps} />);

    expect(screen.getByText('builder_marketing_facebook')).toBeInTheDocument();
  });

  it('should render Instagram platform option', () => {
    renderWithProviders(<PlatformSelector {...defaultProps} />);

    expect(screen.getByText('builder_marketing_instagram')).toBeInTheDocument();
  });

  it('should check Facebook checkbox when selected', () => {
    renderWithProviders(<PlatformSelector {...defaultProps} />);

    const checkboxes = screen.getAllByRole('checkbox');
    const facebookCheckbox = checkboxes[0];

    expect(facebookCheckbox).toBeChecked();
  });

  it('should check Instagram checkbox when selected', () => {
    renderWithProviders(<PlatformSelector {...defaultProps} />);

    const checkboxes = screen.getAllByRole('checkbox');
    const instagramCheckbox = checkboxes[1];

    expect(instagramCheckbox).toBeChecked();
  });

  it('should call onChange when Facebook is toggled off', async () => {
    const { user } = renderWithProviders(<PlatformSelector {...defaultProps} />);

    const checkboxes = screen.getAllByRole('checkbox');
    const facebookCheckbox = checkboxes[0];

    await user.click(facebookCheckbox);

    await waitFor(() => {
      expect(mockOnChange).toHaveBeenCalledWith(new Set(['instagram']));
    });
  });

  it('should call onChange when Instagram is toggled off', async () => {
    const { user } = renderWithProviders(<PlatformSelector {...defaultProps} />);

    const checkboxes = screen.getAllByRole('checkbox');
    const instagramCheckbox = checkboxes[1];

    await user.click(instagramCheckbox);

    await waitFor(() => {
      expect(mockOnChange).toHaveBeenCalledWith(new Set(['facebook']));
    });
  });

  it('should add platform when toggled on', async () => {
    const { user } = renderWithProviders(
      <PlatformSelector
        selectedPlatforms={new Set(['facebook'])}
        onChange={mockOnChange}
      />
    );

    const checkboxes = screen.getAllByRole('checkbox');
    const instagramCheckbox = checkboxes[1];

    await user.click(instagramCheckbox);

    await waitFor(() => {
      expect(mockOnChange).toHaveBeenCalledWith(new Set(['facebook', 'instagram']));
    });
  });

  it('should show error when no platforms selected', () => {
    renderWithProviders(
      <PlatformSelector
        selectedPlatforms={new Set()}
        onChange={mockOnChange}
      />
    );

    expect(screen.getByText('builder_marketing_select_at_least_one_platform')).toBeInTheDocument();
  });

  it('should not show error when at least one platform selected', () => {
    renderWithProviders(
      <PlatformSelector
        selectedPlatforms={new Set(['facebook'])}
        onChange={mockOnChange}
      />
    );

    expect(screen.queryByText('builder_marketing_select_at_least_one_platform')).not.toBeInTheDocument();
  });

  it('should apply selected styling to Facebook when checked', () => {
    renderWithProviders(<PlatformSelector {...defaultProps} />);

    const facebookLabel = screen.getByText('builder_marketing_facebook').closest('label');

    expect(facebookLabel).toHaveClass('border-intents-ux-actionPrimary-borderColor');
    expect(facebookLabel).toHaveClass('bg-intents-ux-actionPrimary-backgroundColor/10');
  });

  it('should apply unselected styling to Facebook when not checked', () => {
    renderWithProviders(
      <PlatformSelector
        selectedPlatforms={new Set(['instagram'])}
        onChange={mockOnChange}
      />
    );

    const facebookLabel = screen.getByText('builder_marketing_facebook').closest('label');

    expect(facebookLabel).toHaveClass('border-intents-ux-boxLowContrast-borderColor');
    expect(facebookLabel).toHaveClass('bg-intents-ux-boxStandard-backgroundColor');
  });

  it('should maintain independent state for each platform', async () => {
    const { user } = renderWithProviders(<PlatformSelector {...defaultProps} />);

    const checkboxes = screen.getAllByRole('checkbox');
    const facebookCheckbox = checkboxes[0];

    // Uncheck Facebook
    await user.click(facebookCheckbox);

    await waitFor(() => {
      expect(mockOnChange).toHaveBeenCalledWith(new Set(['instagram']));
    });

    // Instagram should still be in the set
    const lastCall = mockOnChange.mock.calls[mockOnChange.mock.calls.length - 1][0];
    expect(lastCall.has('instagram')).toBe(true);
    expect(lastCall.has('facebook')).toBe(false);
  });

  it('should allow toggling same platform multiple times', async () => {
    const { user } = renderWithProviders(<PlatformSelector {...defaultProps} />);

    const checkboxes = screen.getAllByRole('checkbox');
    const facebookCheckbox = checkboxes[0];

    // First toggle - uncheck
    await user.click(facebookCheckbox);
    await waitFor(() => {
      expect(mockOnChange).toHaveBeenCalledTimes(1);
    });

    // Re-render with new props
    const { user: user2 } = renderWithProviders(
      <PlatformSelector
        selectedPlatforms={new Set(['instagram'])}
        onChange={mockOnChange}
      />
    );

    const checkboxes2 = screen.getAllByRole('checkbox');
    const facebookCheckbox2 = checkboxes2[0];

    // Second toggle - check again
    await user2.click(facebookCheckbox2);

    await waitFor(() => {
      expect(mockOnChange).toHaveBeenCalledTimes(2);
    });
  });
});
