# UI to Agents Authentication Architecture

## Table of Contents

1. [System Overview](#system-overview)
2. [Architecture Diagrams](#architecture-diagrams)
3. [HTTPS Authentication Flow](#https-authentication-flow)
4. [WebSocket Authentication Flow](#websocket-authentication-flow)
5. [Data Flow Diagrams](#data-flow-diagrams)
6. [JWT Key Management](#jwt-key-management)
7. [Service Integration Details](#service-integration-details)

## System Overview

The Airo AI Builder authentication system provides secure communication between the Next.js UI application and the AI Agents Service using both HTTPS REST API calls and WebSocket connections. The system uses a custom JWT-based authentication with RSA-256 signing.

### Core Components

- **UI Application (Next.js)**: Frontend application that generates and signs JWT tokens
- **Agents Service (Express)**: Backend API with JWT validation using public key
- **RSA Key Pair**: Private key for signing (app), public key for validation (agents)
- **Edge gateway**: Content delivery and SSL termination

### Authentication Architecture

The system uses custom JWT (JSON Web Token) authentication:

- **Token Source**: Airo App (Next.js application)
- **Token Generation**: RSA-256 signing with private key
- **Token Validation**: RSA-256 verification with public key
- **Token Storage**: In-memory cache on client side
- **Token Refresh**: 12-hour lifetime with 10-hour refresh cycle
- **Site Context**: `siteId` for app-specific authorization

## Architecture Diagrams

### High-Level Authentication Architecture

```mermaid
graph TB
    User[👤 User Browser] --> LB[Edge gateway]
    LB --> UI[Next.js UI App]

    UI --> JWTService[JWT Service]
    JWTService --> PrivateKey[RSA Private Key]
    JWTService --> TokenCache[Token Cache]

    UI --> AgentHTTPS[Agent HTTPS API]
    UI --> AgentWS[Agent WebSocket]

    AgentHTTPS --> Agents[AI Agents Service]
    AgentWS --> Agents

    Agents --> JWTValidator[JWT Validation Service]
    Agents --> WSAuth[WebSocket Auth Middleware]

    JWTValidator --> PublicKey[RSA Public Key]
    WSAuth --> PublicKey

    style JWTService fill:#e1f5fe
    style PublicKey fill:#f3e5f5
    style PrivateKey fill:#f3e5f5
    style Agents fill:#e8f5e8
```

## HTTPS Authentication Flow

### JWT Authentication Flow

```mermaid
sequenceDiagram
    participant Browser
    participant CDN as Edge gateway
    participant UI as Next.js UI
    participant JWTService as JWT Service
    participant AgentFetch as Agent Fetch
    participant Agents as AI Agents Service
    participant JWTValidator as JWT Validator

    Browser->>CDN: HTTPS Request
    CDN->>UI: Forward to UI Instance

    UI->>AgentFetch: agentFetch(agent_url, { siteId })
    AgentFetch->>JWTService: getAgentToken(siteId)

    alt Token Cached
        JWTService-->>AgentFetch: Cached JWT Token
    else Token Expired/Missing
        JWTService->>JWTService: Generate JWT with RSA Private Key
        Note over JWTService: Claims: { iss, aud, exp, iat, siteId }
        JWTService-->>AgentFetch: New JWT Token
    end

    AgentFetch->>Agents: HTTPS Request + Authorization: Bearer JWT

    Agents->>JWTValidator: validateToken(jwt)
    JWTValidator->>JWTValidator: Verify JWT with RSA Public Key
    JWTValidator-->>Agents: Validation Result + siteId

    alt Authentication Success
        Agents->>Agents: Process Request with siteId from JWT
        Agents-->>AgentFetch: API Response
        AgentFetch-->>UI: Response Data
        UI-->>CDN: Updated UI
        CDN-->>Browser: HTTPS Response
    else Authentication Failure
        JWTValidator-->>Agents: Invalid Token
        Agents-->>AgentFetch: 401 Unauthorized
        AgentFetch-->>UI: Authentication Error
        UI-->>Browser: Error Message
    end
```

## WebSocket Authentication Flow

### Connect-Then-Auth (Current)

The current protocol decouples WebSocket transport connection from JWT authentication. The client connects without a token, then authenticates over the established connection. This reduces connection latency by parallelizing token fetch with socket connect.

```mermaid
sequenceDiagram
    participant Browser
    participant UI as Next.js UI
    participant ConnMgr as ConnectionManager
    participant SocketIO as Socket.IO Client
    participant Agents as AI Agents Service
    participant WSAuth as WS Auth Middleware

    Browser->>UI: Navigate to app
    UI->>ConnMgr: connect(appId)
    ConnMgr->>ConnMgr: Start token fetch (parallel)
    ConnMgr->>SocketIO: Create socket WITHOUT token
    Note over SocketIO: auth: { appId, previousSocketId }

    SocketIO->>Agents: WebSocket Handshake (no JWT)
    Agents->>WSAuth: io.use() middleware
    WSAuth->>WSAuth: No token → set pendingAuth: true
    WSAuth-->>Agents: Connection accepted (deferred setup)
    Agents-->>SocketIO: server_config { supportsConnectThenAuth, ackTimeout }
    SocketIO-->>ConnMgr: 'connect' event

    ConnMgr->>ConnMgr: Token fetch completes
    ConnMgr->>SocketIO: emit('authenticate', { token: JWT })
    SocketIO->>Agents: authenticate event
    Agents->>WSAuth: Validate JWT with RSA Public Key
    WSAuth->>WSAuth: Extract siteId, create agentContext

    alt Authentication Success
        Agents->>Agents: completeConnectionSetup (recovery, agents, history)
        Agents-->>SocketIO: authenticateSuccess({ socketId })
        SocketIO-->>ConnMgr: onAuthenticated → AUTH_SUCCESS
        ConnMgr-->>UI: WebSocket ready, machine → connected
    else Authentication Failure
        Agents-->>SocketIO: authenticateError({ error })
        SocketIO-->>ConnMgr: onAuthFailed → AUTH_FAILED, clear cachedToken
        ConnMgr-->>UI: Auth failed, machine → reconnecting
    end

    Note over Browser,Agents: Subsequent messages use validated siteId context
```

**Key design decisions:**
- **Token NOT stored in `socket.auth`** after auth success — prevents Socket.IO auto-reconnect from sending a stale token in the handshake, which would bypass `pendingAuth` and leak recovery data before authentication.
- **`server_config` sent before auth** — client needs timeout config and capability flags (`supportsConnectThenAuth`, `ackTimeout`) before authenticating.
- **`completeConnectionSetup` deferred** — for `pendingAuth` sockets, recovery/history/agents are initialized only after the `authenticate` event succeeds. This prevents unauthenticated access to conversation data.

### Auth Mode Decision on Reconnect

On `connect`, ConnectionManager determines auth mode by inspecting the socket state:

| Condition | Action | Reason |
|-----------|--------|--------|
| `handshakeAuthMode` flag set | Call `onAuthenticated` directly, consume flag | First connect after old-server fallback |
| Token present in `socket.auth` | Call `onAuthenticated` directly | Reconnect of handshake-auth socket — server already validated via `io.use()` |
| No token in `socket.auth` | Send `authenticate` event with `cachedToken` | Connect-then-auth flow |

### Backward/Forward Compatibility

| Client | Server | Connect | Reconnect |
|--------|--------|---------|-----------|
| **New** | **New** | No token → `pendingAuth` → authenticate event | Same (no token in `socket.auth`) |
| **New** | **Old** | No token → rejected → `handshakeAuthMode` fallback | Token in `socket.auth` from construction → `onAuthenticated` directly |
| **Old** | **New** | Token in handshake → middleware validates | Same (token persists in `socket.auth`) |
| **Old** | **Old** | Token in handshake → middleware validates | Same |

The `handshakeAuthMode` fallback detects old servers by the `'Missing or invalid Authorization'` connect_error, creates a new socket with the token in the handshake, and sets the flag so `onConnect` skips the authenticate event.

### Handshake Auth (Legacy / Fallback)

Old clients (or fallback after detecting an old server) include the JWT in the Socket.IO handshake:

```mermaid
sequenceDiagram
    participant ConnMgr as ConnectionManager
    participant SocketIO as Socket.IO Client
    participant Agents as AI Agents Service
    participant WSAuth as WS Auth Middleware

    ConnMgr->>SocketIO: Create socket WITH token
    Note over SocketIO: auth: { token: JWT, appId }, extraHeaders: { Authorization: Bearer JWT }

    SocketIO->>Agents: WebSocket Handshake + JWT
    Agents->>WSAuth: io.use() middleware
    WSAuth->>WSAuth: Extract JWT from handshake.auth.token or Authorization header
    WSAuth->>WSAuth: Validate JWT with RSA Public Key
    WSAuth->>WSAuth: Extract siteId from JWT payload

    alt Authentication Success
        WSAuth->>WSAuth: Store validated context in socket session
        Agents->>Agents: completeConnectionSetup immediately
        Agents-->>SocketIO: WebSocket Connected
        SocketIO-->>ConnMgr: 'connect' event → onAuthenticated
    else Authentication Failure
        WSAuth-->>Agents: Connection Rejected
        Agents-->>SocketIO: connect_error
    end
```

### WebSocket Token Expiration on Reconnect

When a handshake-auth socket reconnects and the token has expired, the server rejects the handshake. ConnectionManager handles this by fetching a fresh token and creating a new socket:

```mermaid
sequenceDiagram
    participant ConnMgr as ConnectionManager
    participant SocketIO as Socket.IO Client
    participant Agents as AI Agents Service

    Note over ConnMgr,Agents: Socket.IO auto-reconnect with stale token
    SocketIO->>Agents: Handshake with expired JWT
    Agents-->>SocketIO: connect_error('JWT validation failed: Token expired')
    SocketIO-->>ConnMgr: onConnectError

    ConnMgr->>ConnMgr: handleTokenExpiration (max 7 retries)
    ConnMgr->>ConnMgr: Fetch fresh JWT
    ConnMgr->>SocketIO: Create new socket with fresh token
    SocketIO->>Agents: Handshake with fresh JWT
    Agents-->>SocketIO: Connection accepted
    SocketIO-->>ConnMgr: 'connect' event → onAuthenticated
```

## Data Flow Diagrams

### Authentication Data Flow

```mermaid
flowchart TD
    A[User Browser] -->|1. HTTPS Request| B[Edge gateway]
    B -->|2. Route| C[Next.js UI Instance]
    C -->|3. Get JWT Service| D[JWT Service]

    D -->|4. Check Token Cache| E[Token Cache]
    E -->|5. Token Cached?| F{Token Valid & Fresh?}
    F -->|No| G[Generate New JWT]
    F -->|Yes| H[Use Cached Token]

    G -->|6. Sign with Private Key| I[RSA Private Key]
    I -->|7. JWT Token| D
    D -->|8. Cache Token| E

    C -->|9. Agent Request + JWT| J[AI Agents Service]
    J -->|10. Route| K[AI Agents Service Instance]
    K -->|11. Extract JWT| L[JWT Auth Middleware]

    L -->|12. Validate with Public Key| M[RSA Public Key]
    M -->|13. Validation Result + siteId| L

    L -->|14. Site Context from JWT| N[Request Handler]
    N -->|15. Process Request| O[AI Agent Instance]
    O -->|16. Response| J
    J -->|17. Forward| C
    C -->|18. Update UI| B
    B -->|19. HTTPS Response| A

    style D fill:#e3f2fd
    style L fill:#e8f5e8
    style I fill:#fce4ec
    style M fill:#fce4ec
```

## JWT Key Management

The system uses RSA-256 key pairs for JWT signing and validation, eliminating the need for external service dependencies.

### Key Generation and Distribution

```mermaid
graph TB
    KeyGen[Key Generation Script] -->|Generates| KeyPair[RSA 2048-bit Key Pair]
    KeyPair --> PrivateKey[Private Key]
    KeyPair --> PublicKey[Public Key]

    PrivateKey -->|Environment Variable| AppEnv[App Environment]
    PublicKey -->|Environment Variable| AppEnv
    PublicKey -->|Environment Variable| AgentEnv[Agent Environment]

    AppEnv -->|JWT Signing| JWTService[JWT Service]
    AgentEnv -->|JWT Validation| JWTValidator[JWT Validator]

    style KeyGen fill:#e3f2fd
    style PrivateKey fill:#fce4ec
    style PublicKey fill:#fce4ec
    style JWTService fill:#e8f5e8
    style JWTValidator fill:#e8f5e8
```

### Key Management Flow

```mermaid
sequenceDiagram
    participant Admin
    participant KeyScript as Key Generation Script
    participant AppEnv as App Environment
    participant AgentEnv as Agent Environment
    participant App as Next.js App
    participant Agent as Agents Service

    Admin->>KeyScript: Run scripts/generate-jwt-keys.js
    KeyScript->>KeyScript: Generate RSA 2048-bit key pair
    KeyScript-->>Admin: Private Key (PEM format)
    KeyScript-->>Admin: Public Key (PEM format)

    Admin->>AppEnv: Set JWT_PRIVATE_KEY
    Admin->>AppEnv: Set JWT_PUBLIC_KEY
    Admin->>AgentEnv: Set JWT_PUBLIC_KEY

    Note over App,Agent: Runtime JWT operations

    App->>App: Load private key from JWT_PRIVATE_KEY
    App->>App: Sign JWT tokens with private key

    Agent->>Agent: Load public key from JWT_PUBLIC_KEY
    Agent->>Agent: Validate JWT tokens with public key
```

### Environment Configuration

**App Environment Variables:**

```bash
# Required for JWT token generation
JWT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC..."
JWT_PUBLIC_KEY="-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAtK..."
```

**Agent Environment Variables:**

```bash
# Required for JWT token validation
JWT_PUBLIC_KEY="-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAtK..."

# Optional: Empty string bypasses authentication (for existing containers)
JWT_PUBLIC_KEY=""
```

### Key Format Handling

**PEM Key Normalization:**

```typescript
// Handle escaped newlines from environment variables
function normalizePEMKey(key: string): string {
  return key.replace(/\\n/g, "\n");
}

// Usage in both app and agent
const publicKey = normalizePEMKey(process.env.JWT_PUBLIC_KEY);
const privateKey = normalizePEMKey(process.env.JWT_PRIVATE_KEY);
```

### Security Features

**Key Security:**

- RSA 2048-bit keys (industry standard)
- Private key never leaves app environment
- Public key distributed to agents only
- PEM format with proper encoding

**Bypass Mode:**

- Empty `JWT_PUBLIC_KEY` bypasses authentication
- Useful for existing containers during migration
- Returns `{ valid: true }` for all tokens

## Service Integration Details

### 1. JWT Authentication Service

The system uses a custom JWT authentication service for all authentication operations.

**Key Features**:

- RSA-256 JWT token generation and validation
- In-memory token caching with expiration
- Automatic token refresh (12-hour lifetime, 10-hour refresh cycle)
- Comprehensive error handling and logging

### 2. Agent API Client

HTTP client for authenticated requests to agents using `agentFetch`.

**Key Integration Points**:

- Used by all UI components for agent API calls
- Automatic JWT token generation and header injection
- Token caching per `siteId` with expiration handling
- Request ID generation for tracing across services
- Comprehensive error logging for monitoring

### 3. WebSocket Authentication (ConnectionManager)

ConnectionManager handles WebSocket authentication lifecycle.

**Key Features**:

- **Connect-then-auth**: Connects without token, authenticates via `authenticate` event after socket is established
- **Parallel token fetch**: Token fetched concurrently with socket connect to reduce latency
- **Handshake-auth fallback**: Detects old servers and falls back to token-in-handshake
- **Reconnect-aware**: Uses `hasHandshakeToken` check to determine auth mode on reconnect
- **Token leak prevention**: Never stores token in `socket.auth` after auth to prevent stale tokens on auto-reconnect
- **Auth timeout**: Configurable via server_config `ackTimeout`, defaults to 30s

### 4. Agents Service JWT Validation

Server-side JWT validation for both HTTP and WebSocket using RSA public key.

**Middleware Integration**:

- HTTP requests: Express middleware with JWT validation
- WebSocket `io.use()` middleware: Validates handshake token if present, sets `pendingAuth` if not
- WebSocket `authenticate` event handler: Validates token from connect-then-auth clients, calls `completeConnectionSetup`
- `completeConnectionSetup` idempotency: Runs only once per socket regardless of auth path
- Direct public key validation (no external dependencies)
- Bypass mode for existing containers
