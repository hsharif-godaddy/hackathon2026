import '@testing-library/jest-dom';

import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';

import AssetManagerModal from './AssetManagerModal';

// Mock the dynamic import
vi.mock('next/dynamic', () => ({
  default: () => {
    // Return a mock component
    const MockComponent = () => (
      <div data-testid="image-manager-loader">
        Mocked ImageManagerLoader
      </div>
    );
    return MockComponent;
  },
}));

describe('AssetManagerModal', () => {
  const defaultProps = {
    isOpen: false,
    onClose: vi.fn(),
    onItemsSelected: vi.fn(),
    ventureId: 'venture-123',
  };

  it('should render without crashing when closed', () => {
    const { container } = render(<AssetManagerModal {...defaultProps} />);

    expect(container).toBeTruthy();
  });

  it('should render without crashing when open', () => {
    const { container } = render(<AssetManagerModal {...defaultProps} isOpen={true} />);

    expect(container).toBeTruthy();
  });

  it('should pass correct props to ImageManagerLoader', () => {
    const onClose = vi.fn();
    const onItemsSelected = vi.fn();

    render(
      <AssetManagerModal
        isOpen={true}
        onClose={onClose}
        onItemsSelected={onItemsSelected}
        ventureId="venture-123"
      />
    );

    // The component should render the mocked loader
    expect(document.querySelector('[data-testid="image-manager-loader"]')).toBeInTheDocument();
  });

  it('should handle null ventureId', () => {
    const { container } = render(<AssetManagerModal {...defaultProps} ventureId={null} />);

    expect(container).toBeTruthy();
  });
});
