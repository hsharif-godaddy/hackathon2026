# AI Playground

A Next.js test application demonstrating the **@airo/ai-lib** wrapper library with AI SDK 5, WebSockets, and agentic reasoning capabilities.

## Features

- 🤖 **Real-time Chat Interface** - WebSocket-powered chat with the AI assistant
- 🧠 **Agentic Mode** - Multi-step reasoning with tool usage
- 🛠️ **Example Tools** - Calculator, weather lookup, and task planner
- 📱 **Responsive UI** - Modern, mobile-friendly interface
- ⚡ **Real-time Updates** - Live status updates and step-by-step reasoning display

## Quick Start

1. **Set up environment**:
   ```bash
   cp .env.example .env.local
   # Edit .env.local and add your OPENAI_API_KEY
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Run the development server**:
```bash
npm run dev
   ```

4. **Open your browser** and navigate to `http://localhost:3000`

## Architecture

### Components

- **ChatInterface** - Main chat UI component
- **ChatBubble** - Individual message display with tool call info
- **ChatInput** - Message input with agentic mode toggle
- **StatusIndicator** - Connection and processing status display

### WebSocket Implementation

The app uses Socket.IO for real-time communication:

- **Server**: Custom Express server with WebSocket support (`server.js`)
- **Client**: React hook (`useWebSocket.ts`) for managing connection state
- **Messages**: Structured message types for chat, agentic steps, and tool calls

### AI Integration

Built on the **@airo/ai-lib** wrapper:

- **Agent Configuration** - Pre-configured with system prompt and tools
- **Agentic Runner** - Multi-step reasoning with tool execution
- **Tool Ecosystem** - Calculator, weather, and task planning tools

## Usage Modes

### 💬 Normal Chat Mode
Direct conversation with the AI assistant. Good for:
- Simple questions
- Quick calculations
- Weather lookups

### 🧠 Agentic Mode
Multi-step reasoning with tool usage. Perfect for:
- Complex problem solving
- Task planning
- Multi-step calculations

## Example Interactions

### Calculator Tool
```
User: "What's 15% of 2,400?"
AI: Uses calculator tool → Returns 360
```

### Weather Tool (Simulated)
```
User: "Weather in Tokyo"
AI: Uses weather tool → Returns current conditions
```

### Task Planner
```
User: "Plan a weekend trip to Paris"
AI: Uses task planner → Breaks down into actionable steps
```

### Agentic Reasoning
```
User: "I need to budget for a home renovation. The total cost is $50,000. I can save $800/month. How long until I can afford it, and what if I get a 5% annual return on my savings?"

AI: (In agentic mode)
Step 1: Calculates basic timeline (50,000 ÷ 800 = 62.5 months)
Step 2: Factors in 5% compound interest
Step 3: Uses calculator for precise compound interest calculation
Step 4: Provides comprehensive financial advice
```

## Development

### Adding New Tools

Tools are defined in `src/lib/websocket-server.ts`:

```typescript
const newTool = createTool(
  'tool_name',
  'Tool description',
  z.object({
    param: z.string().describe('Parameter description')
  }),
  async ({ param }) => {
    // Tool implementation
    return { result: 'success' }
  }
)
```

### Customizing the Agent

Modify the agent configuration in `websocket-server.ts`:

```typescript
const agent = new Agent({
  name: 'Your Assistant Name',
  systemPrompt: 'Your custom system prompt...',
  model: openAIModels.gpt4oMini(),
  tools: [/* your tools */],
  temperature: 0.7,
  enableLoopControl: true
})
```

### WebSocket Message Types

```typescript
interface WebSocketMessage {
  type: 'chat' | 'agentic' | 'tool_call' | 'error' | 'status'
  content?: string
  data?: any
  step?: number
  totalSteps?: number
}
```

## Deployment

1. **Build the application**:
   ```bash
   npm run build
   ```

2. **Start the server**:
   ```bash
   npm start
   ```

The app will run on port 3000 with both the Next.js application and WebSocket server.

## Troubleshooting

### WebSocket Connection Issues
- Ensure port 3000 is available
- Check that the custom server is running
- Verify CORS settings in production

### AI Responses Not Working
- Verify your `OPENAI_API_KEY` in `.env.local`
- Check the browser console for WebSocket errors
- Ensure the AI library is properly installed

### Tool Execution Errors
- Check the server console for tool execution logs
- Verify tool input schemas match expected parameters
- Test tools individually in agentic mode

## Technology Stack

- **Framework**: Next.js 15 with App Router
- **UI**: Tailwind CSS, Custom Components
- **Real-time**: Socket.IO WebSockets
- **AI**: @airo/ai-lib wrapper with AI SDK 5
- **Tools**: Zod for schema validation
- **Types**: TypeScript throughout

## License

This is a demonstration application for the @airo/ai-lib package.