import AlertIcon from '@ux/icon/alert'

import type { ToolStatus } from '@/app/develop/components/types'
import SpinnerIcon from './SpinnerIcon'

/**
 * Props for StatusIndicator component
 */
interface StatusIndicatorProps {
  status: ToolStatus
  className?: string
}

/**
 * Status indicator component for tool renderers
 *
 * Displays appropriate icon based on tool execution status:
 * - running: animated spinner
 * - error: alert icon
 * - completed: no indicator
 *
 * @param status - Current tool execution status
 * @param className - Optional CSS classes for the container
 * @returns Status indicator element or null
 */
export default function StatusIndicator({ status, className = '' }: StatusIndicatorProps) {
  switch (status) {
    case 'running':
      return (
        <span className={`inline-flex text-muted-foreground ${className}`}>
          <SpinnerIcon />
        </span>
      )
    case 'error':
    case 'incomplete':
      return (
        <span className={`inline-flex text-destructive ${className}`}>
          <AlertIcon className="w-1.5 h-1.5" />
        </span>
      )
    default:
      return null
  }
}
