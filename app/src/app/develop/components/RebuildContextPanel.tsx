'use client'

import { useEffect, useState } from 'react'
import { RefreshCw, Hammer } from 'lucide-react'

import { agentFetch } from '@/lib/agent-fetch'
import { logger } from '@/lib/request-context'
import { useSiteStore } from '@/stores/useSiteStore'
import Box from '@ux/box'
import Button from '@ux/button'
import SelectInput from '@ux/select-input'
import text from '@ux/text'
import Spinner from '@ux/spinner'
import Alert from '@ux/alert'

interface RebuildContextPanelProps {
  appId: string
  onBuildPage: (pageSlug: string) => void
}

interface AvailablePage {
  slug: string
  title: string
  url: string
}

export default function RebuildContextPanel({ appId, onBuildPage }: RebuildContextPanelProps) {
  const [pages, setPages] = useState<AvailablePage[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [selectedPage, setSelectedPage] = useState<string>('')
  const [isBuilding, setIsBuilding] = useState(false)

  useEffect(() => {
    loadPages()
  }, [appId])

  const loadPages = async () => {
    try {
      setIsLoading(true)

      const site = await useSiteStore.getState().fetchSite(appId)
      if (!site?.agent_url) {
        throw new Error('Agent URL not available for this site')
      }

      const response = await agentFetch(`${site.agent_url}/rebuild/${appId}/pages`, {
        siteId: appId
      })

      if (!response.ok) {
        throw new Error('Failed to load pages')
      }

      const { pages: availablePages } = await response.json()
      setPages(availablePages)

      if (availablePages.length > 0) {
        setSelectedPage(availablePages[0].slug)
      }
    } catch (error) {
      logger.error('rebuild-context.load-pages-error', {
        appId,
        error: error instanceof Error ? error.message : String(error)
      })
    } finally {
      setIsLoading(false)
    }
  }

  const handleBuildPage = async () => {
    if (!selectedPage || isBuilding) return

    try {
      setIsBuilding(true)
      await onBuildPage(selectedPage)
    } catch (error) {
      logger.error('rebuild-context.build-page-error', {
        appId,
        pageSlug: selectedPage,
        error: error instanceof Error ? error.message : String(error)
      })
    } finally {
      setIsBuilding(false)
    }
  }

  if (isLoading) {
    return (
      <Alert emphasis="info">
        <Box orientation="horizontal" blockAlignChildren="center" gap="sm">
          <Spinner size="sm" />
          <text.p size={0}>Loading rebuild context...</text.p>
        </Box>
      </Alert>
    )
  }

  if (pages.length === 0) {
    return null
  }

  return (
    <Alert emphasis="highlight">
      <Box gap="md">
        <Box orientation="horizontal" blockAlignChildren="center" inlineAlignChildren="center" gap="sm">
          <text.p size={0}>Rebuild Mode</text.p>
          <text.p size={-1} emphasis="passive">{pages.length} pages</text.p>
        </Box>

        <Box orientation="horizontal" gap="sm" blockAlignChildren="end">
          <Box stretch>
            <SelectInput
              id="page-select"
              name="page-select"
              label="Select page to build"
              value={selectedPage}
              onChange={(value) => setSelectedPage(value)}
              disabled={isBuilding}
              visualSize="sm"
              stretch
            >
              {pages.map(page => {
                // Strip domain and show only path
                let displayTitle = page.url
                try {
                  const urlObj = new URL(page.url)
                  displayTitle = urlObj.pathname === '/' ? 'Homepage' : urlObj.pathname
                } catch {
                  displayTitle = page.url
                }
                
                // Truncate if still too long
                if (displayTitle.length > 30) {
                  displayTitle = displayTitle.substring(0, 27) + '...'
                }
                
                return (
                  <option key={page.slug} value={page.slug}>
                    {displayTitle}
                  </option>
                )
              })}
            </SelectInput>
          </Box>

          <Button
            text={isBuilding ? 'Generating...' : 'Build Page'}
            design="primary"
            size="sm"
            onClick={handleBuildPage}
            disabled={!selectedPage || isBuilding}
            icon={isBuilding ? <Spinner size="sm" /> : <Hammer className="w-3 h-3" />}
          />
        </Box>
      </Box>
    </Alert>
  )
}
