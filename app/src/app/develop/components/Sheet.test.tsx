/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

import { renderWithProviders } from '@/tests/test-utils';
import { Sheet } from './Sheet';

describe('Sheet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render when isOpen is true', () => {
    renderWithProviders(
      <Sheet isOpen={true} onClose={vi.fn()} title="Test Sheet">
        <div data-testid="sheet-content">Content</div>
      </Sheet>
    );

    expect(screen.getByText('Test Sheet')).toBeInTheDocument();
    expect(screen.getByTestId('sheet-content')).toBeInTheDocument();
  });

  it('should not render content when isOpen is false', () => {
    renderWithProviders(
      <Sheet isOpen={false} onClose={vi.fn()} title="Test Sheet">
        <div data-testid="sheet-content">Content</div>
      </Sheet>
    );

    expect(screen.queryByTestId('sheet-content')).not.toBeInTheDocument();
  });

  it('should display the provided title', () => {
    renderWithProviders(
      <Sheet isOpen={true} onClose={vi.fn()} title="My Custom Title">
        <div>Content</div>
      </Sheet>
    );

    expect(screen.getByText('My Custom Title')).toBeInTheDocument();
  });

  it('should render children content', () => {
    renderWithProviders(
      <Sheet isOpen={true} onClose={vi.fn()} title="Test Sheet">
        <div data-testid="child-1">Child 1</div>
        <div data-testid="child-2">Child 2</div>
      </Sheet>
    );

    expect(screen.getByTestId('child-1')).toBeInTheDocument();
    expect(screen.getByTestId('child-2')).toBeInTheDocument();
  });

  it('should render buttons in footer when provided', () => {
    const buttons = (
      <>
        <button data-testid="button-1">Button 1</button>
        <button data-testid="button-2">Button 2</button>
      </>
    );

    renderWithProviders(
      <Sheet isOpen={true} onClose={vi.fn()} title="Test Sheet" buttons={buttons}>
        <div>Content</div>
      </Sheet>
    );

    expect(screen.getByTestId('button-1')).toBeInTheDocument();
    expect(screen.getByTestId('button-2')).toBeInTheDocument();
  });

  it('should not render footer when buttons are not provided', () => {
    renderWithProviders(
      <Sheet isOpen={true} onClose={vi.fn()} title="Test Sheet">
        <div>Content</div>
      </Sheet>
    );

    // Query from document because Radix Dialog renders in a portal
    const footer = document.querySelector('[data-slot="sheet-footer"]');
    expect(footer).not.toBeInTheDocument();
  });

  it('should call onClose when sheet is closed', async () => {
    const onClose = vi.fn();
    const { user } = renderWithProviders(
      <Sheet isOpen={true} onClose={onClose} title="Test Sheet">
        <div>Content</div>
      </Sheet>
    );

    // Find and click the close button (X icon)
    const closeButton = screen.getByRole('button', { name: /close/i });
    await user.click(closeButton);

    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
  });

  it('should accept onTouchStart handler', () => {
    const onTouchStart = vi.fn();
    renderWithProviders(
      <Sheet
        isOpen={true}
        onClose={vi.fn()}
        title="Test Sheet"
        onTouchStart={onTouchStart}
      >
        <div>Content</div>
      </Sheet>
    );

    const sheetContent = screen.getByText('Test Sheet').closest('[data-slot="sheet-content"]');
    expect(sheetContent).toBeInTheDocument();
    expect(sheetContent).toHaveAttribute('data-slot', 'sheet-content');
  });

  it('should accept onTouchEnd handler', () => {
    const onTouchEnd = vi.fn();
    renderWithProviders(
      <Sheet
        isOpen={true}
        onClose={vi.fn()}
        title="Test Sheet"
        onTouchEnd={onTouchEnd}
      >
        <div>Content</div>
      </Sheet>
    );

    const sheetContent = screen.getByText('Test Sheet').closest('[data-slot="sheet-content"]');
    expect(sheetContent).toBeInTheDocument();
    expect(sheetContent).toHaveAttribute('data-slot', 'sheet-content');
  });

  it('should render without touch handlers', () => {
    renderWithProviders(
      <Sheet isOpen={true} onClose={vi.fn()} title="Test Sheet">
        <div>Content</div>
      </Sheet>
    );

    const sheetContent = screen.getByText('Test Sheet').closest('[data-slot="sheet-content"]');
    expect(sheetContent).toBeInTheDocument();
    expect(sheetContent).toHaveAttribute('data-slot', 'sheet-content');
  });

  it('should render with left side by default', () => {
    renderWithProviders(
      <Sheet isOpen={true} onClose={vi.fn()} title="Test Sheet">
        <div>Content</div>
      </Sheet>
    );

    const sheetContent = screen.getByText('Test Sheet').closest('[data-slot="sheet-content"]');
    expect(sheetContent).toHaveClass('w-full');
    expect(sheetContent).toHaveClass('!max-w-[425px]');
  });

  it('should apply custom className to SheetContent', () => {
    renderWithProviders(
      <Sheet isOpen={true} onClose={vi.fn()} title="Test Sheet">
        <div>Content</div>
      </Sheet>
    );

    const sheetContent = screen.getByText('Test Sheet').closest('[data-slot="sheet-content"]');
    expect(sheetContent).toHaveClass('overflow-y-auto');
  });

  it('should have proper accessibility attributes', () => {
    renderWithProviders(
      <Sheet isOpen={true} onClose={vi.fn()} title="Test Sheet">
        <div>Content</div>
      </Sheet>
    );

    // Dialog role should be present (from Radix Dialog)
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();

    // Close button should have proper label
    const closeButton = screen.getByRole('button', { name: /close/i });
    expect(closeButton).toBeInTheDocument();
  });

  it('should render content inside flex-1 px-2 container', () => {
    renderWithProviders(
      <Sheet isOpen={true} onClose={vi.fn()} title="Test Sheet">
        <div data-testid="content">Content</div>
      </Sheet>
    );

    const contentContainer = screen.getByTestId('content').parentElement;
    expect(contentContainer).toHaveClass('flex-1');
    expect(contentContainer).toHaveClass('px-2');
  });

  it('should render footer with proper styling when buttons provided', () => {
    const buttons = <button>Action Button</button>;
    renderWithProviders(
      <Sheet isOpen={true} onClose={vi.fn()} title="Test Sheet" buttons={buttons}>
        <div>Content</div>
      </Sheet>
    );

    // Query from document because Radix Dialog renders in a portal
    const footer = document.querySelector('[data-slot="sheet-footer"]');
    expect(footer).toBeInTheDocument();
    expect(footer).toHaveClass('pt-2');

    const buttonContainer = footer?.querySelector('.flex.gap-2.w-full');
    expect(buttonContainer).toBeInTheDocument();
  });

  it('should render header with proper structure', () => {
    renderWithProviders(
      <Sheet isOpen={true} onClose={vi.fn()} title="Test Sheet">
        <div>Content</div>
      </Sheet>
    );

    // Query from document because Radix Dialog renders in a portal
    const header = document.querySelector('[data-slot="sheet-header"]');
    expect(header).toBeInTheDocument();
    expect(header).toHaveClass('space-y-3');

    const titleContainer = header?.querySelector('.flex.items-center.justify-between');
    expect(titleContainer).toBeInTheDocument();
  });

  it('should handle complex children rendering', () => {
    const ComplexChild = () => (
      <div data-testid="complex-child">
        <h2>Nested Title</h2>
        <p>Nested paragraph</p>
        <ul>
          <li>Item 1</li>
          <li>Item 2</li>
        </ul>
      </div>
    );

    renderWithProviders(
      <Sheet isOpen={true} onClose={vi.fn()} title="Test Sheet">
        <ComplexChild />
      </Sheet>
    );

    expect(screen.getByTestId('complex-child')).toBeInTheDocument();
    expect(screen.getByText('Nested Title')).toBeInTheDocument();
    expect(screen.getByText('Nested paragraph')).toBeInTheDocument();
    expect(screen.getByText('Item 1')).toBeInTheDocument();
    expect(screen.getByText('Item 2')).toBeInTheDocument();
  });

  it('should handle multiple button elements in footer', () => {
    const buttons = (
      <>
        <button data-testid="save-btn">Save</button>
        <button data-testid="cancel-btn">Cancel</button>
        <button data-testid="reset-btn">Reset</button>
      </>
    );

    renderWithProviders(
      <Sheet isOpen={true} onClose={vi.fn()} title="Test Sheet" buttons={buttons}>
        <div>Content</div>
      </Sheet>
    );

    expect(screen.getByTestId('save-btn')).toBeInTheDocument();
    expect(screen.getByTestId('cancel-btn')).toBeInTheDocument();
    expect(screen.getByTestId('reset-btn')).toBeInTheDocument();
  });
});
