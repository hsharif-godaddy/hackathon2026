# WebSocket Event Schema

## Normalized Event Types

All content rendering should flow through these standardized events:

### 1. `step_start`
- **Purpose**: Indicates a new reasoning step has begun
- **Schema**:
```typescript
{
  type: 'step_start',
  content: string,        // Usually empty or step description
  data: {
    step: number,
    stepType: 'reasoning' | 'file_processing' | 'tool_execution'
  }
}
```

### 2. `chunk` 
- **Purpose**: All text content that should be rendered
- **Schema**:
```typescript
{
  type: 'chunk',
  content: string,        // The actual text to render
  data: {
    step: number,
    source: 'ai_response' | 'tool_output' | 'file_analysis'
  }
}
```

### 3. `tool_start`
- **Purpose**: Indicates a tool execution has begun
- **Schema**:
```typescript
{
  type: 'tool_start', 
  content: string,        // Description like "Using calculator..."
  data: {
    step: number,
    tool: {
      id: string,
      name: string,
      input: Record<string, unknown>
    }
  }
}
```

### 4. `tool_result`
- **Purpose**: Indicates a tool execution has completed
- **Schema**:
```typescript
{
  type: 'tool_result',
  content: string,        // Summary like "Calculator completed"
  data: {
    step: number,
    tool: {
      id: string,
      name: string,
      input: Record<string, unknown>,
      result: Record<string, unknown>
    }
  }
}
```

### 5. `step_complete`
- **Purpose**: Indicates a reasoning step has completed
- **Schema**:
```typescript
{
  type: 'step_complete',
  content: string,        // Final content for this step
  data: {
    step: number,
    isFinal: boolean,
    toolCalls?: ToolCall[],
    usage?: UsageData
  }
}
```

### 6. `complete`
- **Purpose**: Indicates the entire conversation has completed
- **Schema**:
```typescript
{
  type: 'complete',
  content: string,        // Final accumulated content
  data: {
    totalSteps: number,
    usage?: UsageData,
    toolCalls: ToolCall[],
    fileContext?: FileContext
  }
}
```

## Key Principles

1. **All renderable content flows through `chunk`**
   - AI responses
   - Tool outputs (when they contain displayable content)
   - File analysis results

2. **Tool events provide metadata and status**
   - `tool_start` for immediate UI feedback
   - `tool_result` for completion status
   - Tool output content goes to `chunk` if renderable

3. **Consistent data structure**
   - All events have `type`, `content`, `data`
   - `step` number for ordering
   - `source` or context information for handling

4. **No special cases**
   - File processing uses same events as regular agentic flow
   - Tool outputs normalized to text chunks when appropriate

## Implementation Strategy

1. **Normalize tool outputs**: When tools like `html_file_editor` generate content, emit that content as `chunk`

2. **Unified event emission**: Both regular agentic flow and file processing should use the same event emission logic

3. **Content extraction**: Extract renderable content from tool results and emit as text chunks

4. **Client simplification**: Clients only need to handle these 6 event types consistently
