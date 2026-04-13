'use client'

import { type ReactNode } from 'react'
import Modal from '@ux/modal'

interface ToolModalProps {
  isOpen: boolean
  onClose: () => void
  title: string
  children: ReactNode
}

/**
 * Shared modal component for tool renderers
 *
 * Provides consistent modal UI with backdrop, animations, and close button.
 * Used across multiple tool renderers for displaying detailed information.
 *
 * @param isOpen - Whether the modal is currently open
 * @param onClose - Callback to close the modal
 * @param title - Modal title text
 * @param children - Modal content
 * @returns Modal component
 */
export default function ToolModal({
  isOpen,
  onClose,
  title,
  children
}: ToolModalProps) {
  if (!isOpen) return null

  return (
    <Modal title={title} onClose={onClose}>
      <div className="flex flex-col max-h-[75vh]">
        {children}
      </div>
    </Modal>
  )
}
