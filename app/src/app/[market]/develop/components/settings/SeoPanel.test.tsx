/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import type { GoogleSearchConsoleConnection, SiteAssociation } from '@/types/social'
import { SocialPlatformKey } from '@/types/social'

vi.mock('@/utils/getRootDomain', () => ({ getRootDomain: () => 'godaddy.com' }))
vi.mock('next/navigation', () => ({ useParams: () => ({ market: 'en-US' }) }))

vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () => (key: string, values?: Record<string, string>) => {
    if (!values) return key
    return Object.entries(values).reduce((msg, [k, v]) => msg.replace(`{${k}}`, v), key)
  },
}))

const mockPublishedUrl = vi.hoisted(() => vi.fn<[], string | null>(() => null))
vi.mock('@/app/[market]/develop/hooks/usePublishedUrl', () => ({
  usePublishedUrl: () => mockPublishedUrl(),
}))

const mockAssociations = vi.hoisted(() => vi.fn<[], SiteAssociation[]>(() => []))
vi.mock('@/hooks/useSocial', () => ({
  useSiteAssociations: () => ({ data: { associations: mockAssociations() }, isLoading: false }),
}))

const mockConnections = vi.hoisted(() => vi.fn<[], GoogleSearchConsoleConnection[]>(() => []))
vi.mock('@/hooks/social/queries/useSocialV2', () => ({
  useSocialConnections: () => ({ data: mockConnections(), isLoading: false }),
  useCreateSocialConnection: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

const mockMetadata = vi.hoisted(() =>
  vi.fn<[], { googleVerificationToken?: string | null; googleVerificationSiteUrl?: string | null; googleVerificationUserTokenId?: string | null }>(() => ({}))
)
vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>()
  return {
    ...actual,
    useQuery: (opts: { queryKey: unknown[] }) => {
      if (Array.isArray(opts.queryKey) && opts.queryKey[0] === 'app-metadata') {
        return { data: mockMetadata(), isLoading: false }
      }
      return { data: undefined, isLoading: false }
    },
    useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  }
})

vi.mock('@/hooks/social/queries/useSocialAuthUrl', () => ({
  useSocialAuthUrl: () => ({ data: { url: 'https://accounts.google.com/o/oauth2/auth?mock' } }),
}))

vi.mock('@/hooks/social/connect-flow/useAuthPopup', () => ({
  AuthStatus: { Idle: 'idle', Success: 'success', Error: 'error' },
  useAuthPopup: () => ({ authStatus: 'idle', errorMessage: null, openPopup: vi.fn() }),
}))

vi.mock('@/hooks/social/mutations/useLinkConnection', () => ({
  useLinkConnection: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

vi.mock('@/config/dynamic-api', () => ({
  buildDynamicApiUrl: vi.fn(async (path: string) => `https://agents.local/apps/testapp01/${path}`),
}))

vi.mock('@/lib/agent-fetch', () => ({
  agentFetch: vi.fn(async () => ({ ok: true, json: async () => ({}) })),
}))

vi.mock('@/lib/social-gsc', () => ({
  gscClient: {
    getGscVerificationToken: vi.fn(async () => 'mock-token'),
    verifyGscSite: vi.fn(async () => undefined),
    addGscSite: vi.fn(async () => undefined),
    submitGscSitemap: vi.fn(async () => undefined),
  },
}))

vi.mock('@/lib/social-utils', () => ({ parseUserId: () => 'user-123' }))
vi.mock('@/lib/request-context', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import SeoPanel from './SeoPanel'

const GSC_ASSOCIATION: SiteAssociation = {
  id: 'assoc-1',
  appId: 'testapp01',
  socialId: 'gsc-social-id',
  platform: SocialPlatformKey.GOOGLE_SEARCH_CONSOLE,
  createdAt: new Date().toISOString(),
}

const GSC_CONNECTION: GoogleSearchConsoleConnection = {
  socialId: 'gsc-social-id',
  userTokenId: 'Platform#GOOGLE#TokenType#USER#123',
  platform: SocialPlatformKey.GOOGLE_SEARCH_CONSOLE,
  userId: 'user-1',
}

function renderPanel(): ReturnType<typeof render> {
  return render(<SeoPanel siteId="testapp01" />)
}

describe('SeoPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPublishedUrl.mockReturnValue(null)
    mockAssociations.mockReturnValue([])
    mockConnections.mockReturnValue([])
    mockMetadata.mockReturnValue({})
  })

  describe('unpublished state', () => {
    it('shows the unpublished description when the site has no published URL', () => {
      mockPublishedUrl.mockReturnValue(null)
      renderPanel()
      expect(screen.getByText('builder_seo_gsc_unpublished_description')).toBeInTheDocument()
      expect(screen.queryByRole('button')).not.toBeInTheDocument()
    })
  })

  describe('connect state', () => {
    it('shows the connect button when the site is published and not connected', () => {
      mockPublishedUrl.mockReturnValue('https://example.godaddysites.com')
      renderPanel()
      expect(screen.getByText('builder_seo_gsc_connect_description')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'builder_seo_gsc_connect_button' })).toBeInTheDocument()
    })
  })

  describe('pending verification state', () => {
    beforeEach(() => {
      mockPublishedUrl.mockReturnValue('https://example.godaddysites.com')
      mockMetadata.mockReturnValue({
        googleVerificationToken: 'abc123',
        googleVerificationSiteUrl: 'https://example.godaddysites.com',
        googleVerificationUserTokenId: 'Platform#GOOGLE#TokenType#USER#123',
      })
    })

    it('shows the pending verification description and verify button', () => {
      renderPanel()
      expect(screen.getByText('builder_seo_gsc_pending_description')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'builder_seo_gsc_verify_button' })).toBeInTheDocument()
    })

    it('does not show the verify button when already connected', () => {
      mockAssociations.mockReturnValue([GSC_ASSOCIATION])
      mockConnections.mockReturnValue([GSC_CONNECTION])
      renderPanel()
      expect(screen.queryByRole('button', { name: 'builder_seo_gsc_verify_button' })).not.toBeInTheDocument()
    })
  })

  describe('connected state', () => {
    beforeEach(() => {
      mockPublishedUrl.mockReturnValue('https://example.godaddysites.com')
      mockAssociations.mockReturnValue([GSC_ASSOCIATION])
      mockConnections.mockReturnValue([GSC_CONNECTION])
      mockMetadata.mockReturnValue({})
    })

    it('shows the connected label and Google icon area', () => {
      renderPanel()
      expect(screen.getByText('builder_seo_gsc_connected_label')).toBeInTheDocument()
    })

    it('shows the published site URL', () => {
      renderPanel()
      expect(screen.getByText('builder_seo_gsc_site_label')).toBeInTheDocument()
    })

    it('shows the re-submit sitemap button', () => {
      renderPanel()
      expect(screen.getByRole('button', { name: 'builder_seo_gsc_resubmit_button' })).toBeInTheDocument()
    })

    it('does not show the re-submit button when publishedUrl is null', () => {
      mockPublishedUrl.mockReturnValue(null)
      renderPanel()
      expect(screen.queryByRole('button', { name: 'builder_seo_gsc_resubmit_button' })).not.toBeInTheDocument()
    })

    it('does not show the re-submit button when there is no connected token', () => {
      mockConnections.mockReturnValue([])
      renderPanel()
      expect(screen.queryByRole('button', { name: 'builder_seo_gsc_resubmit_button' })).not.toBeInTheDocument()
    })

    it('calls submitGscSitemap with publishedUrl when re-submit is clicked', async () => {
      const { gscClient } = await import('@/lib/social-gsc')
      renderPanel()
      await userEvent.click(screen.getByRole('button', { name: 'builder_seo_gsc_resubmit_button' }))
      expect(gscClient.submitGscSitemap).toHaveBeenCalledWith(
        'https://example.godaddysites.com',
        'Platform#GOOGLE#TokenType#USER#123'
      )
    })

    it('shows a link to the GSC dashboard with the encoded site URL', () => {
      renderPanel()
      const link = screen.getByRole('link', { name: 'builder_seo_gsc_dashboard_link' })
      expect(link).toBeInTheDocument()
      expect(link).toHaveAttribute(
        'href',
        `https://search.google.com/search-console?resource_id=${encodeURIComponent('https://example.godaddysites.com')}`
      )
      expect(link).toHaveAttribute('target', '_blank')
    })

    it('does not show the dashboard link when publishedUrl is null', () => {
      mockPublishedUrl.mockReturnValue(null)
      renderPanel()
      expect(screen.queryByRole('link', { name: 'builder_seo_gsc_dashboard_link' })).not.toBeInTheDocument()
    })

    it('does not show the connect or verify buttons', () => {
      renderPanel()
      expect(screen.queryByRole('button', { name: 'builder_seo_gsc_connect_button' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'builder_seo_gsc_verify_button' })).not.toBeInTheDocument()
    })
  })
})
