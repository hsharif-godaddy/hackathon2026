'use client'

import { ClipboardCopy, Check } from 'lucide-react'
import { useState } from 'react'

interface ResponseMetadataProps {
  duration: number
  content: string
}

/**
 * Display response metadata including completion time and copy functionality
 *
 * Shows the time taken to complete a response and provides a copy button
 * to copy the response content to clipboard.
 *
 * @param duration - Time taken to complete the response in milliseconds
 * @param content - The response content to copy to clipboard
 *
 * @example
 * ```tsx
 * <ResponseMetadata
 *   duration={2500}
 *   content="Response text to copy"
 * />
 * ```
 */
export default function ResponseMetadata({ duration, content }: ResponseMetadataProps) {
  const [copiedToClipboard, setCopiedToClipboard] = useState(false)

  /**
   * Format duration in milliseconds to human-readable string
   *
   * @param ms - Duration in milliseconds
   * @returns Formatted duration string (e.g., "1.5s", "2m 30.0s")
   */
  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`
    if (ms < 60000) return `${(ms / 1000).toFixed(0)}s`

    const minutes = Math.floor(ms / 60000)
    const seconds = ((ms % 60000) / 1000).toFixed(0)
    return `${minutes}m ${seconds}s`
  }

  /**
   * Copy response content to clipboard and show confirmation
   */
  const handleCopyResponse = async () => {
    try {
      await navigator.clipboard.writeText(content)
      setCopiedToClipboard(true)
      setTimeout(() => setCopiedToClipboard(false), 2000)
    } catch (err) {
      console.error('Failed to copy response:', err)
    }
  }

  return (
    <div className="flex items-center justify-between mt-3 text-xs text-foreground/60">
      <span>
        Completed in {formatDuration(duration)}
      </span>
      <button
        onClick={handleCopyResponse}
        className="hover:text-muted-foreground transition-colors cursor-pointer"
        title="Copy response to clipboard"
      >
        {copiedToClipboard ? <Check className="w-4 h-4" /> : <ClipboardCopy className="w-4 h-4" />}
      </button>
    </div>
  )
}

