export interface App {
  id: string;
  name: string;
  path: string;
  port: number;
  initialPrompt?: string;
  templateVersion?: string; // v1, v2, v3, etc.
  status: 'creating' | 'created' | 'error';
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateAppRequest {
  name: string;
  initialPrompt?: string;
}

export interface UpdateAppRequest {
  name?: string;
}

export interface RunningProcess {
  id: string;
  appId: string;
  pid: number;
  port: number;
  startedAt: Date;
  status: 'running' | 'stopped' | 'crashed';
}

export interface Conversation {
  id: string;
  appId: string;
  agentId: string;
  title?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ConversationMessage {
  id: string;
  conversationId: string;
  sender: 'user' | 'agent';
  content: string;
  messageType?: 'status' | 'tool_result' | 'error';
  toolCalls?: ToolCall[];
  segments?: MessageSegment[];
  metadata?: Record<string, any>;
  createdAt: Date;
}

export interface ToolCall {
  id: string;
  tool_name: string;
  tool_args: any;
  tool_result?: any;
  error?: string;
  start_time?: number;
  end_time?: number;
  duration_ms?: number;
  status: 'running' | 'success' | 'error';
}

export interface MessageSegment {
  id: string;
  type: 'content' | 'tool_call';
  content?: string;
  tool_call?: ToolCall;
  timestamp: Date;
}

export interface TokenUsage {
  id: string;
  appId: string;
  operation: 'llm_request' | 'file_edit' | 'tool_execution';
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  model?: string | undefined;
  cost?: number | undefined; // Optional cost calculation
  conversationId?: string | undefined;
  description?: string | undefined;
  createdAt: Date;
}


