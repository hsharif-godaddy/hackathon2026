#!/usr/bin/env npx tsx

/**
 * Example: WebSocket Server with AI Agent
 * 
 * This example demonstrates how to create a WebSocket server with AI capabilities
 * using the ai-lib WebSocketServer.
 */

import { createServer } from 'http'
import express from 'express'
import { createWebSocketServer, openAIModels, createTool } from '../src/index.js'
import { z } from 'zod'

// Example tool - simple calculator
const calculatorTool = createTool(
  'Perform basic mathematical calculations',
  z.object({
    expression: z.string().describe('Mathematical expression to evaluate')
  }),
  async ({ expression }) => {
    try {
      const result = Function(`"use strict"; return (${expression})`)()
      return { result: Number(result), expression, success: true }
    } catch {
      return { error: 'Invalid expression', expression, success: false }
    }
  }
)

// Create Express app and HTTP server
const app = express()
const httpServer = createServer(app)

// Serve a simple client for testing
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>AI WebSocket Example</title>
      <script src="/socket.io/socket.io.js"></script>
    </head>
    <body>
      <h1>AI WebSocket Server Example</h1>
      <div>
        <input type="text" id="messageInput" placeholder="Ask me anything..." style="width: 300px;">
        <button onclick="sendMessage()">Send</button>
      </div>
      <div id="messages" style="margin-top: 20px; font-family: monospace;"></div>
      
      <script>
        const socket = io();
        const messages = document.getElementById('messages');
        
        function addMessage(text, type = 'info') {
          const div = document.createElement('div');
          div.style.margin = '5px 0';
          div.style.color = type === 'error' ? 'red' : type === 'success' ? 'green' : 'black';
          div.textContent = text;
          messages.appendChild(div);
          messages.scrollTop = messages.scrollHeight;
        }
        
        socket.on('connect', () => addMessage('Connected to server', 'success'));
        socket.on('disconnect', () => addMessage('Disconnected from server', 'error'));
        
        socket.on('agentic_text_chunk', (data) => {
          addMessage(\`Text chunk: \${data.content}\`);
        });
        
        socket.on('agentic_tool_start', (data) => {
          addMessage(\`Tool started: \${data.data.tool.name}\`, 'info');
        });
        
        socket.on('agentic_tool_result', (data) => {
          addMessage(\`Tool completed: \${data.data.tool.name}\`, 'success');
        });
        
        socket.on('agentic_complete', (data) => {
          addMessage(\`Final response: \${data.content}\`, 'success');
        });
        
        socket.on('error', (data) => {
          addMessage(\`Error: \${data.content}\`, 'error');
        });
        
        function sendMessage() {
          const input = document.getElementById('messageInput');
          const message = input.value.trim();
          if (message) {
            addMessage(\`You: \${message}\`);
            socket.emit('chat_message', { message });
            input.value = '';
          }
        }
        
        document.getElementById('messageInput').addEventListener('keypress', (e) => {
          if (e.key === 'Enter') sendMessage();
        });
      </script>
    </body>
    </html>
  `)
})

// Create WebSocket server with configuration
const wsServer = createWebSocketServer(httpServer, {
  agent: {
    name: 'Example AI Assistant',
    systemPrompt: \`You are a helpful AI assistant with access to tools.
    
Guidelines:
- Be helpful and concise
- Use tools when appropriate
- Explain your reasoning\`,
    model: openAIModels.gpt4oMini(),
    tools: {
      calculator: calculatorTool
    },
    temperature: 0.7
  },
  cors: {
    origin: ['http://localhost:3000'],
    methods: ['GET', 'POST']
  },
  maxSteps: 3,
  onConnection: (socketId) => {
    console.log(\`📱 Client connected: \${socketId}\`)
  },
  onDisconnection: (socketId) => {
    console.log(\`📱 Client disconnected: \${socketId}\`)
  },
  onMessageStart: (socketId, message) => {
    console.log(\`💭 Processing: "\${message.substring(0, 50)}..."\`)
  },
  onMessageComplete: (socketId, result) => {
    console.log(\`✅ Completed in \${result.duration} with \${result.toolCount} tools\`)
  },
  onError: (socketId, error) => {
    console.error(\`❌ Error for \${socketId}: \${error.message}\`)
  }
})

// Start the server
const PORT = process.env.PORT || 3000
httpServer.listen(PORT, () => {
  console.log(\`🚀 Server running at http://localhost:\${PORT}\`)
  console.log(\`🔌 WebSocket server ready\`)
  console.log(\`🤖 AI Agent: \${wsServer.getAgent().config.name}\`)
  console.log(\`📊 Connections: \${wsServer.getConnectionCount()}\`)
})

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\\n🛑 Shutting down gracefully...')
  wsServer.close()
  httpServer.close(() => {
    console.log('👋 Server closed')
    process.exit(0)
  })
})
