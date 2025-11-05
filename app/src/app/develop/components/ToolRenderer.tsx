import { getToolRenderer } from './tool-renderers'
import type { ToolCall } from '@/stores/useStreamingConversationStore'

/**
 * Props for the ToolRenderer component
 */
interface ToolRendererProps {
  toolCall: ToolCall
  className?: string
}

/**
 * Renders a tool call using the appropriate renderer
 * 
 * Dynamically loads and renders the appropriate tool renderer component based on
 * the tool name. Falls back to DefaultToolRenderer if no custom renderer exists.
 * 
 * @param toolCall - The tool call data to render
 * @param className - Optional CSS classes to apply to the container
 * @returns The rendered tool component
 */
export default function ToolRenderer({ toolCall, className = '' }: ToolRendererProps) {
  const ToolRendererComponent = getToolRenderer(toolCall.name)

  return (
    <div className={`my-1 ${className}`}>
      <ToolRendererComponent
        toolName={toolCall.name}
        toolStatus={toolCall.status}
        duration={toolCall.duration}
        input={toolCall.input}
        result={toolCall.result}
        error={toolCall.error}
        startTime={toolCall.startTime}
        endTime={toolCall.endTime}
      />
    </div>
  )
}

