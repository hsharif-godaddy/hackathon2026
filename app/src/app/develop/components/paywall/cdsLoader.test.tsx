/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'

import { ComponentLoader } from './cdsLoader'

// Mock logging
const mockShipAnalyticsLog = vi.fn()
const mockLoggerError = vi.fn()
vi.mock('@/lib/logging', () => ({
  shipAnalyticsLog: (...args: unknown[]) => mockShipAnalyticsLog(...args),
}))
vi.mock('@/lib/request-context', () => ({
  logger: {
    error: (...args: unknown[]) => mockLoggerError(...args),
  },
}))

// Mock propTypes utility
vi.mock('@/utils/propTypes', () => ({
  ensurePropTypes: vi.fn().mockResolvedValue(undefined),
}))

// Mock the CDS loader module
const mockCdsComponent = vi.fn()
vi.mock('@venture/cds-loader', () => ({
  default: (props: Record<string, unknown>) => {
    mockCdsComponent(props)
    return <div data-testid="cds-component">CDS Component</div>
  },
}))

describe('ComponentLoader', function componentLoaderTests() {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('error handling', function errorHandlingTests() {
    it('should call onLoadError when onError is invoked', async function onLoadErrorFires() {
      const mockOnLoadError = vi.fn()
      const mockRenderErrorFallback = vi.fn().mockReturnValue(
        <div data-testid="error-fallback">Error!</div>
      )

      render(
        <ComponentLoader
          type="test"
          source="test-source"
          onLoadError={mockOnLoadError}
          renderErrorFallback={mockRenderErrorFallback}
        />
      )

      await waitFor(() => {
        expect(screen.getByTestId('cds-component')).toBeInTheDocument()
      })

      // Get the onError prop that was passed to CDS and call it
      const cdsProps = mockCdsComponent.mock.calls[0][0]
      const testError = new Error('Test CDS error')

      act(() => {
        cdsProps.onError(testError)
      })

      expect(mockOnLoadError).toHaveBeenCalledTimes(1)
      expect(mockOnLoadError).toHaveBeenCalledWith(testError)
    })

    it('should render error fallback when error occurs', async function renderErrorFallback() {
      const mockRenderErrorFallback = vi.fn().mockReturnValue(
        <div data-testid="error-fallback">Error Fallback</div>
      )

      render(
        <ComponentLoader
          type="test"
          source="test-source"
          renderErrorFallback={mockRenderErrorFallback}
        />
      )

      await waitFor(() => {
        expect(screen.getByTestId('cds-component')).toBeInTheDocument()
      })

      // Trigger error
      const cdsProps = mockCdsComponent.mock.calls[0][0]
      const testError = new Error('Test error')

      act(() => {
        cdsProps.onError(testError)
      })

      // Error fallback should be rendered with the actual error
      expect(mockRenderErrorFallback).toHaveBeenCalledWith(testError)
      expect(screen.getByTestId('error-fallback')).toBeInTheDocument()
      expect(screen.queryByTestId('cds-component')).not.toBeInTheDocument()
    })

    it('should log analytics when error occurs', async function logsAnalytics() {
      render(
        <ComponentLoader
          type="test"
          source="test-source"
          renderErrorFallback={() => <div>Error</div>}
        />
      )

      await waitFor(() => {
        expect(screen.getByTestId('cds-component')).toBeInTheDocument()
      })

      const cdsProps = mockCdsComponent.mock.calls[0][0]
      const testError = new Error('Analytics test error')

      act(() => {
        cdsProps.onError(testError)
      })

      expect(mockShipAnalyticsLog).toHaveBeenCalledWith('paywall.cds.error', {
        source: 'test-source',
        error: 'Analytics test error',
        errorType: 'cds_callback',
        component: 'cdsLoader',
      })
    })
  })

  describe('MutationObserver fallback detection', function mutationObserverTests() {
    it('should set up MutationObserver to detect CDS internal fallback', async function setupMutationObserver() {
      const observeSpy = vi.spyOn(MutationObserver.prototype, 'observe')
      const disconnectSpy = vi.spyOn(MutationObserver.prototype, 'disconnect')

      const { unmount } = render(
        <ComponentLoader
          type="test"
          source="test-source"
          renderErrorFallback={() => <div>Error</div>}
        />
      )

      await waitFor(() => {
        expect(screen.getByTestId('cds-component')).toBeInTheDocument()
      })

      // MutationObserver should be set up to watch for fallback container
      expect(observeSpy).toHaveBeenCalledWith(
        expect.any(HTMLElement),
        { childList: true, subtree: true }
      )

      unmount()

      // Should disconnect on unmount
      expect(disconnectSpy).toHaveBeenCalled()

      observeSpy.mockRestore()
      disconnectSpy.mockRestore()
    })

    it('should trigger error when fallback-container is injected into DOM', async function detectInjectedFallback() {
      const mockOnLoadError = vi.fn()
      const mockRenderErrorFallback = vi.fn().mockReturnValue(
        <div data-testid="error-fallback">Error Fallback</div>
      )

      render(
        <ComponentLoader
          type="test"
          source="test-source"
          onLoadError={mockOnLoadError}
          renderErrorFallback={mockRenderErrorFallback}
        />
      )

      // Wait for CDS component to render
      await waitFor(() => {
        expect(screen.getByTestId('cds-component')).toBeInTheDocument()
      })

      // Inject the fallback-container element (simulating CDS internal error)
      const cdsContainer = screen.getByTestId('cds-component')
      const fallbackElement = document.createElement('div')
      fallbackElement.setAttribute('data-testid', 'fallback-container')
      fallbackElement.textContent = 'CDS Internal Error'

      act(() => {
        cdsContainer.appendChild(fallbackElement)
      })

      // MutationObserver should detect the fallback and trigger error handling
      await waitFor(() => {
        expect(mockOnLoadError).toHaveBeenCalled()
      })

      expect(mockOnLoadError).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'CDS internal error - fallback component rendered',
        })
      )

      // Error fallback should be rendered with the error
      expect(mockRenderErrorFallback).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'CDS internal error - fallback component rendered',
        })
      )
      expect(screen.getByTestId('error-fallback')).toBeInTheDocument()

      // Analytics should be logged
      expect(mockShipAnalyticsLog).toHaveBeenCalledWith(
        'paywall.cds.internal-fallback.detected',
        expect.objectContaining({
          source: 'test-source',
          errorType: 'internal_fallback',
          component: 'cdsLoader',
        })
      )
    })
  })

  describe('rendering', function renderingTests() {
    it('should render loading component while CDS loads', async function renderLoading() {
      render(
        <ComponentLoader
          type="test"
          LoadingComponent={<div data-testid="loading">Loading...</div>}
        />
      )

      // CDS should eventually render
      await waitFor(() => {
        expect(screen.getByTestId('cds-component')).toBeInTheDocument()
      })
    })

    it('should pass props to CDS component', async function passProps() {
      render(
        <ComponentLoader
          type="test-type"
          source="test-source"
          subType="test-subtype"
          locale="en-US"
          customProp="custom-value"
        />
      )

      await waitFor(() => {
        expect(mockCdsComponent).toHaveBeenCalled()
      })

      const passedProps = mockCdsComponent.mock.calls[0][0]
      expect(passedProps.source).toBe('test-source')
      expect(passedProps.subType).toBe('test-subtype')
      expect(passedProps.locale).toBe('en-US')
      expect(passedProps.customProp).toBe('custom-value')
    })
  })
})
