# UI to Agents Authentication Architecture

## Table of Contents

1. [System Overview](#system-overview)
2. [Architecture Diagrams](#architecture-diagrams)
3. [HTTPS Authentication Flow](#https-authentication-flow)
4. [WebSocket Authentication Flow](#websocket-authentication-flow)
5. [Data Flow Diagrams](#data-flow-diagrams)
6. [Test Environment with Proxy SSO Validation](#test-environment-with-proxy-sso-validation)
7. [Service Integration Details](#service-integration-details)

## System Overview

The Airo AI Builder authentication system provides secure communication between the Next.js UI application and the AI Agents Service using both HTTPS REST API calls and WebSocket connections. The system uses JWT-based authentication with GoDaddy SSO integration.

### Core Components

- **UI Application (Next.js)**: Frontend application with JWT authentication
- **Agents Service (Express)**: Backend API with JWT validation
- **GoDaddy SSO Service**: GoDaddy SSO service for JWT token validation
- **Edge gateway**: Content delivery and SSL termination

### Authentication Architecture

The system uses JWT (JSON Web Token) authentication:

- **Token Source**: GoDaddy SSO service
- **Token Storage**: Secure HTTP-only cookies (`auth_idp`)
- **Token Validation**: Full signature verification with SSO service
- **Token Refresh**: Automatic heartbeat and refresh mechanism
- **User Context**: Authenticated user identity and permissions

## Architecture Diagrams

### High-Level Authentication Architecture

```mermaid
graph TB
    User[👤 User Browser] --> LB[Edge gateway]
    LB --> UI[Next.js UI App]

    UI --> JWTAuth[JWT Auth Service]
    JWTAuth --> SSO[GoDaddy SSO Service]
    JWTAuth --> Cookies[Secure HTTP Cookies]

    UI --> AgentHTTPS[Agent HTTPS API]
    UI --> AgentWS[Agent WebSocket]

    AgentHTTPS --> Agents[AI Agents Service]
    AgentWS --> Agents

    Agents --> JWTValidator[JWT Validation Service]
    Agents --> WSAuth[WebSocket Auth Middleware]

    JWTValidator --> SSO
    WSAuth --> SSO

    style JWTAuth fill:#e1f5fe
    style SSO fill:#f3e5f5
    style Agents fill:#e8f5e8
```

## HTTPS Authentication Flow

### JWT Authentication Flow

```mermaid
sequenceDiagram
    participant Browser
    participant CDN as Edge gateway
    participant UI as Next.js UI
    participant AuthService as JWT Auth Service
    participant AgentFetch as Agent Fetch
    participant Agents as AI Agents Service
    participant JWTValidator as JWT Validator
    participant SSO as GoDaddy SSO

    Browser->>CDN: HTTPS Request
    CDN->>UI: Forward to UI Instance
    UI->>AuthService: authenticate()

    AuthService->>Browser: Extract 'auth_idp' cookie
    Browser-->>AuthService: JWT Token

    UI->>AgentFetch: agentFetch(agent_url, options)
    AgentFetch->>AuthService: getAuthHeaders()
    AuthService-->>AgentFetch: Authorization: Bearer {token}

    AgentFetch->>Agents: HTTPS Request + JWT Header

    Agents->>JWTValidator: validateToken(jwt)
    JWTValidator->>SSO: Authenticate JWT with SSO
    SSO-->>JWTValidator: Validation Result + User Profile
    JWTValidator-->>Agents: User Context + Permissions

    alt Authentication Success
        Agents->>Agents: Process Request with User Context from JWT
        Agents-->>AgentFetch: API Response
        AgentFetch-->>UI: Response Data
        UI-->>CDN: Updated UI
        CDN-->>Browser: HTTPS Response
    else Authentication Failure
        JWTValidator-->>Agents: Invalid Token
        Agents-->>AgentFetch: 401 Unauthorized
        AgentFetch-->>UI: Authentication Error
        UI->>SSO: Redirect to SSO Login
        SSO-->>Browser: Login Page
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
    participant SSO as GoDaddy SSO

    Browser->>CDN: Initiate WebSocket Connection
    CDN->>UI: Route to UI Instance
    UI->>WSHook: useStreamingWebSocket()
    WSHook->>Browser: getAuthTokenFromCookie()
    Browser-->>WSHook: 'auth_idp' secure cookie

    WSHook->>SocketIO: Create connection with JWT
    Note over SocketIO: extraHeaders: {Authorization: Bearer {token}}

    SocketIO->>Agents: WebSocket Handshake + JWT
    Agents->>WSAuth: Socket Authentication Middleware
    WSAuth->>WSAuth: Extract Bearer token from headers

    WSAuth->>SSO: Full JWT Signature Validation
    SSO-->>WSAuth: Validation Result + User Profile

    alt Authentication Success
        WSAuth->>WSAuth: Store user context in socket session (from JWT)
        WSAuth-->>Agents: Connection Approved with User Context
        Agents-->>SocketIO: WebSocket Connected
        SocketIO-->>WSHook: 'connect' event
        WSHook-->>UI: WebSocket Ready
        UI-->>Browser: Real-time connection active

        Note over Browser,SSO: Subsequent messages use cached JWT context
        Browser->>UI: Send AI Message
        UI->>SocketIO: emit('ai-stream', message)
        SocketIO->>Agents: Forward message
        Agents->>Agents: Process with cached user context from JWT
        Agents-->>SocketIO: AI Response Stream
        SocketIO-->>UI: Real-time AI updates
        UI-->>Browser: Live UI updates

    else Authentication Failure
        WSAuth-->>Agents: Connection Rejected
        Agents-->>SocketIO: Connection Failed
        SocketIO-->>WSHook: 'connect_error' event
        WSHook-->>UI: Authentication Error
        UI->>SSO: Redirect to SSO Login
        SSO-->>Browser: Login Page
    end
```

### WebSocket Token Refresh Flow

```mermaid
sequenceDiagram
    participant UI as Next.js UI
    participant SocketIO as Socket.IO Client
    participant Agents as AI Agents Service
    participant SSO as GoDaddy SSO

    Note over UI,SSO: Active connection, JWT nearing expiration

    Agents->>Agents: Detect token expiration (5min before exp)
    Agents->>SocketIO: emit('token-refresh-required')
    SocketIO->>UI: Token refresh event

    UI->>UI: Get fresh token from JWT auth service
    UI->>SocketIO: emit('refresh-token', {newJWT})
    SocketIO->>Agents: Forward new token

    Agents->>SSO: Validate new JWT token
    SSO-->>Agents: New token valid + updated profile

    Agents->>Agents: Update cached user context with new token
    Agents->>SocketIO: emit('token-refreshed', {success: true})
    SocketIO->>UI: Token refresh confirmed

    Note over UI,SSO: Connection continues with fresh token
    Note over Agents: Automatic refresh continues every token cycle
```

## Data Flow Diagrams

### Authentication Data Flow

```mermaid
flowchart TD
    A[User Browser] -->|1. HTTPS Request| B[Edge gateway]
    B -->|2. Route| C[Next.js UI Instance]
    C -->|3. Get Auth Service| D[JWT Auth Service]

    D -->|4. Extract Token| E[Secure HTTP Cookies]
    E -->|5. auth_idp JWT| D

    D -->|6. Validate Format| F{JWT Format Valid?}
    F -->|No| G[Return Auth Error]
    F -->|Yes| H[Add Authorization Header]

    C -->|7. Agent Request + JWT| I[AI Agents Service]
    I -->|8. Route| J[AI Agents Service Instance]
    J -->|9. Extract JWT| K[JWT Auth Middleware]

    K -->|10. Validate with SSO| L[GoDaddy SSO Service]
    L -->|11. User Profile + Permissions| K

    K -->|12. User Context from JWT| N[Request Handler]
    N -->|13. Process Request| O[AI Agent Instance]
    O -->|14. Response| I
    I -->|15. Forward| C
    C -->|16. Update UI| B
    B -->|17. HTTPS Response| A

    style D fill:#e3f2fd
    style K fill:#e8f5e8
    style L fill:#fce4ec
```

## Test Environment with Proxy SSO Validation

In test and development environments, as GoDaddy SSO API is not reachable, the AI Agents Service uses a proxy service for SSO validation instead of connecting directly to SSO.

### Proxy Service Architecture

```mermaid
graph TB
    UIProxy[Next.js UI] --> AgentsProxy[AI Agents Service]
    AgentsProxy -->|JWT Validation| ProxyService[Proxy Service]

    ProxyService -->|Fetch Public Keys| SSOProxy[GoDaddy SSO Service]
    ProxyService -->|Cache Keys| KeyCache[(Public Key Cache)]

    UIProxy -->|Browser Auth| SSOProxy

    subgraph "Test Environment"
        AgentsProxy
        ProxyService
        KeyCache
    end

    subgraph "External"
        SSOProxy
    end

    style ProxyService fill:#e8f5e8
    style KeyCache fill:#fff3e0
    style SSOProxy fill:#f3e5f5
```

### Proxy SSO Validation Flow

```mermaid
sequenceDiagram
    participant Browser
    participant UI as Next.js UI
    participant Agents as AI Agents Service
    participant ProxySvc as Proxy Service
    participant SSO as GoDaddy SSO
    participant Cache as Public Key Cache

    Note over Browser,Cache: Test Environment JWT Validation

    Browser->>UI: API Request with JWT Cookie
    UI->>Agents: Forward request + JWT Header

    Agents->>Agents: Check NODE_ENV (non-production)
    Agents->>ProxySvc: POST /validate-jwt + Bearer Token

    ProxySvc->>ProxySvc: Extract JWT and decode header (kid)

    alt Public Key Cached
        ProxySvc->>Cache: Get cached public key
        Cache-->>ProxySvc: Return cached PEM key
    else Public Key Not Cached/Expired
        ProxySvc->>SSO: GET /v1/api/key/{kid}
        SSO-->>ProxySvc: Return JWK public key
        ProxySvc->>ProxySvc: Convert JWK to PEM format
        ProxySvc->>Cache: Cache PEM key (15min TTL)
    end

    ProxySvc->>ProxySvc: Validate JWT signature with PEM key

    alt JWT Valid
        ProxySvc-->>Agents: 200 + User payload
        Agents->>Agents: Process request with user context
        Agents-->>UI: API Response
        UI-->>Browser: Response
    else JWT Invalid
        ProxySvc-->>Agents: 401 + Error reason
        Agents-->>UI: Authentication Error
        UI->>SSO: Redirect to login
    end
```

### Environment Configuration

The agents service automatically selects validation method based on environment:

**Environment Variables:**

- `NODE_ENV`: When set to `production`, uses direct SSO validation
- `PROXY_URL`: URL of the proxy service
- `SSO_LOGIN_URL`: SSO endpoint URL for public key fetching

**Validation Strategy:**

```typescript
// Production environment
if (NODE_ENV === "production") {
  // Direct SSO validation - fetch public keys directly
  validateJWTWithPublicKey(token);
} else {
  // Test/Dev environment - use proxy service
  validateJWTViaProxy(token);
}
```

### Proxy Service Features

**Public Key Caching:**

- 15-minute TTL for public keys
- Automatic cache cleanup when size limit reached
- Prevents repeated SSO calls for same key IDs

**Security Features:**

- Token size limits (10KB max) to prevent DoS attacks
- SSL/TLS encryption for all communications

## Service Integration Details

### 1. JWT Authentication Service

The system uses a dedicated JWT authentication service for all authentication operations.

**Key Features**:

- Full GoDaddy SSO integration with certificate validation
- Automatic token heartbeat and refresh
- Comprehensive error handling and logging

### 2. Agent API Client

HTTP client for authenticated requests to agents.

**Key Integration Points**:

- Used by all UI components for agent API calls
- Automatic JWT header injection
- Request ID generation for tracing across services
- Comprehensive error logging for monitoring
- Token refresh handling for expired JWTs

### 3. WebSocket Authentication Manager

WebSocket manager with high availability and failover support.

**Key Features**:

- Site-specific agent URL configuration
- Secure JWT extraction from HTTP-only cookies

### 4. Agents Service JWT Validation

Server-side JWT validation for both HTTP and WebSocket with performance optimization.

**Middleware Integration**:

- HTTP requests: Express middleware
- WebSocket: Socket.IO handshake middleware with sticky sessions
- Token caching for performance
