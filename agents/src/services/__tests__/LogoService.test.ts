import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../logging/index.js', () => ({
  Logger: { create: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })) },
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock('@airo/ai-lib', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    getS2SToken: vi.fn().mockResolvedValue('s2s-token'),
  }
})

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

const SQUARE_BASE = 'https://cdn.example/logo-square'
const HORIZONTAL_BASE = 'https://cdn.example/logo-horizontal'

const SQUARE_API_LOGO = {
  id: 'logo-1',
  transparentUrl: `${SQUARE_BASE}-transparent.png`,
  solidUrl: `${SQUARE_BASE}-solid.png`,
  mockupUrl: `${SQUARE_BASE}-mockup.png`,
  landscapeMockupUrl: `${SQUARE_BASE}-landscape.png`,
}

const HORIZONTAL_VARIANTS = {
  horizontalTransparentUrl: `${HORIZONTAL_BASE}-transparent.png`,
  horizontalSolidUrl: `${HORIZONTAL_BASE}-solid.png`,
  horizontalMockupUrl: `${HORIZONTAL_BASE}-mockup.png`,
}

function apiResponse(body: unknown, init: { status?: number; statusText?: string } = {}): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status: init.status ?? 200,
    statusText: init.statusText ?? '',
    headers: { 'content-type': 'application/json' },
  })
}

const PREV_LOGO_API_URL = process.env.LOGO_API_URL

