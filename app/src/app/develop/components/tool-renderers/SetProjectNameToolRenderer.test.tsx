import '@testing-library/jest-dom'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'

import { appFetch } from '@/lib/gasket-config'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
import { useSiteStore } from '@/stores/useSiteStore'
import { mockRouter } from '@/tests/mocks'
import { renderWithProviders } from '@/tests/test-utils'
import SetProjectNameToolRenderer from './SetProjectNameToolRenderer'

vi.mock('@/lib/gasket-config')
vi.mock('next/navigation', () => ({
  useRouter: () => mockRouter(),
  usePathname: () => '/test-app-id/develop',
  useParams: () => ({ id: 'test-app-id' }),
}))

describe('SetProjectNameToolRenderer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(appFetch).mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }))
    useSiteStore.getState().cleanup()
    useDevelopPageStore.setState({ site: null })
  })

  it('should render with project name from input', async () => {
    renderWithProviders(
      <SetProjectNameToolRenderer
        toolName="setProjectName"
        toolStatus="completed"
        input={{ name: 'My Awesome Project' }}
      />
    )

    await waitFor(() => {
      expect(screen.getByText(/My Awesome Project/i)).toBeInTheDocument()
    })
  })

  it('should render completed status correctly', async () => {
    renderWithProviders(
      <SetProjectNameToolRenderer
        toolName="setProjectName"
        toolStatus="completed"
        input={{ name: 'Test Project' }}
      />
    )

    await waitFor(() => {
      expect(screen.getByText(/Project name: Test Project/i)).toBeInTheDocument()
    })
  })

  it('should not update stores when tool is running', async () => {
    renderWithProviders(
      <SetProjectNameToolRenderer
        toolName="setProjectName"
        toolStatus="running"
        input={{ name: 'Test Project' }}
      />
    )

    await waitFor(() => {
      expect(document.body).toBeTruthy()
    })

    const siteStoreState = useSiteStore.getState()
    expect(siteStoreState.sites['test-app-id']).toBeUndefined()
  })

  it('should show unknown when no name provided', async () => {
    renderWithProviders(
      <SetProjectNameToolRenderer
        toolName="setProjectName"
        toolStatus="completed"
        input={{}}
      />
    )

    await waitFor(() => {
      expect(screen.getByText(/Unknown project name/i)).toBeInTheDocument()
    })
  })

  it('should update develop page store site name with original name', async () => {
    useDevelopPageStore.setState({
      site: {
        id: 'test-app-id',
        name: 'Old Name',
        status: 'running',
      } as any
    })

    renderWithProviders(
      <SetProjectNameToolRenderer
        toolName="setProjectName"
        toolStatus="completed"
        input={{ name: 'New Name' }}
      />
    )

    await waitFor(() => {
      const state = useDevelopPageStore.getState()
      expect(state.site?.name).toBe('New Name')
    })
  })

  it('should call update site API when tool completes', async () => {
    renderWithProviders(
      <SetProjectNameToolRenderer
        toolName="setProjectName"
        toolStatus="completed"
        input={{ name: 'Test Project' }}
      />
    )

    await waitFor(() => {
      expect(appFetch).toHaveBeenCalledWith('/api/sites/test-app-id', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: 'Test Project' })
      })
    })
  })

  it('should handle project name with spaces', async () => {
    renderWithProviders(
      <SetProjectNameToolRenderer
        toolName="setProjectName"
        toolStatus="completed"
        input={{ name: 'Joshua Eichorn' }}
      />
    )

    await waitFor(() => {
      expect(appFetch).toHaveBeenCalledWith('/api/sites/test-app-id', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: 'Joshua Eichorn' })
      })
    })
  })

  it('should handle project name with special characters', async () => {
    renderWithProviders(
      <SetProjectNameToolRenderer
        toolName="setProjectName"
        toolStatus="completed"
        input={{ name: 'My Cool App! (2024)' }}
      />
    )

    await waitFor(() => {
      expect(appFetch).toHaveBeenCalledWith('/api/sites/test-app-id', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: 'My Cool App! (2024)' })
      })
    })
  })

  it('should not call update site API when tool is running', async () => {
    renderWithProviders(
      <SetProjectNameToolRenderer
        toolName="setProjectName"
        toolStatus="running"
        input={{ name: 'Test Project' }}
      />
    )

    await waitFor(() => {
      expect(document.body).toBeTruthy()
    })

    expect(appFetch).not.toHaveBeenCalled()
  })

  it('should handle project legitimately named "Unknown"', async () => {
    renderWithProviders(
      <SetProjectNameToolRenderer
        toolName="setProjectName"
        toolStatus="completed"
        input={{ name: 'Unknown' }}
      />
    )

    await waitFor(() => {
      expect(appFetch).toHaveBeenCalledWith('/api/sites/test-app-id', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: 'Unknown' })
      })
    })

    await waitFor(() => {
      expect(screen.getByText(/Project name: Unknown/i)).toBeInTheDocument()
    })
  })
})

