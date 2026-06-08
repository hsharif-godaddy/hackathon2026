/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, waitFor } from '@testing-library/react'

const mockShipAnalyticsLog = vi.fn()
const mockLoggerWarn = vi.fn()

vi.mock('@/lib/logging', () => ({
  shipAnalyticsLog: (...args: unknown[]) => mockShipAnalyticsLog(...args),
}))
vi.mock('@/lib/request-context', () => ({
  logger: {
    warn: (...args: unknown[]) => mockLoggerWarn(...args),
    info: vi.fn(),
    error: vi.fn(),
  },
}))

const mockGasketData = vi.fn()
vi.mock('@/hooks/useGasketData', () => ({
  useGasketData: () => mockGasketData(),
}))


let lastCdsProps: Record<string, unknown> | null = null
vi.mock('@venture/cds-loader', () => ({
  default: (props: Record<string, unknown>) => {
    lastCdsProps = props
    return <div data-testid="cds-inner">cds</div>
  },
}))

// Because vitest cannot intercept native `import(/* webpackIgnore */ url)`, we test the
// helper surface (`getUppEntryUrl`) plus the component lifecycle. callWarmCache failures
// are exercised via the mocked `@venture/cds-loader` combined with onError.

import { CdsEsmPreload, getUppEntryUrl } from './CdsEsmPreload'

const registry = {
  godaddyUnifiedPlansAndPricingLibraryEsm: {
    js: 'abc123.godaddyUnifiedPlansAndPricingLibraryEsm.es.js',
    cdnBaseUrl: 'https://cdn.example.com/cds',
  },
}

describe('getUppEntryUrl', () => {
  beforeEach(() => {
    localStorage.clear()
    window.history.replaceState({}, '', '/')
  })

  it('returns canonical CDN URL when no override is set', () => {
    expect(getUppEntryUrl(registry)).toBe(
      'https://cdn.example.com/cds/esm/godaddyUnifiedPlansAndPricingLibraryEsm/abc123.godaddyUnifiedPlansAndPricingLibraryEsm.es.js',
    )
  })

  it('returns localhost URL when localStorage sets override to "local"', () => {
    localStorage.setItem(
      'cdsVersion',
      JSON.stringify({ godaddyUnifiedPlansAndPricingLibraryEsm: 'local' }),
    )
    expect(getUppEntryUrl(registry)).toBe(
      'http://localhost:9000/esm/godaddyUnifiedPlansAndPricingLibraryEsm/local.godaddyUnifiedPlansAndPricingLibraryEsm.es.js',
    )
  })

  it('returns version-pinned CDN URL when localStorage sets a hash override', () => {
    localStorage.setItem(
      'cdsVersion',
      JSON.stringify({ godaddyUnifiedPlansAndPricingLibraryEsm: 'deadbeef' }),
    )
    expect(getUppEntryUrl(registry)).toBe(
      'https://cdn.example.com/cds/esm/godaddyUnifiedPlansAndPricingLibraryEsm/deadbeef.godaddyUnifiedPlansAndPricingLibraryEsm.es.js',
    )
  })

  it('applies query-string override when localStorage is absent', () => {
    window.history.replaceState({}, '', '/?cdsVersion=godaddyUnifiedPlansAndPricingLibraryEsm--local')
    expect(getUppEntryUrl(registry)).toBe(
      'http://localhost:9000/esm/godaddyUnifiedPlansAndPricingLibraryEsm/local.godaddyUnifiedPlansAndPricingLibraryEsm.es.js',
    )
  })

  it('ignores query-string override for a different component type', () => {
    window.history.replaceState({}, '', '/?cdsVersion=someOther--local')
    expect(getUppEntryUrl(registry)).toBe(
      'https://cdn.example.com/cds/esm/godaddyUnifiedPlansAndPricingLibraryEsm/abc123.godaddyUnifiedPlansAndPricingLibraryEsm.es.js',
    )
  })

  it('returns null when registry config is missing js or cdnBaseUrl', () => {
    expect(getUppEntryUrl({})).toBeNull()
    expect(getUppEntryUrl({ godaddyUnifiedPlansAndPricingLibraryEsm: { js: 'x.js' } })).toBeNull()
  })

  it('survives malformed JSON in localStorage override', () => {
    localStorage.setItem('cdsVersion', '{not json')
    expect(getUppEntryUrl(registry)).toBe(
      'https://cdn.example.com/cds/esm/godaddyUnifiedPlansAndPricingLibraryEsm/abc123.godaddyUnifiedPlansAndPricingLibraryEsm.es.js',
    )
  })
})

