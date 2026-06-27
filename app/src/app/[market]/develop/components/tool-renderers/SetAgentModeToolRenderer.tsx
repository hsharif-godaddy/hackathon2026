'use client'

import { Settings } from 'lucide-react'

import type { DefaultToolRendererProps } from './DefaultToolRenderer'
import ToolHeader from './ToolHeader'

export default function SetAgentModeToolRenderer({
  toolName: _toolName,
  toolStatus,
  input,
}: DefaultToolRendererProps) {
  const mode: string = (input && typeof input === 'object' && (input as Record<string, unknown>).mode as string) || 'unknown'

  return (
    <ToolHeader
      icon={<Settings className="w-2 h-2" />}
      displayName={`Agent mode: ${mode}`}
      toolStatus={toolStatus}
      hasDetails={false}
    />
  )
}
