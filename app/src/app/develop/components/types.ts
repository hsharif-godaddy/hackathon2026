export interface ToolCall {
  id: string
  tool_name: string
  tool_args?: string
  tool_result?: string
  error?: string
  start_time?: number
  end_time?: number
  duration_ms?: number
  status: 'running' | 'success' | 'error'
}

export interface MessageSegment {
  id: string
  type: 'content' | 'tool_call'
  content?: string
  tool_call?: ToolCall
  timestamp: Date
}

export interface Message {
  id: number | string
  sender: 'user' | 'agent'
  content: string
  timestamp: Date
  isThinking?: boolean
  handoff?: {
    to: string
    action: string
    url: string
  }
  type?: 'message' | 'status' | 'tool_result' | 'tool_call' | 'complete'
  status?: string
  tool_name?: string
  tool_result?: string
  message?: string
  // Tool call specific fields (legacy - keeping for compatibility)
  tool_call_id?: string
  tool_args?: string
  start_time?: number
  end_time?: number
  duration_ms?: number
  tool_status?: 'running' | 'success' | 'error'
  error?: string
  // New integrated response structure
  tool_calls?: ToolCall[]
  // New segmented structure for interleaved content and tools
  segments?: MessageSegment[]
  response_start_time?: number
  response_end_time?: number
  response_duration_ms?: number
  is_complete?: boolean
}

export interface PlanItem {
  id: string
  title: string
  description: string
  status: 'pending' | 'in_progress' | 'complete'
  tasks: string[]
  estimatedTime: string
}