describe('LogoService', () => {
  let logoService: typeof import('../LogoService.js').logoService
  let BudgetExceededError: typeof import('@airo/ai-common').BudgetExceededError

  beforeEach(async () => {
    vi.clearAllMocks()
    fetchMock.mockReset()
    process.env.LOGO_API_URL = 'https://logo-agent.test/'
    ;({ logoService } = await import('../LogoService.js'))
    ;({ BudgetExceededError } = await import('@airo/ai-common'))
  })

  afterEach(() => {
    if (PREV_LOGO_API_URL === undefined) delete process.env.LOGO_API_URL
    else process.env.LOGO_API_URL = PREV_LOGO_API_URL
  })

  it('POSTs the prompt + layouts to /api/logo/create with the v1 header set', async () => {
    fetchMock.mockResolvedValueOnce(
      apiResponse({
        id: 'sess-abc',
        sessionId: 'sess-abc',
        logos: [{ ...SQUARE_API_LOGO, ...HORIZONTAL_VARIANTS }],
      }),
    )

    const result = await logoService.generate({
      prompt: 'a coffee cup logo',
      layout: ['square', 'horizontal'],
      appId: 'app-1',
      customerId: 'cust-1',
      budgetUserId: 'bu-1',
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toBe('https://logo-agent.test/api/logo/create')
    expect(opts.method).toBe('POST')
    expect(JSON.parse(opts.body)).toEqual({
      prompt: 'a coffee cup logo',
      layout: ['square', 'horizontal'],
    })
    expect(opts.headers).toMatchObject({
      Authorization: 'Bearer s2s-token',
      'x-app-key': 'airo-app-builder',
      'x-app-builder-app-id': 'app-1',
      'x-customer-id': 'cust-1',
      'x-budget-user-id': 'bu-1',
    })

    expect(result.sessionId).toBe('sess-abc')
    expect(result.logo.id).toBe('logo-1')
    expect(result.logo.modelUsed).toBe('logo-agent')
    expect(result.logo.prompt).toBe('a coffee cup logo')
    expect(Object.keys(result.logo.urls).sort()).toEqual(['horizontal', 'square'])
  })

  it('maps the upstream flat-keyed ProcessedLogo into per-layout LayoutUrls bundles', async () => {
    fetchMock.mockResolvedValueOnce(
      apiResponse({
        id: 's',
        sessionId: 's',
        logos: [{ ...SQUARE_API_LOGO, ...HORIZONTAL_VARIANTS }],
      }),
    )

    const result = await logoService.generate({
      prompt: 'logo',
      layout: ['square', 'horizontal'],
      appId: 'a',
      customerId: 'c',
      budgetUserId: 'b',
    })

    expect(result.logo.urls.square).toEqual({
      transparent: SQUARE_API_LOGO.transparentUrl,
      solid: SQUARE_API_LOGO.solidUrl,
      mockup: SQUARE_API_LOGO.mockupUrl,
      landscapeMockup: SQUARE_API_LOGO.landscapeMockupUrl,
    })
    expect(result.logo.urls.horizontal).toEqual({
      transparent: HORIZONTAL_VARIANTS.horizontalTransparentUrl,
      solid: HORIZONTAL_VARIANTS.horizontalSolidUrl,
      mockup: HORIZONTAL_VARIANTS.horizontalMockupUrl,
      landscapeMockup: HORIZONTAL_VARIANTS.horizontalMockupUrl,
    })
  })

  it('routes the single landscapeMockupUrl to a horizontal-only logo', async () => {
    fetchMock.mockResolvedValueOnce(
      apiResponse({
        id: 's',
        sessionId: 's',
        logos: [{ id: 'logo-1', ...HORIZONTAL_VARIANTS, landscapeMockupUrl: `${HORIZONTAL_BASE}-landscape.png` }],
      }),
    )

    const result = await logoService.generate({
      prompt: 'logo',
      layout: ['horizontal'],
      appId: 'a',
      customerId: 'c',
      budgetUserId: 'b',
    })

    expect(result.logo.urls.horizontal!.landscapeMockup).toBe(`${HORIZONTAL_BASE}-landscape.png`)
  })

  it('does not give horizontal the landscapeMockupUrl when square is also present', async () => {
    fetchMock.mockResolvedValueOnce(
      apiResponse({
        id: 's',
        sessionId: 's',
        logos: [{ ...SQUARE_API_LOGO, ...HORIZONTAL_VARIANTS }],
      }),
    )

    const result = await logoService.generate({
      prompt: 'logo',
      layout: ['square', 'horizontal'],
      appId: 'a',
      customerId: 'c',
      budgetUserId: 'b',
    })

    expect(result.logo.urls.square!.landscapeMockup).toBe(SQUARE_API_LOGO.landscapeMockupUrl)
    expect(result.logo.urls.horizontal!.landscapeMockup).toBe(HORIZONTAL_VARIANTS.horizontalMockupUrl)
  })

  it('prefers per-layout landscape fields when the API exposes them', async () => {
    fetchMock.mockResolvedValueOnce(
      apiResponse({
        id: 's',
        sessionId: 's',
        logos: [
          {
            ...SQUARE_API_LOGO,
            ...HORIZONTAL_VARIANTS,
            horizontalLandscapeMockupUrl: `${HORIZONTAL_BASE}-landscape.png`,
          },
        ],
      }),
    )

    const result = await logoService.generate({
      prompt: 'logo',
      layout: ['square', 'horizontal'],
      appId: 'a',
      customerId: 'c',
      budgetUserId: 'b',
    })

    // square keeps its own landscape; horizontal now gets its own, not the plain mockup
    expect(result.logo.urls.square!.landscapeMockup).toBe(SQUARE_API_LOGO.landscapeMockupUrl)
    expect(result.logo.urls.horizontal!.landscapeMockup).toBe(`${HORIZONTAL_BASE}-landscape.png`)
  })

  it('routes the single landscapeMockupUrl to a vertical-only logo', async () => {
    fetchMock.mockResolvedValueOnce(
      apiResponse({
        id: 's',
        sessionId: 's',
        logos: [
          {
            id: 'logo-1',
            verticalTransparentUrl: 'https://cdn.example/logo-vertical-transparent.png',
            verticalMockupUrl: 'https://cdn.example/logo-vertical-mockup.png',
            landscapeMockupUrl: 'https://cdn.example/logo-vertical-landscape.png',
          },
        ],
      }),
    )

    const result = await logoService.generate({
      prompt: 'logo',
      layout: ['vertical'],
      appId: 'a',
      customerId: 'c',
      budgetUserId: 'b',
    })

    expect(result.logo.urls.vertical!.landscapeMockup).toBe('https://cdn.example/logo-vertical-landscape.png')
  })

  it('does not give vertical the single landscapeMockupUrl when horizontal is present (no square)', async () => {
    fetchMock.mockResolvedValueOnce(
      apiResponse({
        id: 's',
        sessionId: 's',
        logos: [
          {
            id: 'logo-1',
            ...HORIZONTAL_VARIANTS,
            verticalTransparentUrl: 'https://cdn.example/logo-vertical-transparent.png',
            verticalMockupUrl: 'https://cdn.example/logo-vertical-mockup.png',
            // upstream priority winner is horizontal (no square), so the single field is horizontal's
            landscapeMockupUrl: `${HORIZONTAL_BASE}-landscape.png`,
          },
        ],
      }),
    )

    const result = await logoService.generate({
      prompt: 'logo',
      layout: ['horizontal', 'vertical'],
      appId: 'a',
      customerId: 'c',
      budgetUserId: 'b',
    })

    expect(result.logo.urls.horizontal!.landscapeMockup).toBe(`${HORIZONTAL_BASE}-landscape.png`)
    expect(result.logo.urls.vertical!.landscapeMockup).toBe('https://cdn.example/logo-vertical-mockup.png')
  })

  it('prefers verticalLandscapeMockupUrl over the single field', async () => {
    fetchMock.mockResolvedValueOnce(
      apiResponse({
        id: 's',
        sessionId: 's',
        logos: [
          {
            id: 'logo-1',
            verticalTransparentUrl: 'https://cdn.example/logo-vertical-transparent.png',
            verticalMockupUrl: 'https://cdn.example/logo-vertical-mockup.png',
            verticalLandscapeMockupUrl: 'https://cdn.example/logo-vertical-perlayout.png',
            landscapeMockupUrl: 'https://cdn.example/logo-single-landscape.png',
          },
        ],
      }),
    )

    const result = await logoService.generate({
      prompt: 'logo',
      layout: ['vertical'],
      appId: 'a',
      customerId: 'c',
      budgetUserId: 'b',
    })

    expect(result.logo.urls.vertical!.landscapeMockup).toBe('https://cdn.example/logo-vertical-perlayout.png')
  })

  it('falls back to transparent for missing variants on a layout', async () => {
    fetchMock.mockResolvedValueOnce(
      apiResponse({
        id: 's',
        sessionId: 's',
        logos: [{ id: 'logo-1', transparentUrl: SQUARE_API_LOGO.transparentUrl }],
      }),
    )

    const result = await logoService.generate({
      prompt: 'logo',
      layout: ['square'],
      appId: 'a',
      customerId: 'c',
      budgetUserId: 'b',
    })

    const sq = result.logo.urls.square!
    expect(sq.transparent).toBe(SQUARE_API_LOGO.transparentUrl)
    expect(sq.solid).toBe(SQUARE_API_LOGO.transparentUrl)
    expect(sq.mockup).toBe(SQUARE_API_LOGO.transparentUrl)
    expect(sq.landscapeMockup).toBe(SQUARE_API_LOGO.transparentUrl)
  })

  it('omits a layout entirely when its transparent variant is missing', async () => {
    fetchMock.mockResolvedValueOnce(
      apiResponse({
        id: 's',
        sessionId: 's',
        logos: [{ ...SQUARE_API_LOGO }], // no horizontal* fields
      }),
    )

    const result = await logoService.generate({
      prompt: 'logo',
      layout: ['square', 'horizontal'],
      appId: 'a',
      customerId: 'c',
      budgetUserId: 'b',
    })

    expect(result.logo.urls.square).toBeDefined()
    expect(result.logo.urls.horizontal).toBeUndefined()
  })

  it('passes references through verbatim when editing', async () => {
    fetchMock.mockResolvedValueOnce(
      apiResponse({
        id: 's',
        sessionId: 's',
        logos: [{ ...SQUARE_API_LOGO }],
      }),
    )

    await logoService.generate({
      prompt: 'make it blue',
      layout: ['square'],
      references: { logo: 'https://app-1.agent.c4.test-airoapp.ai/files/uploads/foo.png?sig=x' },
      appId: 'a',
      customerId: 'c',
      budgetUserId: 'b',
    })

    const [, opts] = fetchMock.mock.calls[0]
    expect(JSON.parse(opts.body)).toEqual({
      prompt: 'make it blue',
      layout: ['square'],
      references: { logo: 'https://app-1.agent.c4.test-airoapp.ai/files/uploads/foo.png?sig=x' },
    })
  })

  it('includes references in the body when provided', async () => {
    fetchMock.mockResolvedValueOnce(apiResponse({ id: 's', sessionId: 's', logos: [{ ...SQUARE_API_LOGO }] }))

    await logoService.generate({
      prompt: 'a vintage badge',
      layout: ['square'],
      references: { logo: '/airo-assets/uploads/existing.png', inspiration: ['https://example.com/ref.png'] },
      appId: 'a',
      customerId: 'c',
      budgetUserId: 'b',
    })

    const [, opts] = fetchMock.mock.calls[0]
    expect(JSON.parse(opts.body)).toMatchObject({
      references: { logo: '/airo-assets/uploads/existing.png', inspiration: ['https://example.com/ref.png'] },
    })
  })

  it('omits references from the body when not provided', async () => {
    fetchMock.mockResolvedValueOnce(apiResponse({ id: 's', sessionId: 's', logos: [{ ...SQUARE_API_LOGO }] }))

    await logoService.generate({
      prompt: 'a fresh logo',
      layout: ['square'],
      appId: 'a',
      customerId: 'c',
      budgetUserId: 'b',
    })

    const [, opts] = fetchMock.mock.calls[0]
    expect(JSON.parse(opts.body)).not.toHaveProperty('references')
  })

  it('includes structured colors in the body when provided', async () => {
    fetchMock.mockResolvedValueOnce(
      apiResponse({ id: 's', sessionId: 's', logos: [{ ...SQUARE_API_LOGO }] }),
    )

    await logoService.generate({
      prompt: 'a coffee cup logo',
      layout: ['square'],
      colors: {
        background: '#FAF8F5',
        primary: '#B96B3C',
        secondary: '#2A4D3E',
        accent: '#F2C94C',
      },
      appId: 'a',
      customerId: 'c',
      budgetUserId: 'b',
    })

    const [, opts] = fetchMock.mock.calls[0]
    expect(JSON.parse(opts.body)).toEqual({
      prompt: 'a coffee cup logo',
      layout: ['square'],
      colors: {
        background: '#FAF8F5',
        primary: '#B96B3C',
        secondary: '#2A4D3E',
        accent: '#F2C94C',
      },
    })
  })

  it('omits the colors key when colors is absent or empty', async () => {
    fetchMock.mockResolvedValue(
      apiResponse({ id: 's', sessionId: 's', logos: [{ ...SQUARE_API_LOGO }] }),
    )

    await logoService.generate({
      prompt: 'logo',
      layout: ['square'],
      colors: {},
      appId: 'a',
      customerId: 'c',
      budgetUserId: 'b',
    })

    const [, opts] = fetchMock.mock.calls[0]
    expect(JSON.parse(opts.body)).not.toHaveProperty('colors')
  })

  it('maps a 402 response to BudgetExceededError', async () => {
    fetchMock.mockResolvedValueOnce(apiResponse('budget gone', { status: 402 }))

    await expect(
      logoService.generate({
        prompt: 'logo',
        layout: ['square'],
        appId: 'a',
        customerId: 'c',
        budgetUserId: 'b',
      }),
    ).rejects.toBeInstanceOf(BudgetExceededError)
  })

  it('throws on non-2xx, non-402 responses without leaking the upstream body', async () => {
    fetchMock.mockResolvedValueOnce(apiResponse('boom-secret-detail', { status: 500, statusText: 'Internal' }))

    await expect(
      logoService.generate({
        prompt: 'logo',
        layout: ['square'],
        appId: 'a',
        customerId: 'c',
        budgetUserId: 'b',
      }),
    ).rejects.toThrow(/Logo generation failed \(status 500\)/)
  })

  it('keeps the raw upstream error body out of the thrown message', async () => {
    fetchMock.mockResolvedValueOnce(apiResponse('boom-secret-detail', { status: 500, statusText: 'Internal' }))

    const error = await logoService
      .generate({
        prompt: 'logo',
        layout: ['square'],
        appId: 'a',
        customerId: 'c',
        budgetUserId: 'b',
      })
      .then(
        () => {
          throw new Error('expected generate() to reject')
        },
        (e: unknown) => e as Error,
      )

    expect(error.message).not.toContain('boom-secret-detail')
  })

  it('drops layouts the API did not return and warns', async () => {
    fetchMock.mockResolvedValueOnce(
      apiResponse({
        id: 'sess-x',
        sessionId: 'sess-x',
        logos: [{ ...SQUARE_API_LOGO }], // square variants only — no horizontal* fields
      }),
    )

    const { logger } = await import('../../logging/index.js')

    const result = await logoService.generate({
      prompt: 'logo',
      layout: ['square', 'horizontal'],
      appId: 'app-1',
      customerId: 'c',
      budgetUserId: 'b',
    })

    // Only the produced layout is present — the requested-but-undelivered
    // horizontal layout is dropped rather than fabricated.
    expect(Object.keys(result.logo.urls)).toEqual(['square'])
    expect(result.logo.urls.horizontal).toBeUndefined()
    expect(logger.warn).toHaveBeenCalledWith(
      'logo.generate.layouts_dropped',
      expect.objectContaining({ requested: ['square', 'horizontal'], dropped: ['horizontal'] }),
    )
  })

  it('throws when the API returns an empty logos array', async () => {
    fetchMock.mockResolvedValueOnce(
      apiResponse({ id: 's', sessionId: 's', logos: [] }),
    )

    await expect(
      logoService.generate({
        prompt: 'logo',
        layout: ['square'],
        appId: 'a',
        customerId: 'c',
        budgetUserId: 'b',
      }),
    ).rejects.toThrow(/no logos/)
  })
})
