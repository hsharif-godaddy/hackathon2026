/**
 * @vitest-environment jsdom
 */

import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

import { ImmersiveLayout } from './ImmersiveLayout'

vi.mock('./ImmersiveHeader', () => ({
  ImmersiveHeader: () => <div data-testid="immersive-header" />,
}))

vi.mock('@/stores/useDevelopPageStore', () => ({
  useDevelopPageStore: (selector: (state: { chatPaneWidth: number }) => unknown) =>
    selector({ chatPaneWidth: 400 }),
}))

describe('ImmersiveLayout', () => {
  describe('desktop', () => {
    it('docks the pinned panel beside the chat when a panel is supplied', () => {
      render(
        <ImmersiveLayout
          isMobile={false}
          chatPaneNode={<div data-testid="chat-pane" />}
          pinnedPanelNode={<div data-testid="panel" />}
        />,
      )
      expect(screen.getByTestId('chat-pane')).toBeInTheDocument()
      expect(screen.getByTestId('panel')).toBeInTheDocument()
    })

    it('shows a full-width chat (no panel) when no panel is supplied', () => {
      render(
        <ImmersiveLayout
          isMobile={false}
          chatPaneNode={<div data-testid="chat-pane" />}
          pinnedPanelNode={undefined}
        />,
      )
      expect(screen.getByTestId('chat-pane')).toBeInTheDocument()
      expect(screen.queryByTestId('panel')).not.toBeInTheDocument()
    })
  })

  describe('mobile', () => {
    it('renders the pinned panel full-screen (not the chat) when a panel is supplied', () => {
      render(
        <ImmersiveLayout
          isMobile={true}
          chatPaneNode={<div data-testid="chat-pane" />}
          pinnedPanelNode={<div data-testid="panel" />}
        />,
      )
      expect(screen.getByTestId('panel')).toBeInTheDocument()
      expect(screen.queryByTestId('chat-pane')).not.toBeInTheDocument()
    })

    it('renders the chat full-screen (no panel) when no panel is supplied', () => {
      render(
        <ImmersiveLayout
          isMobile={true}
          chatPaneNode={<div data-testid="chat-pane" />}
          pinnedPanelNode={undefined}
        />,
      )
      expect(screen.getByTestId('chat-pane')).toBeInTheDocument()
      expect(screen.queryByTestId('panel')).not.toBeInTheDocument()
    })
  })
})
