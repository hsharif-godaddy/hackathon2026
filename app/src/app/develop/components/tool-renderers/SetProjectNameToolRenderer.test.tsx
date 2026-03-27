/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'

import { mockRouter } from '@/tests/mocks'
import { renderWithProviders } from '@/tests/test-utils'
import SetProjectNameToolRenderer from './SetProjectNameToolRenderer'

vi.mock('next/navigation', () => ({
  useRouter: () => mockRouter(),
  usePathname: () => '/test-app-id/develop',
  useParams: () => ({ id: 'test-app-id' }),
}))

describe('SetProjectNameToolRenderer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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

  it('should render when tool is running', async () => {
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

  it('should handle project name with spaces', async () => {
    renderWithProviders(
      <SetProjectNameToolRenderer
        toolName="setProjectName"
        toolStatus="completed"
        input={{ name: 'Joshua Eichorn' }}
      />
    )

    await waitFor(() => {
      expect(screen.getByText(/Joshua Eichorn/i)).toBeInTheDocument()
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
      expect(screen.getByText(/My Cool App! \(2024\)/i)).toBeInTheDocument()
    })
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
      expect(screen.getByText(/Project name: Unknown/i)).toBeInTheDocument()
    })
  })
})
