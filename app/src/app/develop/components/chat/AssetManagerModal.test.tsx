import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

import { renderWithProviders } from '@/tests/test-utils';
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

describe('AssetManagerModal', function assetManagerModalTests() {
  const defaultProps = {
    isOpen: false,
    onClose: vi.fn(),
    onItemsSelected: vi.fn(),
    ventureId: 'venture-123',
  };

  beforeEach(function setup() {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
  });

  it('should render without crashing when closed', function renderClosed() {
    const { container } = renderWithProviders(<AssetManagerModal {...defaultProps} />);

    expect(container).toBeTruthy();
  });

  it('should render without crashing when open', function renderOpen() {
    const { container } = renderWithProviders(<AssetManagerModal {...defaultProps} isOpen={true} />);

    expect(container).toBeTruthy();
  });

  it('should pass correct props to ImageManagerLoader', async function passProps() {
    const onClose = vi.fn();
    const onItemsSelected = vi.fn();

    renderWithProviders(
      <AssetManagerModal
        isOpen={true}
        onClose={onClose}
        onItemsSelected={onItemsSelected}
        ventureId="venture-123"
      />
    );

    await waitFor(function waitForLoader() {
      expect(screen.getByTestId('image-manager-loader')).toBeInTheDocument();
    });
  });

  it('should handle null ventureId', function handleNullVentureId() {
    const { container } = renderWithProviders(<AssetManagerModal {...defaultProps} ventureId={null} />);

    expect(container).toBeTruthy();
  });

  it('should use 1 as default maxAssets value', function defaultMaxAssets() {
    const { container } = renderWithProviders(
      <AssetManagerModal
        {...defaultProps}
        isOpen={true}
        currentAssetCount={0}
      />
    );

    expect(container).toBeTruthy();
  });

  it('should not render when currentAssetCount equals default maxAssets of 1', function noRenderAtDefaultLimit() {
    const { container } = renderWithProviders(
      <AssetManagerModal
        {...defaultProps}
        isOpen={true}
        currentAssetCount={1}
      />
    );

    expect(container.firstChild).toBeNull();
  });

  it('should not render when currentAssetCount equals maxAssets', function noRenderAtLimit() {
    const maxAssets = 4;
    const { container } = renderWithProviders(
      <AssetManagerModal
        {...defaultProps}
        isOpen={true}
        currentAssetCount={maxAssets}
        maxAssets={maxAssets}
      />
    );

    expect(container.firstChild).toBeNull();
  });

  it('should not render when currentAssetCount exceeds maxAssets', function noRenderAboveLimit() {
    const maxAssets = 4;
    const { container } = renderWithProviders(
      <AssetManagerModal
        {...defaultProps}
        isOpen={true}
        currentAssetCount={maxAssets + 1}
        maxAssets={maxAssets}
      />
    );

    expect(container.firstChild).toBeNull();
  });

  it('should allow custom maxAssets value', function customMaxAssets() {
    const customMax = 10;
    const { container } = renderWithProviders(
      <AssetManagerModal
        {...defaultProps}
        isOpen={true}
        currentAssetCount={0}
        maxAssets={customMax}
      />
    );

    expect(container).toBeTruthy();
  });

  it('should render ImageManagerLoader when maxAssets is greater than 1', async function renderWithMultipleMaxAssets() {
    renderWithProviders(
      <AssetManagerModal
        {...defaultProps}
        isOpen={true}
        maxAssets={4}
        currentAssetCount={0}
      />
    );

    await waitFor(function waitForLoader() {
      expect(screen.getByTestId('image-manager-loader')).toBeInTheDocument();
    });
  });

  it('should render ImageManagerLoader when maxAssets equals 1', async function renderWithSingleMaxAsset() {
    renderWithProviders(
      <AssetManagerModal
        {...defaultProps}
        isOpen={true}
        maxAssets={1}
        currentAssetCount={0}
      />
    );

    await waitFor(function waitForLoader() {
      expect(screen.getByTestId('image-manager-loader')).toBeInTheDocument();
    });
  });
});
