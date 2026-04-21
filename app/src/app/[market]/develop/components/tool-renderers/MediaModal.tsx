'use client'

import { type ReactNode } from 'react'
import Modal from '@ux/modal'

interface MediaModalProps {
  isOpen: boolean
  onClose: () => void
  title: string
  children: ReactNode
}

export default function MediaModal({
  isOpen,
  onClose,
  title,
  children
}: MediaModalProps) {
  if (!isOpen) return null

  return (
    <Modal title={title} onClose={onClose} portalElem={document.body}>
      {children}
    </Modal>
  )
}
