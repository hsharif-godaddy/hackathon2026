'use client'

/**
 * Thinking indicator component for active streams
 *
 * Displays a subtle "Airo Developer is thinking" message with animated dots
 * to indicate that the system is processing but hasn't produced content yet.
 *
 * @returns React element for the thinking indicator
 */
export default function ThinkingIndicator() {
  return (
    <div className="flex items-center gap-4 text-sm mt-4">
      <div className="bg-ai-light/40 rounded-sm px-2 py-1">Airo Developer is thinking</div>
      <div className="flex space-x-1">
        <div className="w-2 h-2 bg-ai-light rounded-full animate-bounce"></div>
        <div className="w-2 h-2 bg-ai rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
        <div className="w-2 h-2 bg-ai-dark rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
      </div>
    </div>
  )
}

