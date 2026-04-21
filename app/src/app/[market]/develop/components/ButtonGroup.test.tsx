/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';

import { ButtonGroup } from '@/app/[market]/develop/components/ButtonGroup';
import { renderWithProviders } from '@/tests/test-utils';

describe('ButtonGroup', () => {
  const mockOnChange = vi.fn();

  const TestIcon = () => <span data-testid="test-icon">Icon</span>;

  it('should render without crashing', () => {
    renderWithProviders(
      <ButtonGroup value="option1" onChange={mockOnChange}>
        <ButtonGroup.Item value="option1" icon={<TestIcon />} label="Option 1" />
        <ButtonGroup.Item value="option2" icon={<TestIcon />} label="Option 2" />
      </ButtonGroup>
    );

    expect(screen.getByRole('radiogroup')).toBeInTheDocument();
  });

  it('should render all items', () => {
    renderWithProviders(
      <ButtonGroup value="option1" onChange={mockOnChange}>
        <ButtonGroup.Item value="option1" icon={<TestIcon />} label="Option 1" />
        <ButtonGroup.Item value="option2" icon={<TestIcon />} label="Option 2" />
        <ButtonGroup.Item value="option3" icon={<TestIcon />} label="Option 3" />
      </ButtonGroup>
    );

    const buttons = screen.getAllByRole('radio');
    expect(buttons).toHaveLength(3);
  });

  it('should mark active item as checked', () => {
    renderWithProviders(
      <ButtonGroup value="option2" onChange={mockOnChange}>
        <ButtonGroup.Item value="option1" icon={<TestIcon />} label="Option 1" />
        <ButtonGroup.Item value="option2" icon={<TestIcon />} label="Option 2" />
      </ButtonGroup>
    );

    const buttons = screen.getAllByRole('radio');
    expect(buttons[0]).toHaveAttribute('aria-checked', 'false');
    expect(buttons[1]).toHaveAttribute('aria-checked', 'true');
  });

  it('should call onChange when item is clicked', async () => {
    const { user } = renderWithProviders(
      <ButtonGroup value="option1" onChange={mockOnChange}>
        <ButtonGroup.Item value="option1" icon={<TestIcon />} label="Option 1" />
        <ButtonGroup.Item value="option2" icon={<TestIcon />} label="Option 2" />
      </ButtonGroup>
    );

    const buttons = screen.getAllByRole('radio');
    await user.click(buttons[1]);

    expect(mockOnChange).toHaveBeenCalledWith('option2');
  });

  it('should not call onChange when clicking active item', async () => {
    mockOnChange.mockClear();

    const { user } = renderWithProviders(
      <ButtonGroup value="option1" onChange={mockOnChange}>
        <ButtonGroup.Item value="option1" icon={<TestIcon />} label="Option 1" />
        <ButtonGroup.Item value="option2" icon={<TestIcon />} label="Option 2" />
      </ButtonGroup>
    );

    const buttons = screen.getAllByRole('radio');
    await user.click(buttons[0]);

    expect(mockOnChange).toHaveBeenCalledWith('option1');
  });

  it('should disable item when disabled prop is true', () => {
    renderWithProviders(
      <ButtonGroup value="option1" onChange={mockOnChange}>
        <ButtonGroup.Item value="option1" icon={<TestIcon />} label="Option 1" />
        <ButtonGroup.Item value="option2" icon={<TestIcon />} label="Option 2" disabled />
      </ButtonGroup>
    );

    const buttons = screen.getAllByRole('radio');
    expect(buttons[0]).not.toBeDisabled();
    expect(buttons[1]).toBeDisabled();
  });

  it('should not call onChange when disabled item is clicked', async () => {
    mockOnChange.mockClear();

    const { user } = renderWithProviders(
      <ButtonGroup value="option1" onChange={mockOnChange}>
        <ButtonGroup.Item value="option1" icon={<TestIcon />} label="Option 1" />
        <ButtonGroup.Item value="option2" icon={<TestIcon />} label="Option 2" disabled />
      </ButtonGroup>
    );

    const buttons = screen.getAllByRole('radio');
    await user.click(buttons[1]);

    expect(mockOnChange).not.toHaveBeenCalled();
  });

  it('should only show visible label for the active item', () => {
    renderWithProviders(
      <ButtonGroup value="option1" onChange={mockOnChange}>
        <ButtonGroup.Item value="option1" icon={<TestIcon />} label="Option 1" />
        <ButtonGroup.Item value="option2" icon={<TestIcon />} label="Option 2" />
      </ButtonGroup>
    );

    const buttons = screen.getAllByRole('radio');
    expect(buttons[0]).toHaveAttribute('aria-checked', 'true');
    expect(buttons[1]).toHaveAttribute('aria-checked', 'false');
    // The active button renders the label inside the animated span; the inactive one
    // only renders it in the hidden measurement ghost. Both still expose it via aria-label.
    expect(buttons[0]).toHaveAttribute('aria-label', 'Option 1');
    expect(buttons[1]).toHaveAttribute('aria-label', 'Option 2');
  });

  it('should render without labels when label prop is not provided', () => {
    renderWithProviders(
      <ButtonGroup value="option1" onChange={mockOnChange}>
        <ButtonGroup.Item value="option1" icon={<TestIcon />} />
        <ButtonGroup.Item value="option2" icon={<TestIcon />} />
      </ButtonGroup>
    );

    const buttons = screen.getAllByRole('radio');
    expect(buttons).toHaveLength(2);
    // No label text should be present
    expect(screen.queryByText('Option 1')).not.toBeInTheDocument();
    expect(screen.queryByText('Option 2')).not.toBeInTheDocument();
  });

  it('should render icons for all items', () => {
    renderWithProviders(
      <ButtonGroup value="option1" onChange={mockOnChange}>
        <ButtonGroup.Item value="option1" icon={<TestIcon />} label="Option 1" />
        <ButtonGroup.Item value="option2" icon={<TestIcon />} label="Option 2" />
      </ButtonGroup>
    );

    const visibleIcons = screen
      .getAllByTestId('test-icon')
      .filter((el) => !el.closest('[aria-hidden="true"]'));
    expect(visibleIcons).toHaveLength(2);
  });

  it('should render only visible icon for items without labels', () => {
    renderWithProviders(
      <ButtonGroup value="option1" onChange={mockOnChange}>
        <ButtonGroup.Item value="option1" icon={<TestIcon />} />
        <ButtonGroup.Item value="option2" icon={<TestIcon />} />
      </ButtonGroup>
    );

    const icons = screen.getAllByTestId('test-icon');
    expect(icons).toHaveLength(2);
  });

  it('should apply custom className to ButtonGroup', () => {
    const { container } = renderWithProviders(
      <ButtonGroup value="option1" onChange={mockOnChange} className="custom-class">
        <ButtonGroup.Item value="option1" icon={<TestIcon />} label="Option 1" />
      </ButtonGroup>
    );

    const group = container.querySelector('.custom-class');
    expect(group).toBeInTheDocument();
  });

  it('should apply data-eid to ButtonGroup', () => {
    const { container } = renderWithProviders(
      <ButtonGroup value="option1" onChange={mockOnChange} data-eid="test-eid">
        <ButtonGroup.Item value="option1" icon={<TestIcon />} label="Option 1" />
      </ButtonGroup>
    );

    const group = container.querySelector('[data-eid="test-eid"]');
    expect(group).toBeInTheDocument();
  });

  it('should apply data-eid to ButtonGroup.Item', () => {
    const { container } = renderWithProviders(
      <ButtonGroup value="option1" onChange={mockOnChange}>
        <ButtonGroup.Item value="option1" icon={<TestIcon />} label="Option 1" data-eid="item-eid" />
      </ButtonGroup>
    );

    const item = container.querySelector('[data-eid="item-eid"]');
    expect(item).toBeInTheDocument();
  });

  it('should work as standalone button when used outside ButtonGroup with onClick', () => {
    const mockOnClick = vi.fn();

    renderWithProviders(
      <ButtonGroup.Item
        icon={<TestIcon />}
        label="Standalone Button"
        onClick={mockOnClick}
        data-eid="standalone-item"
      />
    );

    const button = screen.getByLabelText('Standalone Button');
    expect(button).toBeInTheDocument();
    expect(button).not.toHaveAttribute('aria-checked');
  });

  it('should handle keyboard interactions', async () => {
    const { user } = renderWithProviders(
      <ButtonGroup value="option1" onChange={mockOnChange}>
        <ButtonGroup.Item value="option1" icon={<TestIcon />} label="Option 1" />
        <ButtonGroup.Item value="option2" icon={<TestIcon />} label="Option 2" />
      </ButtonGroup>
    );

    const buttons = screen.getAllByRole('radio');

    // Focus and press Enter
    buttons[1].focus();
    await user.keyboard('{Enter}');

    expect(mockOnChange).toHaveBeenCalledWith('option2');
  });

  it('should handle Space key to select item', async () => {
    mockOnChange.mockClear();

    const { user } = renderWithProviders(
      <ButtonGroup value="option1" onChange={mockOnChange}>
        <ButtonGroup.Item value="option1" icon={<TestIcon />} label="Option 1" />
        <ButtonGroup.Item value="option2" icon={<TestIcon />} label="Option 2" />
      </ButtonGroup>
    );

    const buttons = screen.getAllByRole('radio');

    // Focus and press Space
    buttons[1].focus();
    await user.keyboard(' ');

    expect(mockOnChange).toHaveBeenCalledWith('option2');
  });

  it('should update active state when value prop changes', () => {
    const { rerender } = renderWithProviders(
      <ButtonGroup value="option1" onChange={mockOnChange}>
        <ButtonGroup.Item value="option1" icon={<TestIcon />} label="Option 1" />
        <ButtonGroup.Item value="option2" icon={<TestIcon />} label="Option 2" />
      </ButtonGroup>
    );

    let buttons = screen.getAllByRole('radio');
    expect(buttons[0]).toHaveAttribute('aria-checked', 'true');
    expect(buttons[1]).toHaveAttribute('aria-checked', 'false');

    rerender(
      <ButtonGroup value="option2" onChange={mockOnChange}>
        <ButtonGroup.Item value="option1" icon={<TestIcon />} label="Option 1" />
        <ButtonGroup.Item value="option2" icon={<TestIcon />} label="Option 2" />
      </ButtonGroup>
    );

    buttons = screen.getAllByRole('radio');
    expect(buttons[0]).toHaveAttribute('aria-checked', 'false');
    expect(buttons[1]).toHaveAttribute('aria-checked', 'true');
  });
});
