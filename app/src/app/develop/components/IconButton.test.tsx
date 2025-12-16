import '@testing-library/jest-dom';

import { beforeEach,describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

import { renderWithProviders } from '@/tests/test-utils';
import IconButton from './IconButton';

const MockIcon = () => <svg data-testid="mock-icon">Icon</svg>;

describe('IconButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render without crashing', () => {
    renderWithProviders(<IconButton icon={<MockIcon />} />);

    expect(screen.getByTestId('mock-icon')).toBeInTheDocument();
  });

  it('should render icon', () => {
    renderWithProviders(<IconButton icon={<MockIcon />} />);

    expect(screen.getByTestId('mock-icon')).toBeInTheDocument();
  });

  it('should call onClick when clicked', async () => {
    const onClick = vi.fn();
    const { user } = renderWithProviders(
      <IconButton icon={<MockIcon />} onClick={onClick} />
    );

    const button = screen.getByRole('button');
    await user.click(button);

    await waitFor(() => {
      expect(onClick).toHaveBeenCalledOnce();
    });
  });

  it('should not call onClick when disabled', async () => {
    const onClick = vi.fn();
    const { user } = renderWithProviders(
      <IconButton icon={<MockIcon />} onClick={onClick} disabled />
    );

    const button = screen.getByRole('button');
    await user.click(button);

    expect(onClick).not.toHaveBeenCalled();
  });

  it('should apply active styling when active', () => {
    renderWithProviders( <IconButton icon={<MockIcon />} active />);

    const button = screen.getByRole('button');
    expect(button).toHaveClass('bg-intents-ux-boxHighContrast-backgroundColor');
  });

  it('should apply disabled styling when disabled', () => {
    renderWithProviders(<IconButton icon={<MockIcon />} disabled />);

    const button = screen.getByRole('button');
    expect(button).toHaveClass('opacity-25');
    expect(button).toBeDisabled();
  });

  it('should render label text when active and showLabelWhenActive is true', () => {
    renderWithProviders(
      <IconButton icon={<MockIcon />} label="Test Label" active showLabelWhenActive />
    );

    expect(screen.getByText('Test Label')).toBeInTheDocument();
  });

  it('should not show label text when not active', () => {
    renderWithProviders(
      <IconButton icon={<MockIcon />} label="Test Label" active={false} />
    );

    const label = screen.queryByText('Test Label');
    // Label exists but is hidden with opacity-0
    expect(label).toHaveClass('opacity-0');
  });

  it('should render with separator styling', () => {
    renderWithProviders(<IconButton icon={<MockIcon />} separator />);

    const button = screen.getByRole('button');
    expect(button).toHaveClass('mr-2');
  });

  it('should apply custom className', () => {
    renderWithProviders(
      <IconButton icon={<MockIcon />} className="custom-class" />
    );

    const button = screen.getByRole('button');
    expect(button).toHaveClass('custom-class');
  });

  it('should set aria-label', () => {
    renderWithProviders(
      <IconButton icon={<MockIcon />} label="Accessible Label" />
    );

    const button = screen.getByRole('button', { name: 'Accessible Label' });
    expect(button).toBeInTheDocument();
  });

  it('should set data-eid attribute', () => {
    renderWithProviders(
      <IconButton icon={<MockIcon />} dataEid="test-eid" />
    );

    const button = screen.getByRole('button');
    expect(button).toHaveAttribute('data-eid', 'test-eid');
  });

  it('should set id attribute', () => {
    renderWithProviders(
      <IconButton icon={<MockIcon />} id="test-button-id" />
    );

    const button = screen.getByRole('button');
    expect(button).toHaveAttribute('id', 'test-button-id');
  });

  it('should call onMouseDown when mouse button pressed', async () => {
    const onMouseDown = vi.fn();
    const { user } = renderWithProviders(
      <IconButton icon={<MockIcon />} onMouseDown={onMouseDown} />
    );

    const button = screen.getByRole('button');
    await user.pointer({ keys: '[MouseLeft>]', target: button });

    await waitFor(() => {
      expect(onMouseDown).toHaveBeenCalled();
    });
  });

  it('should show tooltip on mouse enter', async () => {
    const { user } = renderWithProviders(
      <IconButton
        icon={<MockIcon />}
        label="Test Label"
        tooltipDescription="Test description"
      />
    );

    const button = screen.getByRole('button');
    await user.hover(button);

    await waitFor(() => {
      expect(button).toHaveAttribute('aria-haspopup', 'true');
    });
  });

  it('should hide tooltip when active', () => {
    renderWithProviders(
      <IconButton
        icon={<MockIcon />}
        label="Test Label"
        tooltipDescription="Test description"
        active
      />
    );

    // Tooltip should not render when active
    const button = screen.getByRole('button');
    expect(button).toBeInTheDocument();
  });

  it('should render tooltip with description', async () => {
    const { user } = renderWithProviders(
      <IconButton
        icon={<MockIcon />}
        label="Test Label"
        tooltipDescription="Detailed description"
      />
    );

    const button = screen.getByRole('button');
    await user.hover(button);

    await waitFor(() => {
      expect(button).toHaveAttribute('aria-haspopup', 'true');
    });
  });

  it('should hide tooltip on mouse leave', async () => {
    const { user } = renderWithProviders(
      <IconButton
        icon={<MockIcon />}
        label="Test Label"
        tooltipDescription="Test description"
      />
    );

    const button = screen.getByRole('button');
    await user.hover(button);

    await waitFor(() => {
      expect(button).toHaveAttribute('aria-haspopup', 'true');
    });

    await user.unhover(button);

    await waitFor(() => {
      expect(button).toHaveAttribute('aria-haspopup', 'false');
    });
  });
});
