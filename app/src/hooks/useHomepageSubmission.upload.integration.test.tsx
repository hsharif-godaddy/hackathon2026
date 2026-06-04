/**
 * @vitest-environment jsdom
 *
 * Integration coverage for the homepage upload -> prompt-prefill -> CTA-enabled
 * flow. The hook unit test (useHomepageSubmission.test.ts) drives
 * handleFilesChange directly; this test exercises the real DOM wiring instead:
 * a file selection on DesignFileUpload's <input> runs through processDesignFiles
 * -> onFilesChange (the hook's setUploadedFiles alias) -> promptText prefill ->
 * the submit CTA flipping from disabled to enabled, plus the remove path.
 */
import '@testing-library/jest-dom'

import { useRef } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { waitFor } from '@testing-library/react'

import DesignFileUpload from '@/app/[market]/components/DesignFileUpload'
import type { UploadedDesignFile } from '@/app/[market]/components/types'
import { renderWithProviders } from '@/tests/test-utils'
import { useHomepageSubmission } from './useHomepageSubmission'

const mockProcessDesignFiles = vi.hoisted(() => vi.fn())
const mockFetchQuickCreate = vi.hoisted(() => vi.fn())
const mockRouterPush = vi.hoisted(() => vi.fn())

// DesignFileUpload statically imports MAX_FILES/MAX_TOTAL_BYTES and dynamically
// imports processDesignFiles from this module; one mock covers both.
vi.mock('@/app/[market]/components/design-file-processing', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>
  return { ...actual, processDesignFiles: mockProcessDesignFiles }
})

// Shared deps for both the hook and DesignFileUpload.
vi.mock('@/utils/instrumentation', () => ({
  logImpressionEvent: vi.fn(function () { return vi.fn(); }),
  logClickEvent: vi.fn(function () { return vi.fn(); }),
  logAiroHQEvent: vi.fn(function () { return vi.fn(); }),
  generateClickEID: vi.fn(function () { return 'appbuilder.homepage.prompt.attach.click'; }),
}))
vi.mock('@/hooks/useBreakpoints', () => ({
  useBreakpoints: () => ({
    isBelowSmBreakpoint: false,
    isSmBreakpoint: true,
    isMdBreakpoint: true,
    isLgBreakpoint: true,
    isXlBreakpoint: true,
  }),
}))
// Flag-aware: enables DesignFileUpload's input while leaving the hook's
// appbuilder-template-selector lookup falsy (matches the unit-test default).
vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: (flag: string) => flag === 'appbuilder-design-upload',
}))
vi.mock('@/hooks/useTranslations', () => ({ useTranslations: () => (key: string) => key }))

// Remaining hook deps (mirrors useHomepageSubmission.test.ts).
vi.mock('@/lib/logging', () => ({ shipAnalyticsLog: vi.fn() }))
vi.mock('@/lib/request-context', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))
vi.mock('@/lib/errors', () => ({ getErrorMessage: (e: unknown) => String(e) }))
vi.mock('@/lib/domain-validation', () => ({ validateDomainName: () => ({ valid: true }) }))
vi.mock('@/lib/waf-validation', () => ({
  validateAndClampPrompt: (text: string) => ({ text, wasClipped: false, charLength: text.length, byteLength: text.length }),
}))
vi.mock('@/lib/quick-create', () => ({
  fetchQuickCreate: (...args: unknown[]) => mockFetchQuickCreate(...args),
  buildDevelopUrl: () => '/develop/app-1',
  setQuickCreateSessionFlags: vi.fn(),
  storeUploadedFiles: vi.fn(),
  extractApiError: (e: unknown) => e,
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockRouterPush, replace: vi.fn() }),
  usePathname: () => '/',
  useSearchParams: () => ({ get: () => null, toString: () => '' }),
}))
vi.mock('@/app/[market]/components/types', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>
  return { ...actual, validateTemplate: () => null, LOGO_DESIGNER_TEMPLATE: 'logo-designer' }
})
vi.mock('@/components/providers/AuthProvider', () => ({
  useAuthContext: () => ({ isAuthenticated: true, isLoading: false }),
}))
vi.mock('@/hooks/useSubscription', () => ({
  useSubscription: () => ({ subscriptions: [], isLoading: false, isError: false }),
}))
vi.mock('@/hooks/useAnalytics', () => ({
  useAnalytics: () => ({ cohort: undefined, logAnalytics: vi.fn() }),
}))
vi.mock('@/hooks/useSsoSignIn', () => ({ useSsoSignIn: () => ({ signIn: vi.fn() }) }))
vi.mock('@/hooks/useSafariClass', () => ({ useSafariClass: () => undefined }))
vi.mock('@/hooks/useAuthGateTracking', () => ({ useAuthGateTracking: () => undefined }))
vi.mock('@/hooks/useHomepageBounceTracking', () => ({
  useHomepageBounceTracking: () => ({ markEngaged: vi.fn() }),
}))

