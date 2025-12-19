# Social Connections Flow Diagrams

## Table of Contents

1. [High-Level Architecture](#high-level-architecture)
2. **Sequence Diagrams**
   - [New Connection Flow (No Existing Connections)](#new-connection-flow-no-existing-connections)
   - [Link Existing Connection Flow](#link-existing-connection-flow)
   - [Already Connected Flow](#already-connected-flow)
   - [Unlink Connection Flow](#unlink-connection-flow)
   - [OAuth Error & Retry Flow](#oauth-error--retry-flow)
   - [Permission Validation Failure Flow](#permission-validation-failure-flow)
3. [State Machine Flow](#state-machine-flow)
4. [Data Architecture](#data-architecture)

## High-Level Architecture

```mermaid
graph TB
    subgraph "Airo App Builder"
        Agent[Marketing Agent]
        Tools[Social Tools<br/>socialConnect]
        UI[SocialConnectFlow<br/>Component]
        API[Association API<br/>/api/sites/:id/social/associations]
        DB[(MySQL Database<br/>social_associations table)]
    end
    subgraph "External Services"
        SocialAuth[social-auth API<br/>OAuth Management]
        SocialV2[social-v2 API<br/>Connection & Proxy]
        Platforms[Social Platforms<br/>Facebook, Google, TikTok, etc.]
    end

    Agent -->|Tool Call| Tools
    Tools -->|Widget Signal| UI
    UI -->|POST/GET/DELETE| API
    API -->|CRUD Operations| DB

    UI -->|1. Get OAuth URL<br/>2. Validate Tokens| SocialAuth
    SocialAuth <-->|OAuth Flow| Platforms

    UI -->|3. Fetch Metadata<br/>4. Create Connection| SocialV2
    SocialV2 -->|Proxy API Calls| Platforms

    style Agent fill:#e1f5ff
    style UI fill:#fff4e1
    style API fill:#e8f5e9
    style DB fill:#c8e6c9
    style SocialV2 fill:#f3e5f5
    style SocialAuth fill:#f3e5f5
    style Platforms fill:#fce4ec
```

## New Connection Flow (No Existing Connections)

```mermaid
sequenceDiagram
    participant User
    participant Agent as Marketing Agent
    participant UI as SocialConnectFlow
    participant API as Association API
    participant DB as AAB MySQL
    participant SocialV2 as social-v2 API
    participant SocialAuth as social-auth API
    participant Platform as Platform (Facebook/Google/TikTok)

    User->>Agent: "Connect my Facebook"
    Agent->>UI: socialConnect({ platform: "facebook" })
    Note over UI: Widget signal received<br/>State: CheckExisting

    par Check Existing
        UI->>API: GET /api/sites/:id/social/associations
        API->>DB: Query social_associations<br/>WHERE site_id = :id
        DB-->>API: [] (no associations)
        API-->>UI: { associations: [] }
    and
        UI->>SocialV2: GET /social_connections
        SocialV2-->>UI: [] (no existing connections)
    end

    Note over UI: State: Auth<br/>No existing connections found
    UI->>SocialAuth: GET /platforms/facebook/authorization_url
    SocialAuth-->>UI: { authorizationUrl, state }
    UI->>User: Show "Connect Facebook" button
    User->>UI: Clicks button
    UI->>Platform: Open OAuth popup
    Platform->>User: Show login & permissions
    User->>Platform: Authenticate & grant permissions
    Platform-->>UI: Callback with tokenId

    Note over UI: State: ValidatingPermissions
    UI->>SocialAuth: GET /platforms/facebook/tokens/:tokenId
    SocialAuth-->>UI: { data: { scopes: [...] } }
    Note over UI: Validate required scopes present

    Note over UI: State: FetchingPages
    UI->>SocialV2: GET /facebook/proxy/v18.0/me/accounts
    Note over SocialV2: Uses X-Token-Id header
    SocialV2->>Platform: Forward request with OAuth token
    Platform-->>SocialV2: { data: [pages...] }
    SocialV2-->>UI: { data: [pages with metadata] }

    Note over UI: State: SelectingPage
    UI->>User: Show page selector
    User->>UI: Selects "My Business Page"

    Note over UI: State: CreatingConnection
    UI->>SocialV2: POST /social_connections<br/>{ platform, pageId, userId, userTokenId, pageTokenId }
    Note over SocialV2: Create connection<br/>Store tokens & metadata
    SocialV2-->>UI: { socialId: "social_abc" }

    UI->>API: POST /api/sites/:id/social/associations<br/>{ socialId: "social_abc", platform: "FACEBOOK" }
    API->>DB: INSERT INTO social_associations<br/>(site_id, social_id, platform)
    DB-->>API: { id, site_id, social_id, platform, created_at }
    API-->>UI: { association: {...} }

    Note over UI: State: Complete
    UI->>User: Show success message
    UI->>Agent: Connection complete
    Agent->>User: "Your Facebook page is now connected!"
```

## Link Existing Connection Flow

```mermaid
sequenceDiagram
    participant User
    participant Agent as Marketing Agent
    participant UI as SocialConnectFlow
    participant API as Association API
    participant DB as AAB MySQL
    participant SocialV2 as social-v2 API

    User->>Agent: "Connect my Facebook"
    Agent->>UI: socialConnect({ platform: "facebook" })
    Note over UI: Widget signal received<br/>State: SelectExisting

    par Check Existing
        UI->>API: GET /api/sites/:id/social/associations
        API->>DB: Query social_associations<br/>WHERE site_id = :id
        DB-->>API: [] (no associations for this site)
        API-->>UI: { associations: [] }
    and
        UI->>SocialV2: GET /social_connections
        SocialV2-->>UI: [{ socialId: "social_123", platform: "FACEBOOK", pageId: "page_abc" }]
    end

    Note over UI: User has existing connections!

    UI->>SocialV2: POST /social_connections/batch<br/>{ ids: ["social_123"] }
    SocialV2-->>UI: [{ socialId, platform, pageId, userTokenId }]

    UI->>SocialV2: GET /facebook/proxy/v18.0/page_abc?fields=name,category
    Note over SocialV2: Fetch metadata using stored token
    SocialV2-->>UI: { id: "page_abc", name: "My Business Page" }

    Note over UI: State: SelectExisting<br/>Show existing connections
    UI->>User: Show connection selector<br/>"My Business Page"
    User->>UI: Selects existing connection

    Note over UI: State: CreatingConnection<br/>(Link only, no OAuth needed)
    UI->>API: POST /api/sites/:id/social/associations<br/>{ socialId: "social_123", platform: "FACEBOOK" }
    API->>DB: INSERT INTO social_associations<br/>(site_id, social_id, platform)
    DB-->>API: { id, site_id, social_id, platform, created_at }
    API-->>UI: { association: {...} }

    Note over UI: State: Complete
    UI->>User: Show success message
    UI->>Agent: Connection complete
    Agent->>User: "Your Facebook page is now connected!"
```

## Already Connected Flow

```mermaid
sequenceDiagram
    participant User
    participant Agent as Marketing Agent
    participant UI as SocialConnectFlow
    participant API as Association API
    participant DB as AAB MySQL
    participant SocialV2 as social-v2 API

    User->>Agent: "Connect my Facebook"
    Agent->>UI: socialConnect({ platform: "facebook" })
    Note over UI: Widget signal received<br/>State: SelectExisting

    UI->>API: GET /api/sites/:id/social/associations
    API->>DB: Query social_associations<br/>WHERE site_id = :id
    DB-->>API: [{ id: "assoc_1", social_id: "social_123", platform: "FACEBOOK" }]
    API-->>UI: { associations: [...] }

    Note over UI: Site already has Facebook connection!<br/>Check for platform collision

    UI->>SocialV2: POST /social_connections/batch<br/>{ ids: ["social_123"] }
    SocialV2-->>UI: [{ socialId: "social_123", pageId: "page_abc" }]

    UI->>SocialV2: GET /facebook/proxy/v18.0/page_abc?fields=name
    SocialV2-->>UI: { name: "My Business Page" }

    UI->>User: Show warning<br/>"Already connected to My Business Page"<br/>[Change Connection] button

    alt User clicks "Change Connection"
        User->>UI: Clicks "Change Connection"
        Note over UI: State: ForceNewConnection
        UI->>User: Show connection selector<br/>with existing + "Add New" option
    else User cancels
        User->>UI: Closes flow
        Note over UI: Flow complete (no changes)
    end
```

## Unlink Connection Flow

_This flow is only available via Settings > Social Tab_

```mermaid
sequenceDiagram
    participant User
    participant UI as Settings > Social Tab
    participant API as Association API
    participant DB as AAB MySQL

    User->>UI: Clicks "Unlink" on Facebook connection
    UI->>User: Show confirmation dialog<br/>"Unlink Facebook page?"

    User->>UI: Confirms unlink

    UI->>API: DELETE /api/sites/:id/social/associations/:associationId
    API->>DB: DELETE FROM social_associations<br/>WHERE id = :associationId
    Note over DB: Hard delete (removes row)
    DB-->>API: Success
    API-->>UI: { success: true }

    UI->>UI: Invalidate queries<br/>Refetch associations
    UI->>User: Show success message<br/>"Facebook page unlinked"

    Note over UI,DB: Note: Connection remains in social-v2<br/>Can be re-linked later without OAuth
```

## OAuth Error & Retry Flow

```mermaid
sequenceDiagram
    participant User
    participant UI as SocialConnectFlow
    participant SocialAuth as social-auth API
    participant Platform as Facebook

    Note over UI: State: Auth
    UI->>SocialAuth: GET /platforms/facebook/authorization_url
    SocialAuth-->>UI: { authorizationUrl, state }

    UI->>Platform: Open OAuth popup
    Platform->>User: Show login page

    alt User cancels OAuth
        User->>Platform: Clicks "Cancel"
        Platform-->>UI: postMessage({ success: false, error: "user_cancelled" })
        Note over UI: State: Error<br/>isRetryable: true
        UI->>User: Show error<br/>"Authentication cancelled"<br/>[Try Again] button
    else OAuth timeout
        Note over UI: 5 minute timeout expires
        Note over UI: State: Error<br/>error: "OAuth connection timed out"
        UI->>User: Show error<br/>"Connection timed out"<br/>[Try Again] button
    else Network error
        Platform-->>UI: Network failure
        Note over UI: State: Error<br/>isRetryable: true
        UI->>User: Show error<br/>"Network error. Please try again"<br/>[Try Again] button
    end

    User->>UI: Clicks "Try Again"
    Note over UI: Check retry count < maxRetries (3)
    Note over UI: State: Auth (retry)
    UI->>SocialAuth: GET /platforms/facebook/authorization_url
    Note over UI: Flow restarts from Auth state
```

## Permission Validation Failure Flow

```mermaid
sequenceDiagram
    participant User
    participant UI as SocialConnectFlow
    participant SocialAuth as social-auth API
    participant Platform as Facebook

    Note over UI: State: ValidatingPermissions
    UI->>SocialAuth: GET /platforms/facebook/tokens/:tokenId
    SocialAuth-->>UI: { data: { scopes: ["public_profile", "pages_show_list"] } }

    Note over UI: Check required scopes:<br/>Required: ["pages_manage_posts", "pages_read_engagement"]<br/>Granted: ["public_profile", "pages_show_list"]<br/>Missing: ["pages_manage_posts", "pages_read_engagement"]

    Note over UI: State: Error<br/>isRetryable: false

    UI->>User: Show error message<br/>"Missing required permissions:<br/>- Manage Posts<br/>- Read Engagement"<br/>[Reconnect with Full Permissions] button

    User->>UI: Clicks "Reconnect"
    Note over UI: State: Auth (restart)
    UI->>SocialAuth: GET /platforms/facebook/authorization_url
    SocialAuth-->>UI: { authorizationUrl, state }

    UI->>Platform: Open OAuth popup
    Platform->>User: Show permissions screen<br/>with all required scopes highlighted
```

## State Machine Flow

```mermaid
stateDiagram-v2
    [*] --> SelectExisting: Start Flow

    SelectExisting --> Auth: No existing OR<br/>Force new connection
    SelectExisting --> CreatingConnection: User selects existing<br/>(Link only)

    Auth --> ValidatingPermissions: OAuth success<br/>(tokenId received)
    Auth --> Error: OAuth failed,<br/>cancelled, or timeout

    ValidatingPermissions --> FetchingPages: Scopes valid
    ValidatingPermissions --> Error: Missing required scopes
    ValidatingPermissions --> ValidatingPermissions: Retryable error<br/>(retry count < max)

    FetchingPages --> SelectingPage: Pages/locations loaded
    FetchingPages --> SelectingPage: Partial failure<br/>(some pages loaded)
    FetchingPages --> Error: Complete failure

    SelectingPage --> CreatingConnection: User selects page/location

    CreatingConnection --> Complete: Connection + association created
    CreatingConnection --> Error: Creation failed

    Complete --> [*]

    Error --> Auth: User retries<br/>(if retryable)
    Error --> [*]: Max retries OR<br/>non-retryable

    note right of SelectExisting
        1. Query AAB DB associations
        2. Query social-v2 connections
        3. Check for platform collision
        4. Enrich with metadata
    end note

    note right of Auth
        1. Get OAuth URL from social-auth
        2. Open popup (600x700)
        3. Wait for callback (5min timeout)
        4. Handle postMessage
    end note

    note right of ValidatingPermissions
        Check granted scopes match
        required scopes for platform.
        Auto-retry on transient errors.
    end note

    note right of FetchingPages
        Facebook: Pages + Instagram accounts
        Google: Locations with VoiceOfMerchant
        Platform-specific proxy calls
    end note

    note right of CreatingConnection
        Two-phase commit:
        1. POST social-v2 /social_connections
        2. POST AAB /api/sites/:id/social/associations
        Returns socialId + associationId
    end note
```

## Data Architecture

```mermaid
erDiagram
    SITES ||--o{ SOCIAL_ASSOCIATIONS : "has many"
    SOCIAL_ASSOCIATIONS ||--|| SOCIAL_V2_CONNECTION : "references"

    SITES {
        string id PK
        string account_id FK
        string title
        datetime created_at
    }

    SOCIAL_ASSOCIATIONS {
        string id PK
        string site_id FK
        string social_id "References social-v2"
        SocialPlatformType platform "Enum: FACEBOOK|INSTAGRAM|GOOGLE_BUSINESS_PROFILE|TIKTOK|YELP|WHATSAPP"
        datetime created_at
        datetime unlinked_at "Soft delete"
    }

    SOCIAL_V2_CONNECTION {
        string socialId PK
        string platform
        string pageId "Facebook only"
        string locationId "Google only"
        string userId "User who authed"
        string userTokenId "OAuth token"
        string pageTokenId "Page token (Facebook)"
    }

    PLATFORM_METADATA {
        string id
        string name
        string category
        string pictureUrl
    }

    SOCIAL_V2_CONNECTION ||--|| PLATFORM_METADATA : "enriched with"
```

### Separation of Concerns

**AAB MySQL Database (`social_associations` table):**

- Stores site-to-connection associations
- Enables one site to have multiple platform connections
- Supports soft deletes via `unlinked_at`
- Enforces unique constraint: `(site_id, social_id)`
- Uses `SocialPlatformType` enum to ensure valid platform values

**social-auth + social-v2 API:**

- Stores OAuth tokens and connection credentials
- Proxies API calls to social platforms
- Returns connection IDs (`socialId`)
- Single source of truth for authentication

**Platform Proxy APIs (via social-v2):**

- Provides metadata (page names, locations, etc.)
- Fetched separately and enriched in frontend
- Not stored permanently, cached in React Query
