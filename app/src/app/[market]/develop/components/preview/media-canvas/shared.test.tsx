/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'

import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'

import type { MediaFolder } from '@/hooks/useMediaFolders'
import { renderWithProviders } from '@/tests/test-utils'
import { ThumbnailMenu } from './shared'

const folder: MediaFolder = {
  id: 'folder-1',
  name: 'Content',
  slots: [],
  createdAt: '2026-06-26T00:00:00.000Z',
}

describe('ThumbnailMenu', () => {
  it('keeps remove-from-folder reachable when hovering the folder action', async () => {
    const onRemoveFromFolder = vi.fn()
    const { user } = renderWithProviders(
      <ThumbnailMenu
        folders={[folder]}
        onMoveToFolder={vi.fn()}
        showRemoveFromFolder
        onRemoveFromFolder={onRemoveFromFolder}
      />
    )

    await user.click(screen.getByRole('button', { name: 'Options' }))
    await user.hover(screen.getByRole('button', { name: /Move to Folder/i }))

    expect(screen.queryByRole('button', { name: 'Content' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Remove from Folder/i }))

    expect(onRemoveFromFolder).toHaveBeenCalledOnce()
  })

  it('opens folder choices on click', async () => {
    const onMoveToFolder = vi.fn()
    const { user } = renderWithProviders(
      <ThumbnailMenu folders={[folder]} onMoveToFolder={onMoveToFolder} />
    )

    await user.click(screen.getByRole('button', { name: 'Options' }))
    const folderButton: HTMLElement = screen.getByRole('button', { name: /Move to Folder/i })
    const chevron: SVGSVGElement | null = folderButton.querySelector('svg:last-child')
    if (!chevron) throw new Error('Folder chevron not found')

    expect(chevron).not.toHaveClass('rotate-90')

    await user.click(folderButton)

    expect(chevron).toHaveClass('rotate-90')

    await user.click(screen.getByRole('button', { name: 'Content' }))

    expect(onMoveToFolder).toHaveBeenCalledWith('folder-1')
  })
})