// useTranslations is mocked to echo the key, so the prefill text the hook
// applies is the raw key string.
const PREFILL = 'builder_design_file_upload_prompt_prefill'

/**
 * Minimal stand-in for HeroSection: binds the hook's promptText to a textarea,
 * wires DesignFileUpload to the hook's setUploadedFiles (the handleFilesChange
 * alias), and gates the CTA on a non-empty prompt — the same condition the real
 * SubmitInitialPrompt uses (`!displayText.trim()`).
 */
function UploadHarness() {
  const hp = useHomepageSubmission()
  const filesRef = useRef<UploadedDesignFile[]>([])
  filesRef.current = hp.uploadedFiles

  return (
    <div>
      <textarea
        data-testid="prompt"
        value={hp.promptText}
        onChange={(e) => hp.setPromptText(e.target.value)}
      />
      <DesignFileUpload
        currentFilesRef={filesRef}
        onFilesChange={hp.setUploadedFiles}
        onError={() => {}}
      />
      {hp.uploadedFiles.map((file, idx) => (
        <button
          key={file.name}
          data-testid={`remove-${idx}`}
          onClick={() => hp.setUploadedFiles(hp.uploadedFiles.filter((_, i) => i !== idx))}
        >
          remove {file.name}
        </button>
      ))}
      <button data-testid="cta" disabled={!hp.promptText.trim()}>
        Start Building
      </button>
    </div>
  )
}

describe('homepage upload -> prefill -> CTA (integration)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockProcessDesignFiles.mockResolvedValue({ processed: [], errors: [] })
  })

  it('starts with an empty prompt and a disabled CTA', () => {
    const { getByTestId } = renderWithProviders(<UploadHarness />)

    expect(getByTestId('prompt')).toHaveValue('')
    expect(getByTestId('cta')).toBeDisabled()
  })

  it('prefills the prompt and enables the CTA after a file is uploaded', async () => {
    const processed: UploadedDesignFile = { name: 'design.png', content: '', isImage: true, isDesignMd: false }
    mockProcessDesignFiles.mockResolvedValueOnce({ processed: [processed], errors: [] })

    const { container, getByTestId, user } = renderWithProviders(<UploadHarness />)
    const input = container.querySelector('input[type="file"]') as HTMLInputElement

    await user.upload(input, new File(['x'], 'design.png', { type: 'image/png' }))

    await waitFor(() => expect(getByTestId('prompt')).toHaveValue(PREFILL))
    expect(getByTestId('cta')).toBeEnabled()
  })

  it('clears the prefill and disables the CTA when the uploaded file is removed', async () => {
    const processed: UploadedDesignFile = { name: 'design.png', content: '', isImage: true, isDesignMd: false }
    mockProcessDesignFiles.mockResolvedValueOnce({ processed: [processed], errors: [] })

    const { container, getByTestId, user } = renderWithProviders(<UploadHarness />)
    const input = container.querySelector('input[type="file"]') as HTMLInputElement

    await user.upload(input, new File(['x'], 'design.png', { type: 'image/png' }))
    await waitFor(() => expect(getByTestId('prompt')).toHaveValue(PREFILL))

    await user.click(getByTestId('remove-0'))

    await waitFor(() => expect(getByTestId('prompt')).toHaveValue(''))
    expect(getByTestId('cta')).toBeDisabled()
  })

  it('keeps custom prompt text instead of overwriting it with the prefill', async () => {
    const processed: UploadedDesignFile = { name: 'design.png', content: '', isImage: true, isDesignMd: false }
    mockProcessDesignFiles.mockResolvedValueOnce({ processed: [processed], errors: [] })

    const { container, getByTestId, user } = renderWithProviders(<UploadHarness />)
    const input = container.querySelector('input[type="file"]') as HTMLInputElement

    await user.type(getByTestId('prompt'), 'my custom prompt')
    await user.upload(input, new File(['x'], 'design.png', { type: 'image/png' }))

    // Give the async upload handler a chance to (not) overwrite the prompt.
    await waitFor(() => expect(getByTestId('remove-0')).toBeInTheDocument())
    expect(getByTestId('prompt')).toHaveValue('my custom prompt')
    expect(getByTestId('cta')).toBeEnabled()
  })
})
