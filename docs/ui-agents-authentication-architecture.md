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

### WebSocket Authentication with Socket.IO

```mermaid
sequenceDiagram
    participant Browser
    participant CDN as Edge gateway
    participant UI as Next.js UI
    participant WSHook as WebSocket Hook
    participant SocketIO as Socket.IO Client
    participant Agents as AI Agents Service
    participant WSAuth as WS Auth Middleware

    Browser->>CDN: Initiate WebSocket Connection
    CDN->>UI: Route to UI Instance
    UI->>WSHook: useStreamingWebSocket(appId)
    WSHook->>WSHook: getAgentJWTToken(siteId)

    alt Token Cached
        WSHook-->>WSHook: Use Cached JWT
    else Generate New Token
        WSHook->>WSHook: Generate JWT with RSA Private Key
        Note over WSHook: Claims: { iss, aud, exp, iat, siteId }
    end

    WSHook->>SocketIO: Create connection with JWT
    Note over SocketIO: auth: { token: JWT }, extraHeaders: { Authorization: Bearer JWT }

    SocketIO->>Agents: WebSocket Handshake + JWT
    Agents->>WSAuth: Socket Authentication Middleware
    WSAuth->>WSAuth: Extract JWT from handshake.auth.token or Authorization header

    WSAuth->>WSAuth: Validate JWT with RSA Public Key
    WSAuth->>WSAuth: Extract siteId from JWT payload

    alt Authentication Success
        WSAuth->>WSAuth: Store validated context in socket session
        WSAuth-->>Agents: Connection Approved with siteId
        Agents-->>SocketIO: WebSocket Connected
        SocketIO-->>WSHook: 'connect' event
        WSHook-->>UI: WebSocket Ready
        UI-->>Browser: Real-time connection active

        Note over Browser,Agents: Subsequent messages use validated siteId context
        Browser->>UI: Send AI Message
        UI->>SocketIO: emit('ai-stream', { message, context: { metadata: { appId: siteId } } })
        SocketIO->>Agents: Forward message with context
        Agents->>Agents: Process with siteId from context.metadata.appId
        Agents-->>SocketIO: AI Response Stream
        SocketIO-->>UI: Real-time AI updates
        UI-->>Browser: Live UI updates

    else Authentication Failure
        WSAuth-->>Agents: Connection Rejected
        Agents-->>SocketIO: Connection Failed
        SocketIO-->>WSHook: 'connect_error' event
        WSHook-->>UI: Authentication Error
        UI-->>Browser: Error Message
    end
```

### WebSocket Token Refresh Flow

```mermaid
sequenceDiagram
    participant UI as Next.js UI
    participant SocketIO as Socket.IO Client
    participant Agents as AI Agents Service

    Note over UI,Agents: Active connection, JWT nearing expiration

    Agents->>Agents: Detect token expiration (configurable threshold)
    Agents->>SocketIO: emit('token-refresh-required')
    SocketIO->>UI: Token refresh event

    UI->>UI: Generate fresh JWT with RSA private key
    Note over UI: New token with updated exp/iat, same siteId
    UI->>SocketIO: emit('refresh-token', {newJWT})
    SocketIO->>Agents: Forward new token

    Agents->>Agents: Validate new JWT with RSA public key
    Agents->>Agents: Update cached context with new token
    Agents->>SocketIO: emit('token-refreshed', {success: true})
    SocketIO->>UI: Token refresh confirmed

    Note over UI,Agents: Connection continues with fresh token
    Note over Agents: Automatic refresh continues every token cycle
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

### 3. WebSocket Authentication Manager

WebSocket manager with JWT authentication support.

**Key Features**:

- Site-specific JWT token generation
- Socket.IO auth object and header-based authentication
- Automatic token refresh for long-lived connections

### 4. Agents Service JWT Validation

Server-side JWT validation for both HTTP and WebSocket using RSA public key.

**Middleware Integration**:

- HTTP requests: Express middleware with JWT validation
- WebSocket: Socket.IO handshake middleware with auth object support
- Direct public key validation (no external dependencies)
- Bypass mode for existing containers