describe('CdsEsmPreload', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    lastCdsProps = null
    delete (window as { __CDS_IMPORT_MAP_SETUP__?: boolean }).__CDS_IMPORT_MAP_SETUP__
    mockGasketData.mockReturnValue({
      cds: { registry },
      intl: { locale: 'en-US' },
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns null when gasketData.cds is absent', () => {
    mockGasketData.mockReturnValue({})
    const { container } = render(<CdsEsmPreload />)
    expect(container.firstChild).toBeNull()
  })

  it('mounts the hidden CdsComponentLoader when registry is present', async () => {
    const { getByTestId } = render(<CdsEsmPreload />)
    await waitFor(() => expect(getByTestId('cds-inner')).toBeInTheDocument())
    expect(lastCdsProps).toMatchObject({
      type: 'godaddyUnifiedPlansAndPricingLibraryEsm',
      loaderMode: 'esm',
      subType: 'UpgradeLoadingSkeleton',
      source: 'preload',
      locale: 'en-US',
    })
  })

  it('logs + ships analytics and unmounts when 10s timeout fires', async () => {
    vi.useFakeTimers()
    const { container } = render(<CdsEsmPreload />)

    await act(async () => {
      vi.advanceTimersByTime(10001)
    })

    expect(mockLoggerWarn).toHaveBeenCalledWith('paywall.cds.preload.importMap.timeout', {})
    expect(mockShipAnalyticsLog).toHaveBeenCalledWith('paywall.cds.preload.importMap.timeout', {
      component: 'CdsEsmPreload',
    })
    expect(container.firstChild).toBeNull()
  })

  it('logs + ships analytics when inner CdsComponentLoader fires onError', async () => {
    const { getByTestId, container } = render(<CdsEsmPreload />)
    await waitFor(() => expect(getByTestId('cds-inner')).toBeInTheDocument())

    const err = new Error('load fail')
    act(() => {
      ;(lastCdsProps?.onError as (e: Error) => void)(err)
    })

    expect(mockLoggerWarn).toHaveBeenCalledWith('paywall.cds.preload.load.failed', { error: 'load fail' })
    expect(mockShipAnalyticsLog).toHaveBeenCalledWith('paywall.cds.preload.load.failed', {
      source: 'preload',
      error: 'load fail',
      component: 'CdsEsmPreload',
    })
    await waitFor(() => expect(container.firstChild).toBeNull())
  })

  it('logs registry.missing when UPP config is absent', () => {
    mockGasketData.mockReturnValue({
      cds: { registry: {} },
      intl: { locale: 'en-US' },
    })

    render(<CdsEsmPreload />)

    expect(mockLoggerWarn).toHaveBeenCalledWith('paywall.cds.preload.registry.missing', {})
    expect(mockShipAnalyticsLog).toHaveBeenCalledWith('paywall.cds.preload.registry.missing', {
      component: 'CdsEsmPreload',
    })
  })

  it('clears interval when import map is ready before timeout', async () => {
    vi.useFakeTimers()
    window.__CDS_IMPORT_MAP_SETUP__ = true
    window.__CDS_IMPORT_MAP_PROMISE__ = Promise.resolve()

    render(<CdsEsmPreload />)

    await act(async () => {
      vi.advanceTimersByTime(200)
    })

    // After detecting import map, further timers should not fire the timeout log
    await act(async () => {
      vi.advanceTimersByTime(15000)
    })

    // Timeout log should NOT fire since interval was cleared first
    expect(mockLoggerWarn).not.toHaveBeenCalledWith('paywall.cds.preload.importMap.timeout', {})
  })
})
