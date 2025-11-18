import AlertIcon from '@ux/icon/alert'
import SpinnerIcon from './SpinnerIcon'

/**
 * Props for StatusIndicator component
 */
interface StatusIndicatorProps {
  status: 'running' | 'completed' | 'error'
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
      return (
        <span className={`inline-flex text-destructive ${className}`}>
          <AlertIcon className="w-2.5 h-2.5" />
        </span>
      )
    default:
      return null
  }
}
