# Airo AI Builder - Agent Architecture Documentation

## Table of Contents

1. [Architectural Diagrams](#architectural-diagrams)
2. [Generic Flow Diagram](#generic-flow-diagram)
3. [Agent Purpose](#agent-purpose)
4. [Agent Exposure](#agent-exposure)
5. [Authentication & Authorization](#authentication--authorization)
6. [MCP Server Usage](#mcp-server-usage)
7. [Available Tools](#available-tools)
8. [Tool Authentication & Authorization](#tool-authentication--authorization)
9. [Service Utilization](#service-utilization)
10. [Network Environment](#network-environment)
11. [Tool Ownership](#tool-ownership)
12. [Service Deployment Model](#service-deployment-model)

---

## Architectural Diagrams

### High-Level System Architecture

```mermaid
graph TB
    User[User Browser] --> CDN[Edge Gateway]
    CDN --> NextJS[Next.js UI :3000]

    NextJS -->|WebSocket| AgentService[Agents Service :4000]
    NextJS -->|HTTPS REST| AgentService

    AgentService --> AgentRegistry[Agent Registry]
    AgentService --> Tools[Tool Suite]
    AgentService --> SQLite[(SQLite DB)]

    AgentRegistry --> DevelopAgent[Develop Agent]
    AgentRegistry --> DatabaseAgent[Database Agent]
    AgentRegistry --> ColorAgent[Color Scheme Agent]
    AgentRegistry --> ExampleAgent[Example Agent]

    Tools --> CoreTools[Core Development Tools]
    Tools --> SystemTools[System & Server Tools]
    Tools --> BackendTools[Database & API Tools]
    Tools --> MediaTools[Image & Content Tools]

    CoreTools --> FileEdit[fileEdit]
    CoreTools --> ReadFile[readFile]
    CoreTools --> GrepSearch[grepSearch]
    CoreTools --> DirListing[directoryListing]

    SystemTools --> Terminal[terminalCommand]
    SystemTools --> Git[gitOperation]
    SystemTools --> ServerMgmt[serverRestart/Status]
    SystemTools --> ViewLogs[viewLogs]

    BackendTools --> MySQL[mysqlOperation]
    BackendTools --> APIGen[autoAPIGenerator]

    MediaTools --> ImgSearch[imageSearch]
    MediaTools --> ImgGen[imageGenerate]

    AgentService --> Templates[App Templates v1-v8]
    Templates --> UserApps[Generated User Apps]

    style AgentService fill:#e8f5e8
    style DevelopAgent fill:#e3f2fd
    style Tools fill:#fff3e0
```

### Multi-Agent Handoff Architecture

```mermaid
graph LR
    User[User] -->|Chat| Develop[Develop Agent]

    Develop -->|Database Setup| Database[Database Agent]
    Database -->|Complete| Develop

    Develop -->|Color Design| ColorScheme[Color Scheme Agent]
    ColorScheme -->|Complete| Develop

    Develop -->|Tools| ToolSuite[Tool Suite]
    Database -->|Tools| ToolSuite
    ColorScheme -->|Tools| ToolSuite

    ToolSuite --> Files[File Operations]
    ToolSuite --> System[System Commands]
    ToolSuite --> Backend[Database & API]
    ToolSuite --> Media[Images & Content]

    style Develop fill:#4caf50
    style Database fill:#2196f3
    style ColorScheme fill:#ff9800
    style ToolSuite fill:#9c27b0
```

### Deployment Architecture

```mermaid
graph TB
    subgraph "Development Environment"
        DevAgent[Agents Service :4000]
        DevUI[Next.js UI :3000]
        DevDB[(SQLite)]
        DevApps[User Apps :3001+]

        DevUI <-->|WebSocket/HTTPS| DevAgent
        DevAgent --> DevDB
        DevAgent --> DevApps
    end

    subgraph "Docker Environment"
        DockerAgent[Agents Container :4000]
        DockerUI[App Container :3000]
        DockerProxy[Proxy Container :8888]
        MySQLDev[(MySQL :3306)]

        DockerUI <-->|WebSocket/HTTPS| DockerAgent
        DockerAgent --> DockerProxy
        DockerUI --> MySQLDev
    end

    subgraph "Production Environment"
        ProdLB[Load Balancer]
        ProdAgent[Agents Service]
        ProdUI[Next.js UI]
        ProdDB[(MySQL)]
        Nomad[Nomad Scheduler]
        SQS[AWS SQS]
        Ceph[Ceph Storage]

        ProdLB --> ProdUI
        ProdLB --> ProdAgent
        ProdUI <-->|WebSocket/HTTPS| ProdAgent
        ProdAgent --> ProdDB
        ProdAgent --> SQS
        SQS --> Nomad
        Nomad --> Ceph
    end

    SSO[GoDaddy SSO] -->|JWT Auth| DevUI
    SSO -->|JWT Auth| DockerUI
    SSO -->|JWT Auth| ProdUI

    style DevAgent fill:#e8f5e8
    style DockerAgent fill:#e3f2fd
    style ProdAgent fill:#fff3e0
```

---

## Generic Flow Diagram

### User Interaction Flow

```mermaid
sequenceDiagram
    participant User
    participant Browser
    participant NextJS as Next.js UI
    participant Auth as JWT Auth Service
    participant SSO as GoDaddy SSO
    participant AgentAPI as Agents Service
    participant Agent as AI Agent
    participant Tools as Tool Suite
    participant App as User App

    User->>Browser: Access Application
    Browser->>NextJS: Load UI
    NextJS->>Auth: Check Authentication
    Note over Auth: Uses existing GoDaddy SSO for UI authentication
    Auth-->>NextJS: Authenticated

    User->>Browser: Send Message to Agent
    Browser->>NextJS: Chat Message
    NextJS->>AgentAPI: WebSocket: ai-stream event
    Note over NextJS,AgentAPI: auth: { token: JWT } + Authorization: Bearer JWT

    AgentAPI->>AgentAPI: Validate JWT with Public Key
    Note over AgentAPI: Extract siteId from JWT payload

    AgentAPI->>Agent: Process Message
    Note over Agent: Load System Prompt
    Note over Agent: Load Conversation History
    Note over Agent: Build Context

    Agent->>Agent: Generate Response

    alt Agent needs to use tools
        Agent->>Tools: Execute Tool
        Tools->>Tools: Validate App Context
        Tools->>App: Perform Operation
        App-->>Tools: Result
        Tools-->>Agent: Tool Result
        Agent->>Agent: Continue Processing
    end

    Agent-->>AgentAPI: Streaming Response
    AgentAPI-->>NextJS: WebSocket: ai-chunk events
    NextJS-->>Browser: Update UI
    Browser-->>User: Display Response

    alt Operation involves file changes
        Agent->>Tools: fileEdit
        Tools->>App: Write/Update File
        App-->>Tools: Success
        Tools-->>Agent: File Updated
        Agent-->>AgentAPI: Notify User
        AgentAPI-->>NextJS: Stream Update
        NextJS-->>Browser: Refresh Preview
    end
```

### Tool Execution Flow

```mermaid
sequenceDiagram
    participant Agent as AI Agent
    participant Tool as Tool
    participant DevSupervisor as Dev Supervisor
    participant AppRepo as App Repository
    participant FileSystem as File System
    participant DevServer as Dev Server

    Agent->>Tool: Execute Tool
    Tool->>AppRepo: Get App Context
    AppRepo-->>Tool: App Path & Metadata

    alt File Operations
        Tool->>FileSystem: Validate Path
        FileSystem-->>Tool: Path Valid
        Tool->>FileSystem: Read/Write File
        FileSystem-->>Tool: Operation Complete
    end

    alt Terminal Commands
        Tool->>DevSupervisor: Check Availability
        DevSupervisor-->>Tool: Available
        Tool->>DevSupervisor: Execute Command
        DevSupervisor->>DevServer: Run Command
        DevServer-->>DevSupervisor: Output
        DevSupervisor-->>Tool: Command Result
    end

    alt Git Operations
        Tool->>FileSystem: Validate Repository
        Tool->>DevSupervisor: Execute Git Command
        DevSupervisor-->>Tool: Git Result
    end

    alt Server Management
        Tool->>AppRepo: Get Server Status
        Tool->>DevSupervisor: Restart Server
        DevSupervisor-->>Tool: Server Restarted
    end

    Tool-->>Agent: Tool Result
```

---

## Agent Purpose

### Primary Agent: Develop Agent (Website / Code Builder)

**Name**: AI Developer / Develop Agent  
**ID**: `develop`  
**Purpose**: Expert AI developer specializing in building modern web applications

**Capabilities**:

- **Requirements Analysis**: Understands user needs and translates them into technical specifications
- **Architecture Planning**: Designs scalable, maintainable application structures
- **Code Generation**: Writes clean, efficient, and well-documented code
- **Problem Solving**: Debugging issues and optimizing performance
- **Best Practices**: Follows modern development standards and patterns
- **User Experience**: Ensures applications are intuitive and accessible

**Technical Expertise**:

- Frontend Development: React, TypeScript, Tailwind CSS, shadcn UI, Vite
- Backend Development: Hono.js API routes, server actions, middleware
- Development Tools: pnpm, TypeScript compiler, Node.js environment

**Model Configuration**:

- Model: Full capability model (Claude Sonnet 4 or equivalent)
- Max Steps: 25
- Temperature: 0.3 (deterministic for code generation)
- Max Output Tokens: 8000

### Specialized Agents

#### 1. Database Agent

**Name**: Database Manager  
**ID**: `database`  
**Purpose**: MySQL database operations, schema design, and database integration

**Capabilities**:

- Database creation and configuration
- Schema design and migrations
- User and permission management
- Database integration with applications
- MySQL operation execution

**Model Configuration**:

- Model: Full capability model
- Max Steps: 20
- Temperature: 0.3
- Max Output Tokens: 2500

#### 2. Color Scheme Agent

**Name**: Color Scheme Designer  
**ID**: `color-scheme`  
**Purpose**: Color palette design and visual branding for applications

**Capabilities**:

- Color palette generation
- Theme customization
- Visual design consistency
- Brand identity development

#### 3. Example Agent

**Name**: Example Agent  
**ID**: `example`  
**Purpose**: Demonstration and testing of agent capabilities

### Future Agents (Planned)

- Product Manager Agent - Feature definition and requirements gathering
- Software Architect Agent - Technology stack selection and system design
- Security Analyst Agent - Vulnerability detection and automatic remediation
- Site Reliability Engineer Agent - Continuous monitoring and maintenance

---

## Agent Exposure

### Primary Communication Method: WebSocket

**Protocol**: Socket.IO over WebSocket  
**Port**: 4000 (Agents Service)  
**Connection Type**: Bidirectional real-time communication

#### WebSocket Endpoints

**Connection URL**: `ws://localhost:4000` (development) or `wss://agents.domain.com` (production)

**Key Events**:

**Client → Server:**

- `ai-stream` - Send message to agent for processing
- `refresh-token` - Refresh JWT token
- `get-history` - Request conversation history

**Server → Client:**

- `ai-chunk` - Streaming response chunks from agent
- `ai-complete` - Agent response complete
- `ai-error` - Error during processing
- `token-refresh-required` - Token expiration warning
- `token-refreshed` - Token refresh confirmation

**Connection Options**:

```typescript
{
  transports: ['websocket', 'polling'],
  auth: {
    token: 'JWT_TOKEN'  // Primary authentication method
  },
  extraHeaders: {
    Authorization: 'Bearer JWT_TOKEN'  // Fallback for polling transport
  }
}
```

### Secondary Communication: HTTPS REST API

**Base URL**: `http://localhost:4000` (development)

**Key Endpoints**:

#### Agent Management

- `GET /agents` - List all available agents
- `GET /agents/:agentId` - Get specific agent information

#### Application Management

- `POST /apps/create` - Create new application
- `GET /apps/:appId` - Get application details
- `PUT /apps/:appId` - Update application
- `DELETE /apps/:appId` - Delete application

#### Chat (Non-streaming)

- `POST /agent/:agentId/chat` - Send message to agent (synchronous)
- `POST /agent/:agentId/chat-streaming` - Send message with Server-Sent Events

#### Git Operations

- `POST /git/clone` - Clone repository
- `POST /git/commit` - Commit changes
- `GET /git/status` - Get git status

#### Health & Monitoring

- `GET /health` - Basic health check
- `GET /health/agents` - Detailed agent health status

**Authentication**: All endpoints require JWT Bearer token in Authorization header

---

## Authentication & Authorization

### Overview

The system uses a custom JWT-based authentication system with RSA-256 signing for secure communication between the UI and Agents Service. The app generates and signs JWT tokens using a private key, while agents validate tokens using the corresponding public key.

### Authentication Flow

#### 1. Token Generation

- **Provider**: Airo App (Next.js application)
- **Token Type**: JWT (JSON Web Token) with RSA-256 signing
- **Private Key**: RSA 2048-bit private key stored in `JWT_PRIVATE_KEY` environment variable
- **Token Lifetime**: 12 hours with 10-hour refresh cycle (2-hour buffer)
- **Token Storage**: In-memory cache on client side

#### 2. Token Validation

**Agent-Side Validation**:

- Public key stored in `JWT_PUBLIC_KEY` environment variable
- Direct JWT signature verification using Node.js crypto
- No external service dependencies
- Bypass mode available (empty `JWT_PUBLIC_KEY` for existing containers)

**Key Management**:

- RSA 2048-bit key pair generated using `scripts/generate-jwt-keys.js`
- Private key: App environment (`JWT_PRIVATE_KEY`)
- Public key: Agent environment (`JWT_PUBLIC_KEY`)
- PEM format with proper newline handling (`\n` to actual newlines)

#### 3. JWT Claims Structure

**Standard JWT Claims**:

```typescript
{
  iss: 'airo-app',        // Issuer (hardcoded)
  aud: 'agents-service',  // Audience (hardcoded)
  exp: number,            // Expiration timestamp
  iat: number,            // Issued at timestamp
}
```

**Custom Claims**:

```typescript
{
  siteId: string,         // Site/app identifier (only custom claim)
}
```

**Complete JWT Payload**:

```typescript
{
  iss: 'airo-app',
  aud: 'agents-service',
  exp: number,
  iat: number,
  siteId: string
}
```

### WebSocket Authentication

**Handshake Authentication**:

```typescript
// Client sends JWT in Socket.IO auth object and headers
{
  auth: {
    token: 'JWT_TOKEN'  // Primary method for WebSocket transport
  },
  extraHeaders: {
    Authorization: 'Bearer JWT_TOKEN'  // Fallback for polling transport
  }
}
```

**Middleware Validation**:

1. Extract JWT token from `socket.handshake.auth.token` or `Authorization` header
2. Validate JWT signature using RSA public key from environment
3. Extract `siteId` from JWT payload
4. Store validated context in socket session
5. Approve or reject connection based on validation result

**Token Refresh Mechanism**:

- Server detects token expiration (configurable threshold)
- Emits `token-refresh-required` event
- Client provides new token via `refresh-token` event
- Server validates new token with public key
- Connection continues with fresh token

### HTTPS Authentication

**Request Authentication**:

```typescript
// Client sends JWT in Authorization header via agentFetch
{
  headers: {
    'Authorization': 'Bearer JWT_TOKEN',
    'Content-Type': 'application/json'
  }
}
```

**Middleware Validation**:

1. Extract token from Authorization header
2. Validate JWT signature using RSA public key
3. Extract `siteId` from JWT payload
4. Attach site context to request
5. Process request or return 401 Unauthorized

### Authorization Levels

**Agent Access**:

- All authenticated requests can access agents
- Access restricted to specific `siteId` from JWT token
- Site context enforced at tool execution level

**Tool Authorization**:

- Tools validate app ownership via `siteId` from JWT
- File operations restricted to app directory
- Terminal commands sandboxed to app environment
- Database operations require valid credentials

### JWT Validation Service

**Configuration**:

```typescript
{
  issuer: 'airo-app',                  // Expected token issuer
  audience: 'agents-service',          // Expected token audience
  algorithm: 'RS256',                  // RSA-256 signing algorithm
  keyId: 'key-1',                      // Key identifier
  expiresIn: '12h',                    // Token lifetime
  publicKey: process.env.JWT_PUBLIC_KEY, // RSA public key from environment
  security: {
    maxTokenSize: 10000                // 10KB token limit
  }
}
```

**Environment Variables**:

```bash
# App side (token generation)
JWT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n..."
JWT_PUBLIC_KEY="-----BEGIN PUBLIC KEY-----\n..."

# Agent side (token validation)
JWT_PUBLIC_KEY="-----BEGIN PUBLIC KEY-----\n..."
```

**Documentation Reference**: See [UI to Agents Authentication Architecture](./docs/ui-agents-authentication-architecture.md)

---

## MCP Server Usage

### Current Implementation

**MCP Servers Used**: None

The Airo AI Builder agent system **does not currently use MCP (Model Context Protocol) servers**. Instead, it implements a **custom tool system** built directly into the agents service.

### Rationale for Custom Tools

1. **Direct Integration**: Tools are tightly integrated with the application lifecycle
2. **Security**: Direct control over file system and execution environment
3. **Performance**: No network overhead for tool execution
4. **Simplicity**: Reduced architectural complexity
5. **Flexibility**: Custom tools designed specifically for web development workflow

### Future MCP Integration

While not currently implemented, the architecture could support MCP servers through the existing tool interface:

**Potential MCP Integration Pattern**:

```typescript
// Future MCP tool wrapper
async function mcpToolAdapter(mcpServerUrl: string, toolName: string) {
  const mcpClient = createMCPClient(mcpServerUrl);
  return {
    name: toolName,
    execute: async (args) => {
      return await mcpClient.callTool(toolName, args);
    },
  };
}
```

**Use Cases for Future MCP Integration**:

- External service integrations (payment processors, email services)
- Third-party API wrappers
- Specialized analysis tools
- Multi-tenant tool sharing

---

## Available Tools

### Core Development Tools (File Operations)

#### 1. fileEdit

**Purpose**: Create, edit, or rewrite files with intelligent mode detection

**Capabilities**:

- Create new files
- Edit existing files with search/replace
- Rewrite entire files
- Automatic indentation preservation
- Safe path validation (app directory only)
- Blocked file protection (node_modules, etc.)

**Parameters**:

```typescript
{
  path: string,              // File path relative to app
  mode: 'create' | 'edit' | 'rewrite',
  content?: string,          // For create/rewrite
  searchContent?: string,    // For edit mode
  replaceContent?: string,   // For edit mode
  createIfNotExists?: boolean
}
```

**Authorization**: Requires valid app context, file path must be within app directory

#### 2. readFile

**Purpose**: Read file contents with optional line range support

**Capabilities**:

- Read entire files
- Read specific line ranges
- Get file metadata (size, line count)
- Blocked file detection
- Path security validation

**Parameters**:

```typescript
{
  path: string,              // File path relative to app
  startLine?: number,        // Optional: start line
  numLines?: number          // Optional: number of lines
}
```

**Authorization**: Same as fileEdit

#### 3. grepSearch

**Purpose**: Search for text/patterns across files in the project

**Capabilities**:

- Regex pattern matching
- File type filtering
- Directory exclusions
- Context lines (before/after)
- Case-sensitive/insensitive search

**Parameters**:

```typescript
{
  pattern: string,           // Search pattern (regex supported)
  directory?: string,        // Directory to search (default: app root)
  fileTypes?: string[],      // File extensions to include
  excludeDirs?: string[],    // Directories to exclude
  caseSensitive?: boolean,   // Case sensitivity
  contextLines?: number      // Context lines around matches
}
```

#### 4. directoryListing

**Purpose**: List directory contents as a tree structure with filtering

**Capabilities**:

- Recursive directory traversal
- File type filtering
- Exclude patterns (node_modules, etc.)
- Tree structure visualization
- File metadata (size, type)

**Parameters**:

```typescript
{
  directory?: string,        // Directory to list (default: app root)
  maxDepth?: number,         // Max recursion depth
  excludePatterns?: string[], // Patterns to exclude
  includeHidden?: boolean    // Include hidden files
}
```

### System & Server Tools

#### 5. terminalCommand

**Purpose**: Execute shell commands (npm install, git operations, building, testing, etc.)

**Capabilities**:

- Run shell commands in app directory
- Custom working directory support
- Environment variable injection
- Timeout protection
- Command override system
- Dev-supervisor integration

**Parameters**:

```typescript
{
  command: string,           // Shell command to execute
  workingDir?: string,       // Working directory (relative to app)
  timeout?: number,          // Timeout in milliseconds
  env?: Record<string, string>, // Environment variables
  commandOverrides?: Array<{  // Command transformations
    pattern: string,
    replacement: string
  }>
}
```

**Security**:

- Requires dev-supervisor availability
- Sandboxed to app directory
- Command validation and sanitization
- Blocked commands (rm -rf /, etc.)

**Authorization**: Requires app context and dev-supervisor access

#### 6. gitOperation

**Purpose**: Full git functionality (status, add, commit, diff, log, branch management)

**Capabilities**:

- Git status and diff
- Stage and commit changes
- Branch management (create, switch, delete)
- View commit history
- Tag management
- Remote operations (push, pull, fetch)

**Parameters**:

```typescript
{
  operation: 'status' | 'add' | 'commit' | 'push' | 'pull' | 'branch' | 'diff' | 'log',
  files?: string[],          // Files to operate on
  message?: string,          // Commit message
  branch?: string,           // Branch name
  options?: {
    all?: boolean,           // Stage all changes
    amend?: boolean,         // Amend last commit
    force?: boolean          // Force operation
  }
}
```

**Authorization**: Requires app context, validates git repository

#### 7. serverRestart

**Purpose**: Restart the development server

**Capabilities**:

- Graceful server restart
- Port management
- Process cleanup
- Health check after restart

**Parameters**:

```typescript
{
  appId: string; // Application identifier
}
```

#### 8. serverStatus

**Purpose**: Check if the development server is running

**Capabilities**:

- Process status check
- Port availability check
- Health endpoint verification
- Response time measurement

**Parameters**:

```typescript
{
  appId: string; // Application identifier
}
```

#### 9. viewLogs

**Purpose**: Read development server logs for debugging

**Capabilities**:

- Real-time log streaming
- Log filtering by level
- Time range filtering
- Log format parsing

**Parameters**:

```typescript
{
  appId: string,             // Application identifier
  lines?: number,            // Number of lines to retrieve
  level?: 'error' | 'warn' | 'info' | 'debug',
  since?: string             // Time filter (ISO 8601)
}
```

### Database & API Tools

#### 10. autoAPIGenerator

**Purpose**: Generate Hono.js API endpoints from database schemas

**Capabilities**:

- Analyze database schema
- Generate TypeScript types
- Create REST API endpoints
- Generate CRUD operations
- Input validation
- Error handling

**Parameters**:

```typescript
{
  schemaPath?: string,       // Path to schema definition
  outputPath?: string,       // Output directory for generated code
  tableName?: string,        // Specific table to generate
  operations?: ['create', 'read', 'update', 'delete']
}
```

**Generates**:

- `types.ts` - TypeScript interfaces
- `routes.ts` - Hono.js route handlers
- `validation.ts` - Zod validation schemas
- `repository.ts` - Database access layer

#### 11. mysqlOperation

**Purpose**: MySQL database operations and management

**Capabilities**:

- Database creation and deletion
- Schema management
- User management
- Execute SQL queries
- Table introspection
- Data migration

**Parameters**:

```typescript
{
  operation: 'create' | 'execute' | 'introspect' | 'createUser',
  database?: string,         // Database name
  query?: string,            // SQL query to execute
  user?: string,             // Database user
  password?: string,         // User password
  host?: string,             // MySQL host
  port?: number              // MySQL port
}
```

**Security**:

- Credentials from environment variables
- Query sanitization
- Connection pooling
- Timeout protection

### Media & Content Tools

#### 12. imageSearch

**Purpose**: Search for images on the web based on text prompts

**Capabilities**:

- Multiple image providers (Getty, Unsplash, OpenAI)
- Keyword-based search
- Size and orientation filtering
- License filtering
- Result ranking

**Providers**:

- **Getty Images** (default): Professional stock photos
- **Unsplash**: Free stock photos
- **OpenAI**: AI-generated web search

**Parameters**:

```typescript
{
  prompt: string,            // Search query
  provider?: 'getty' | 'unsplash' | 'openai',
  maxResults?: number,       // Max number of results
  size?: 'small' | 'medium' | 'large',
  orientation?: 'landscape' | 'portrait' | 'square'
}
```

**Configuration**:

```bash
IMAGE_SEARCH_DRIVER=getty
GETTY_API_URL=...
SSO_JWT=...
UNSPLASH_ACCESS_KEY=...
```

#### 13. imageGenerate

**Purpose**: Generate AI images and save them to your app's public directory

**Capabilities**:

- Text-to-image generation
- Multiple styles and sizes
- Automatic file management
- Public directory integration
- URL generation for use in code

**Parameters**:

```typescript
{
  prompt: string,            // Image description
  style?: 'realistic' | 'artistic' | 'sketch',
  size?: '1024x1024' | '1024x1536' | '1536x1024' | 'auto',
  filename?: string,         // Output filename
  outputPath?: string        // Custom output path
}
```

**Output**:

```typescript
{
  success: boolean,
  path: string,              // File path in app
  url: string,               // Public URL to use in code
  width: number,
  height: number
}
```

### Specialized Tools

#### 14. handoff

**Purpose**: Hand off specialized tasks to other agents

**Capabilities**:

- Agent discovery
- Task delegation
- Context transfer
- Result integration

**Available Handoffs**:

- `database` - Database operations and schema design
- `color-scheme` - Color palette and visual design

**Parameters**:

```typescript
{
  targetAgent: 'database' | 'color-scheme',
  task: string,              // Task description
  context?: Record<string, any>, // Additional context
  returnTo?: boolean         // Return to current agent after completion
}
```

#### 15. handoffHistory

**Purpose**: View handoff history between agents

**Capabilities**:

- Track agent transitions
- View task outcomes
- Debug multi-agent workflows

**Parameters**:

```typescript
{
  conversationId?: string,   // Filter by conversation
  limit?: number             // Max records to return
}
```

### Tool Statistics

**Total Tools**: 15  
**Core Tools**: 4 (fileEdit, readFile, grepSearch, directoryListing)  
**System Tools**: 5 (terminalCommand, gitOperation, serverRestart, serverStatus, viewLogs)  
**Backend Tools**: 2 (mysqlOperation, autoAPIGenerator)  
**Media Tools**: 2 (imageSearch, imageGenerate)  
**Planning Tools**: 2 (handoff, handoffHistory)

---

## Tool Authentication & Authorization

### Tool-Level Security Model

Tools inherit the authentication context from the agent request and implement additional authorization checks.

#### Authentication Flow for Tools

```mermaid
sequenceDiagram
    participant Agent
    participant Tool
    participant AppRepo as App Repository
    participant Auth as Auth Context
    participant Resource as Protected Resource

    Agent->>Tool: Execute Tool
    Note over Tool: Request includes customer context

    Tool->>Auth: Validate Customer Context
    Auth-->>Tool: Context Valid

    Tool->>AppRepo: Get App Details
    AppRepo-->>Tool: App Metadata

    Tool->>Tool: Verify Ownership
    Note over Tool: customerId matches app owner

    alt Authorized
        Tool->>Resource: Perform Operation
        Resource-->>Tool: Result
        Tool-->>Agent: Success + Result
    else Unauthorized
        Tool-->>Agent: Error: Access Denied
    end
```

### Authorization Mechanisms by Tool Category

#### File Operations (fileEdit, readFile, grepSearch, directoryListing)

**Authorization Checks**:

1. **App Context Validation**: Tool execution requires valid `appId` in context
2. **Path Security**: All file paths must be within app directory
   ```typescript
   if (!fullPath.startsWith(resolve(appPath))) {
     throw new Error("Access denied: path is outside app directory");
   }
   ```
3. **Blocked File Protection**: System files are blocked
   ```typescript
   const blocked = [
     "node_modules/**",
     ".git/objects/**",
     "dist/**",
     "build/**",
     ".env",
     ".env.*",
   ];
   ```
4. **Customer Context**: Implicitly validated via app ownership

**Security Features**:

- Path traversal prevention
- Symlink resolution and validation
- Read-only mode for sensitive files
- Size limits for read operations

#### System Commands (terminalCommand, gitOperation)

**Authorization Checks**:

1. **Dev-Supervisor Requirement**: Commands require dev-supervisor availability
   ```typescript
   if (!this.isDevSupervisorAvailable()) {
     throw new Error("Terminal tool requires dev-supervisor");
   }
   ```
2. **Command Validation**: Dangerous commands are blocked
   ```typescript
   const blockedCommands = ["rm -rf /", "sudo", "chmod 777", "dd if=/dev/zero"];
   ```
3. **Working Directory Restriction**: Commands execute within app directory
4. **Environment Isolation**: Commands run in sandboxed environment

**Security Features**:

- Command whitelist/blacklist
- Timeout protection
- Resource limits (CPU, memory)
- Output size limits
- No sudo/root access

#### Database Operations (mysqlOperation)

**Authorization Checks**:

1. **Credential Validation**: MySQL credentials from environment
   ```typescript
   const config = {
     host: process.env.MYSQL_ROOT_HOST || "localhost",
     user: process.env.MYSQL_ROOT_USER || "root",
     password: process.env.MYSQL_ROOT_PASS,
   };
   ```
2. **Database Scope**: Operations limited to app-specific databases
3. **Query Sanitization**: SQL injection prevention
4. **Operation Validation**: Only safe operations allowed

**Security Features**:

- Parameterized queries
- Connection pooling
- Query timeout limits
- No direct root access
- Database name prefixing (customer isolation)

#### Image Tools (imageSearch, imageGenerate)

**Authorization Checks**:

1. **API Key Validation**: External service credentials required
2. **Rate Limiting**: Per-customer rate limits
3. **Output Path Validation**: Images saved only to app public directory
4. **Content Policy**: Adult content filtering

**Security Features**:

- Content moderation
- File size limits
- Format validation
- Quota management

#### Handoff Tools (handoff, handoffHistory)

**Authorization Checks**:

1. **Agent Availability**: Target agent must be registered
2. **Conversation Context**: Handoff tracked in conversation history
3. **Customer Context Propagation**: Customer context passed to target agent

**Security Features**:

- Context sanitization
- Result validation
- Handoff audit trail

### Environment-Specific Authorization

#### Development Environment

- **Relaxed File Access**: Broader file access for debugging
- **Command Execution**: Direct command execution allowed
- **Mock Auth**: Development authentication bypass available

#### Production Environment

- **Strict Path Validation**: Enforced app directory boundaries
- **Dev-Supervisor Required**: All commands through dev-supervisor
- **Full JWT Validation**: Complete SSO validation
- **Audit Logging**: All tool operations logged

### Tool Authorization Configuration

**Environment Variables**:

```bash
# Tool Authorization
ENABLE_TOOL_AUTH=true           # Enable tool-level authorization
STRICT_PATH_VALIDATION=true     # Enforce strict path validation
ALLOW_SUDO=false                # Block sudo commands
MAX_COMMAND_TIMEOUT=30000       # Command timeout (ms)

# File Access
BLOCKED_PATHS=node_modules,.git,dist
MAX_FILE_SIZE=10485760          # 10MB max file size
ALLOW_SYMLINKS=false            # Block symlink operations

# Database Access
MYSQL_ROOT_HOST=localhost
MYSQL_ROOT_USER=root
MYSQL_ROOT_PASS=secret
DB_CONNECTION_TIMEOUT=10000     # Connection timeout (ms)

# Image Services
IMAGE_SEARCH_DRIVER=getty
GETTY_API_URL=...
UNSPLASH_ACCESS_KEY=...
```

---

## Service Utilization

### Services That Utilize the Agents

#### 1. Next.js Frontend Application (Primary Consumer)

**Service**: Main UI Application  
**Port**: 3000  
**Purpose**: Primary user interface for application building

**Usage Patterns**:

**Development Mode**:

```typescript
// WebSocket connection for real-time development
const socket = io("http://localhost:4000", {
  extraHeaders: {
    Authorization: `Bearer ${jwtToken}`,
  },
  query: { agentId: "develop", appId: appId },
});

socket.on("ai-chunk", (data) => {
  // Handle streaming response
});

socket.emit("ai-stream", {
  message: userMessage,
  context: { appId, visualContext, files },
});
```

**API Calls**:

```typescript
// App creation
await agentFetch("/apps/create", {
  method: "POST",
  body: JSON.stringify({ name, initialPrompt, templateVersion }),
});

// Get app list
const apps = await agentFetch("/apps");

// Chat (non-streaming)
await agentFetch(`/agent/develop/chat`, {
  method: "POST",
  body: JSON.stringify({ message, context }),
});
```

**Features**:

- Chat interface for agent interaction
- Visual context extraction (element selection)
- Live preview iframe
- Code editor integration (Monaco)
- Conversation history
- File browser
- Git integration UI

#### 2. Deployment Adapters (Secondary Consumers)

**Service**: Site Deployment System  
**Purpose**: Create and manage user applications

**Adapters**:

- **LocalDeploymentAdapter**: Direct agent service calls
- **DockerDeploymentAdapter**: Containerized app management
- **ProductionDeploymentAdapter**: Nomad + SQS integration

**Usage**:

```typescript
// Create new application
await agentService.createApp({
  name: 'my-app',
  templateVersion: 'v8',
  initialPrompt: 'Create a blog'
});

// Deploy application
await deploymentAdapter.deploy({
  siteId: '123',
  template: 'v8',
  config: { ... }
});
```

#### 3. External Services Integration

**Getty Images API**:

- Image search via agents
- Professional stock photos
- JWT-based authentication

**GoDaddy SSO**:

- User authentication
- JWT token validation
- Customer context

**MySQL Database**:

- Production data storage
- User accounts and sites
- Billing integration

**AWS Services (Production)**:

- **SQS**: Job queue for deployments
- **Nomad**: Container orchestration
- **Ceph**: Distributed file storage

### Service Dependencies

```mermaid
graph TB
    NextJS[Next.js UI :3000] -->|WebSocket/HTTPS| Agents[Agents Service :4000]

    Agents --> SQLite[(SQLite DB)]
    Agents --> Templates[App Templates]
    Agents --> DevSupervisor[Dev Supervisor]

    NextJS --> SSO[GoDaddy SSO]
    Agents --> SSO

    Agents --> Getty[Getty Images API]
    Agents --> OpenAI[OpenAI API]

    subgraph "Production Only"
        Agents --> MySQL[(MySQL)]
        Agents --> SQS[AWS SQS]
        SQS --> Nomad[Nomad Scheduler]
        Nomad --> Ceph[Ceph Storage]
    end

    subgraph "Development"
        Agents --> LocalFS[Local File System]
    end

    style Agents fill:#e8f5e8
    style NextJS fill:#e3f2fd
```

### Usage Statistics & Monitoring

**Token Usage Tracking**:

- All AI interactions logged to `token_usage` table
- Per-app, per-agent, per-model tracking
- Cost calculation (input/output tokens)
- Optional UI display via `SHOW_USAGE_COST` env var

**Health Monitoring**:

- Agent registry health checks
- WebSocket connection status
- Database connectivity
- External service availability

**Logging**:

- Structured JSON logging
- Elastic APM integration (optional)
- Request tracing with correlation IDs
- Error tracking and alerting

---

## Network Environment

### Development Environment

**Architecture**: Local processes or Docker containers

**Network Configuration**:

```
┌─────────────────────────────────────┐
│         Developer Machine           │
│                                     │
│  ┌──────────┐      ┌──────────┐   │
│  │  UI App  │◄────►│ Agents   │   │
│  │  :3000   │  WS  │  :4000   │   │
│  └──────────┘      └──────────┘   │
│                          │          │
│                    ┌─────▼─────┐   │
│                    │  SQLite   │   │
│                    │   (local) │   │
│                    └───────────┘   │
│                                     │
│  ┌──────────────────────────────┐  │
│  │  User Apps (Generated)       │  │
│  │  :3001, :3002, :3003...      │  │
│  └──────────────────────────────┘  │
└─────────────────────────────────────┘
         │
         ▼
  GoDaddy SSO (external)
  Getty Images API (external)
```

**Port Allocation**:

- `3000` - Next.js UI application
- `4000` - Agents service
- `3001+` - Dynamically allocated for user apps
- `8888` - Proxy service (Docker mode)

**Network Restrictions**:

- Localhost-only by default
- CORS enabled for local development
- No SSL/TLS (HTTP only)

### Docker Environment

**Architecture**: Docker Compose with internal network

**Network Configuration**:

```
┌─────────────────────────────────────────────┐
│         Docker Network (airo-network)       │
│                                             │
│  ┌──────────┐      ┌──────────┐           │
│  │ airo-app │◄────►│airo-agents│           │
│  │  :8443   │ WS   │   :4000   │           │
│  └──────────┘      └──────────┘           │
│                          │                  │
│  ┌──────────┐      ┌─────▼──────┐         │
│  │airo-proxy│      │  SQLite    │         │
│  │  :8888   │      │  (volume)  │         │
│  └──────────┘      └────────────┘         │
│                                             │
│  ┌──────────────────────────────────────┐  │
│  │       airo-app-mysql :3306           │  │
│  └──────────────────────────────────────┘  │
└─────────────────────────────────────────────┘
         │
         ▼
  External Services
  (SSO, Getty, OpenAI)
```

**Docker Compose Services**:

```yaml
services:
  agents:
    ports: ["4000:4000"]
    networks: [airo-network]

  app:
    ports: ["8443:8443"]
    networks: [airo-network]

  proxy:
    ports: ["8888:8888"]
    networks: [airo-network]

  app-mysql:
    ports: ["3306:3306"]
    networks: [airo-network]

networks:
  airo-network:
    driver: bridge
```

**Network Features**:

- Internal DNS resolution (service names)
- Shared Docker socket for container management
- Volume sharing for database and storage
- SSL/TLS via proxy service

### Production Environment

**Architecture**: Enterprise-grade cloud infrastructure

**Network Configuration**:

```
                    Internet
                        │
                        ▼
              ┌──────────────────┐
              │  Load Balancer   │
              │   (Edge CDN)     │
              └────────┬─────────┘
                       │
        ┌──────────────┴──────────────┐
        │                             │
        ▼                             ▼
  ┌──────────┐                 ┌──────────┐
  │ UI App   │◄───WebSocket───►│ Agents   │
  │ (Next.js)│                 │ Service  │
  └────┬─────┘                 └────┬─────┘
       │                            │
       ▼                            ▼
  ┌─────────────┐          ┌────────────────┐
  │   MySQL     │          │   SQLite       │
  │ (RDS/Cloud) │          │   (Nomad)      │
  └─────────────┘          └────────────────┘
                                   │
                      ┌────────────┴────────────┐
                      │                         │
                      ▼                         ▼
              ┌──────────────┐          ┌──────────┐
              │  AWS SQS     │          │  Ceph    │
              │  (Jobs)      │          │ Storage  │
              └──────┬───────┘          └──────────┘
                     │
                     ▼
              ┌──────────────┐
              │    Nomad     │
              │  Scheduler   │
              └──────────────┘
```

**Production Features**:

- **High Availability**: Multi-region deployment
- **Auto-scaling**: Dynamic resource allocation
- **SSL/TLS**: Full encryption in transit
- **Private Networking**: VPC isolation
- **Monitoring**: CloudWatch, APM, logging
- **Security**: WAF, DDoS protection, rate limiting

**Network Isolation**:

- Public subnet: Load balancers, edge nodes
- Private subnet: Application servers, databases
- Service mesh: Internal service communication
- Bastion hosts: Secure administrative access

### Network Security

**Firewall Rules**:

```yaml
Development:
  - Allow: localhost:3000 → localhost:4000 (WebSocket/HTTPS)
  - Allow: localhost:4000 → external SSO (JWT validation)
  - Allow: localhost:4000 → external APIs (images, AI)

Docker:
  - Allow: airo-app:8443 → airo-agents:4000
  - Allow: airo-agents:4000 → airo-proxy:8888
  - Allow: airo-agents:4000 → airo-app-mysql:3306
  - Block: External access to internal services

Production:
  - Allow: CDN → UI/Agents (443)
  - Allow: UI → Agents (private network)
  - Allow: Agents → MySQL (private network)
  - Allow: Agents → SQS/Nomad/Ceph (private network)
  - Block: Direct internet access to backend services
```

**TLS/SSL Configuration**:

- Development: HTTP only (localhost)
- Docker: Self-signed certificates via proxy
- Production: Valid SSL certificates (Let's Encrypt/AWS ACM)

---

## Tool Ownership

### In-House Developed Tools

**All tools are developed in-house** as part of the Airo AI Builder platform. There are no third-party MCP servers or external tool providers in use.

#### Core Development Tools (100% In-House)

- ✅ **fileEdit** - Custom file manipulation tool
- ✅ **readFile** - Custom file reading tool
- ✅ **grepSearch** - Custom pattern search implementation
- ✅ **directoryListing** - Custom directory traversal

**Location**: `agents/src/tools/`

#### System & Server Tools (100% In-House)

- ✅ **terminalCommand** - Custom command execution with dev-supervisor integration
- ✅ **gitOperation** - Git wrapper with safety checks
- ✅ **serverRestart** - Custom server lifecycle management
- ✅ **serverStatus** - Custom health check implementation
- ✅ **viewLogs** - Custom log aggregation and parsing

**Location**: `agents/src/tools/`

#### Database & API Tools (100% In-House)

- ✅ **autoAPIGenerator** - Custom Hono.js code generator
- ✅ **mysqlOperation** - Custom MySQL management wrapper

**Location**: `agents/src/tools/`

#### Image Tools (In-House with External APIs)

- ✅ **imageSearch** - In-house tool with driver architecture
  - Driver implementation: In-house
  - External APIs: Getty Images, Unsplash, OpenAI
- ✅ **imageGenerate** - In-house AI image generation wrapper
  - Wrapper: In-house
  - AI service: OpenAI DALL-E or equivalent

**Location**: `agents/src/tools/`

#### Agent Collaboration Tools (100% In-House)

- ✅ **handoff** - Custom multi-agent coordination
- ✅ **handoffHistory** - Custom handoff tracking

**Location**: `agents/src/agents/ai-lib-agents/`

### Tool Architecture Ownership

```mermaid
graph TB
    subgraph "In-House Developed"
        Tools[Tool Suite]
        FileOps[File Operations]
        SystemOps[System Operations]
        DBOps[Database Operations]
        ImageTools[Image Tools]
        AgentTools[Agent Tools]

        Tools --> FileOps
        Tools --> SystemOps
        Tools --> DBOps
        Tools --> ImageTools
        Tools --> AgentTools
    end

    subgraph "External APIs (Integrated)"
        Getty[Getty Images API]
        Unsplash[Unsplash API]
        OpenAI[OpenAI API]
        SSO[GoDaddy SSO]
    end

    ImageTools -.Uses.-> Getty
    ImageTools -.Uses.-> Unsplash
    ImageTools -.Uses.-> OpenAI
    Tools -.Auth via.-> SSO

    style Tools fill:#4caf50
    style FileOps fill:#4caf50
    style SystemOps fill:#4caf50
    style DBOps fill:#4caf50
    style ImageTools fill:#4caf50
    style AgentTools fill:#4caf50

    style Getty fill:#e0e0e0
    style Unsplash fill:#e0e0e0
    style OpenAI fill:#e0e0e0
    style SSO fill:#e0e0e0
```

### Maintenance & Development

**Code Ownership**:

- All tool code in: `/agents/src/tools/`
- AI-Lib tool wrappers: `/agents/src/tools/ai-lib-tools/`
- Tool tests: `/agents/src/tools/__tests__/`
- Tool documentation: Inline JSDoc comments

**Development Process**:

1. Design tool interface in TypeScript
2. Implement tool logic with security checks
3. Add comprehensive error handling
4. Write unit and integration tests
5. Document parameters and usage
6. Register in tool registry

**Testing**:

```bash
cd agents
pnpm test                    # All tests
pnpm test tools              # Tool-specific tests
pnpm test tools/fileEdit     # Single tool test
```

**Tool Registry**:

```typescript
// agents/src/tools/ai-lib-tools/index.ts
export const allAILibTools = {
  fileEdit: fileEditAITool,
  readFile: readFileAITool,
  grepSearch: grepSearchAITool,
  // ... all other tools
};
```

### External Dependencies

While all tools are in-house, some integrate with external services:

**Image Services**:

- Getty Images: Requires `SSO_JWT` and `GETTY_API_URL`
- Unsplash: Requires `UNSPLASH_ACCESS_KEY`
- OpenAI: Requires `OPENAI_API_KEY`

**Authentication**:

- GoDaddy SSO: JWT validation via public keys

**Infrastructure**:

- AWS SQS: Job queue (production only)
- Nomad: Container orchestration (production only)
- Ceph: Distributed storage (production only)

---

## Service Deployment Model

### Customer Usage vs Internal Services

**Agents + Tools: Intended for Customer Usage**

The agents service and all tools are **deployed for customer usage**, not as internal-only services. Each customer interaction with the platform directly utilizes the agent system.

### Deployment Model

#### Shared Service Architecture

```mermaid
graph TB
    subgraph "Customer Environment"
        User1[Customer 1]
        User2[Customer 2]
        User3[Customer N]
    end

    subgraph "Shared Agents Service (Multi-Tenant)"
        AgentService[Agents Service :4000]
        AgentRegistry[Agent Registry]
        Tools[Tool Suite]

        AgentService --> AgentRegistry
        AgentService --> Tools
    end

    subgraph "Customer-Specific Resources"
        App1[Customer 1 App]
        App2[Customer 2 App]
        App3[Customer N App]

        Files1[Customer 1 Files]
        Files2[Customer 2 Files]
        Files3[Customer N Files]
    end

    User1 -->|JWT Auth| AgentService
    User2 -->|JWT Auth| AgentService
    User3 -->|JWT Auth| AgentService

    AgentService -->|Isolated Context| App1
    AgentService -->|Isolated Context| App2
    AgentService -->|Isolated Context| App3

    Tools -->|Sandboxed Access| Files1
    Tools -->|Sandboxed Access| Files2
    Tools -->|Sandboxed Access| Files3

    style AgentService fill:#4caf50
    style Tools fill:#ff9800
```

### Multi-Tenant Isolation

**Customer Isolation Strategy**:

1. **Authentication Layer**:
   - Each request authenticated via custom JWT
   - Site context extracted from token
   - `siteId` validated against JWT signature

2. **App-Level Isolation**:
   - Each app has unique `siteId` (equivalent to `appId`)
   - Database records tied to `siteId`
   - File system operations sandboxed to app directory

   ```typescript
   const appPath = `/apps/${siteId}/`;
   // All file operations restricted to this path
   ```

3. **Resource Isolation**:
   - **File System**: Each app in separate directory
   - **Processes**: Separate dev server per app
   - **Database**: App-specific databases or schemas
   - **Network**: Port isolation per app

4. **Conversation Isolation**:
   - Conversations tied to `conversationId`
   - Site context stored in conversation metadata
   - History filtered by `siteId`

### Scaling Strategy

**Horizontal Scaling**:

```mermaid
graph TB
    LB[Load Balancer]

    subgraph "Agents Service Cluster"
        Agent1[Agents Instance 1]
        Agent2[Agents Instance 2]
        Agent3[Agents Instance N]
    end

    LB --> Agent1
    LB --> Agent2
    LB --> Agent3

    Agent1 --> SharedDB[(Shared DB)]
    Agent2 --> SharedDB
    Agent3 --> SharedDB

    Agent1 --> Ceph[Ceph Storage]
    Agent2 --> Ceph
    Agent3 --> Ceph
```

**Scaling Characteristics**:

- **Stateless Agents**: Instances can be added/removed freely
- **Conversation Persistence**: Stored in database, not in-memory
- **WebSocket Stickiness**: Load balancer maintains session affinity
- **Shared Storage**: All instances access same Ceph storage

### Resource Allocation

**Per-Customer Limits**:

```typescript
{
  maxApps: 10,                    // Max apps per customer
  maxFileSize: 10 * 1024 * 1024,  // 10MB per file
  maxConversations: 100,          // Max concurrent conversations
  maxTokensPerMonth: 1000000,     // Token usage limit
  maxCommandTimeout: 30000,       // 30s command timeout
  maxImageGenerations: 50         // Images per month
}
```

**System Limits**:

```typescript
{
  maxConcurrentAgents: 1000,      // Max parallel agent executions
  maxWebSocketConnections: 5000,  // Max WS connections
  maxRequestsPerSecond: 100,      // Rate limiting
  maxDatabaseConnections: 500     // DB connection pool
}
```

### Deployment Environments

#### Development

- **Type**: Shared development instance
- **Users**: Internal developers
- **Isolation**: Minimal (trusted environment)
- **Resources**: Local machine or shared dev server

#### Staging/Testing

- **Type**: Production-like environment
- **Users**: QA team, internal testing
- **Isolation**: Full multi-tenant isolation
- **Resources**: Cloud-hosted (AWS/GCP)

#### Production

- **Type**: Highly available, multi-region
- **Users**: All customers
- **Isolation**: Complete customer isolation
- **Resources**: Auto-scaling cluster with:
  - Multiple availability zones
  - Geographic distribution
  - Disaster recovery
  - 99.9% uptime SLA

### Cost Model

**Customer-Facing Costs**:

- Token usage (per 1K tokens)
- Image generation (per image)
- Storage (per GB)
- Compute time (per minute)

**Internal Costs**:

- Agent service infrastructure
- Database hosting
- Storage (Ceph/S3)
- Network transfer
- External API costs (OpenAI, Getty, etc.)

### Monitoring & Observability

**Customer-Level Metrics**:

```typescript
{
  tokensUsed: number,
  imagesGenerated: number,
  commandsExecuted: number,
  filesModified: number,
  conversationCount: number,
  activeAgents: string[]
}
```

**System-Level Metrics**:

```typescript
{
  totalCustomers: number,
  activeConnections: number,
  requestsPerSecond: number,
  avgResponseTime: number,
  errorRate: number,
  resourceUtilization: {
    cpu: number,
    memory: number,
    disk: number
  }
}
```

**Logging**:

- Structured JSON logs with customer context
- Request tracing with correlation IDs
- Error tracking and alerting
- Audit trail for compliance

---

## Summary

### Key Points

1. **Agent Purpose**: Primary agent is the Develop Agent (AI Developer) for building web applications, with specialized agents for database operations and color design.

2. **Exposure**: Agents are exposed via **WebSocket** (Socket.IO) for real-time bidirectional communication, with REST API as secondary interface.

3. **Authentication**: JWT-based authentication with GoDaddy SSO integration, token validation on every request, automatic refresh mechanism.

4. **MCP Usage**: **No MCP servers** are currently used; all tools are custom-developed and integrated directly.

5. **Tools**: 15 comprehensive tools covering file operations, system commands, database management, API generation, and image handling.

6. **Tool Authorization**: Tools inherit authentication context and implement additional checks for app ownership, path validation, and command safety.

7. **Service Utilization**: Primary consumer is Next.js UI application; secondary consumers include deployment adapters and external service integrations.

8. **Network Environment**:
   - **Development**: Localhost with minimal isolation
   - **Docker**: Containerized with internal network
   - **Production**: Enterprise cloud with full multi-tenant isolation

9. **Tool Ownership**: **100% in-house developed**, no third-party MCP servers or external tool providers.

10. **Deployment Model**: **Shared multi-tenant service** intended for customer usage with robust isolation and resource management.

---

## References

- [Architecture Documentation](./ARCHITECTURE_DOCUMENTATION.md)
- [UI to Agents Authentication](./docs/ui-agents-authentication-architecture.md)
- [Deployment Adapter System](./app/DEPLOYMENT-ADAPTER-SYSTEM.md)
- [Getting Started Guide](./GETTING_STARTED.md)
- [Agents Service README](./agents/README.md)
