import StatusIndicator from './StatusIndicator'

/**
 * Props for ToolHeader component
 */
interface ToolHeaderProps {
  icon: React.ReactNode
  displayName: string | React.ReactNode
  toolStatus: 'running' | 'completed' | 'error'
  hasDetails: boolean
  onOpenModal?: () => void
}

/**
 * Shared compact header component for tool renderers
 *
 * Displays a one-line tool indicator with icon, name, and status.
 * Clickable to open modal when completed and has details.
 *
 * @param icon - Emoji icon for the tool
 * @param displayName - Display name of the tool
 * @param toolStatus - Current execution status
 * @param hasDetails - Whether the tool has details to show in modal
 * @param onOpenModal - Callback to open the modal (when hasDetails is true)
 * @returns Compact tool header component
 */
export default function ToolHeader({
  icon,
  displayName,
  toolStatus,
  hasDetails,
  onOpenModal
}: ToolHeaderProps) {
  return (
    <span className="text-foreground/60 text-xs flex items-center min-w-0 gap-1">
      <span className="flex-shrink-0">{icon}</span>
      <span className="min-w-0 flex items-center gap-1">
        <span className="min-w-0 flex-1 truncate">
          {(toolStatus === 'completed' || toolStatus === 'error') && hasDetails && onOpenModal ? (
            <button
              onClick={onOpenModal}
              className="hover:text-foreground hover:underline cursor-pointer truncate block w-full text-left"
            >
              {displayName}
            </button>
          ) : (
            <span className="truncate block">
              {displayName}
            </span>
          )}
        </span>
        {toolStatus !== 'completed' && (
          <StatusIndicator status={toolStatus} className="flex-shrink-0" />
        )}
      </span>
    </span>
  )
}
