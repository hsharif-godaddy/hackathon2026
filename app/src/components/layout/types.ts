import React from 'react'

export interface HeaderProps {
  // Optional page-specific actions that will be rendered before the UserMenu
  actions?: React.ReactNode
  // Optional className for custom styling
  className?: string
  // Optional callback for showing mock login dialog
  onShowMockLogin?: () => void
  // Optional location for EID tracking
  location?: string
}
