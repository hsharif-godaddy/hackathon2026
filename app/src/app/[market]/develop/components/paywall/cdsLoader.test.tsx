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
    warn: vi.fn(),
  },
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
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('should set up MutationObserver immediately', async function setupMutationObserver() {
      const observeSpy = vi.spyOn(MutationObserver.prototype, 'observe')
      const disconnectSpy = vi.spyOn(MutationObserver.prototype, 'disconnect')

      const { unmount } = render(
        <ComponentLoader
          type="test"
          source="test-source"
          renderErrorFallback={() => <div>Error</div>}
        />
      )

      await act(async () => { await vi.runAllTimersAsync() })

      expect(screen.getByTestId('cds-component')).toBeInTheDocument()

      const hasContainerObserve = observeSpy.mock.calls.some(
        ([target, options]) =>
          target instanceof HTMLDivElement &&
          options?.childList === true &&
          options?.subtree === true
      )
      expect(hasContainerObserve).toBe(true)

      unmount()
      expect(disconnectSpy).toHaveBeenCalled()

      observeSpy.mockRestore()
      disconnectSpy.mockRestore()
    })

    it('should not trigger error when fallback-container is removed before debounce elapses', async function fallbackRemovedBeforeDebounce() {
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

      await act(async () => { await vi.runAllTimersAsync() })

      const cdsContainer = screen.getByTestId('cds-component')
      const fallbackElement = document.createElement('div')
      fallbackElement.setAttribute('data-testid', 'fallback-container')

      await act(async () => {
        cdsContainer.appendChild(fallbackElement)
        vi.advanceTimersByTime(2000)
      })

      await act(async () => {
        fallbackElement.remove()
        vi.advanceTimersByTime(5000)
      })

      expect(mockOnLoadError).not.toHaveBeenCalled()
      expect(mockRenderErrorFallback).not.toHaveBeenCalled()
    })

    it('should trigger error when fallback-container persists past debounce', async function detectInjectedFallback() {
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

      await act(async () => { await vi.runAllTimersAsync() })

      expect(screen.getByTestId('cds-component')).toBeInTheDocument()

      const cdsContainer = screen.getByTestId('cds-component')
      const fallbackElement = document.createElement('div')
      fallbackElement.setAttribute('data-testid', 'fallback-container')
      fallbackElement.textContent = 'CDS Internal Error'

      await act(async () => {
        cdsContainer.appendChild(fallbackElement)
        await vi.runAllTimersAsync()
      })

      expect(mockOnLoadError).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'CDS internal error - fallback component rendered',
        })
      )

      expect(mockRenderErrorFallback).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'CDS internal error - fallback component rendered',
        })
      )
      expect(screen.getByTestId('error-fallback')).toBeInTheDocument()

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

  describe('error fallback edge cases', function errorEdgeCases() {
    it('should render null on error when no renderErrorFallback provided', async function renderNullOnError() {
      const { container } = render(
        <ComponentLoader
          type="test"
          source="test-source"
        />
      )

      await waitFor(() => {
        expect(screen.getByTestId('cds-component')).toBeInTheDocument()
      })

      const cdsProps = mockCdsComponent.mock.calls[0][0]
      act(() => {
        cdsProps.onError(new Error('No fallback'))
      })

      expect(screen.queryByTestId('cds-component')).not.toBeInTheDocument()
      expect(container.innerHTML).toBe('')
    })
  })

  describe('rendering', function renderingTests() {
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

    it('should pass LoadingComponent through to CDS loader', async function passLoadingComponent() {
      render(
        <ComponentLoader
          type="test"
          LoadingComponent={<div data-testid="loading">Loading...</div>}
        />
      )

      await waitFor(() => {
        expect(mockCdsComponent).toHaveBeenCalled()
      })

      const passedProps = mockCdsComponent.mock.calls[0][0]
      expect(passedProps.LoadingComponent).toBeDefined()
    })
  })
})
