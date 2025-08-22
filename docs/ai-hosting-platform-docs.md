# AI Hosting Platform Documentation

## Overview

The AI Hosting Platform is a comprehensive infrastructure solution designed to host and manage AI-powered applications. It provides a scalable, multi-tenant environment where customers can develop, deploy, and manage their AI applications through the Airo Builder App interface.

## Architecture Overview

```mermaid
graph TB
    subgraph "Client Layer"
        AB[Airo Builder App]
    end
    
    subgraph "Control Plane"
        PM[Platform Manager Service]
        DB[(Platform Database)]
        PM --> DB
    end
    
    subgraph "Hosting Cell"
        subgraph "AWS Resources"
            SQS[AWS SQS]
        end

        subgraph "Infrastructure Services"
            NOM[Nomad Orchestrator]
            QW[Queue Worker]
        end
        
        subgraph "Serving Pipeline"
            CS1[Customer Service 1]
            CS2[Customer Service 2]
            CSN[Customer Service N]

            ING[Ingress Tier]
            CEPH[Ceph Network FS]
            MySQL[(MySQL Servers)]
        end
        
        QW --> SQS
        NOM --> CS1
        NOM --> CS2
        NOM --> CSN
        ING --> CS1
        ING --> CS2
        ING --> CSN

        CS1 --> CEPH
        CS2 --> CEPH
        CSN --> CEPH

        CS1 --> MySQL
        CS2 --> MySQL
        CSN --> MySQL
        
    end
    
    AB --> PM
    AB --> CS1
    PM --> SQS
    QW --> NOM
```

## Component Details

### 1. Airo Builder App

The Airo Builder App serves as the primary interface for users to interact with the platform. It provides:

- **Communication with Platform Manager**: Manages app state and deployment configurations
- **Direct Agent Communication**: Interfaces with customer service agents for app management
- **Service Discovery**: Utilizes the Platform Manager's location service to resolve agent URLs

### 2. Platform Manager Service

The Platform Manager acts as the central control plane for the entire platform:

- **State Management**: Maintains a database storing:
  - Application configurations
  - Deployment locations
  - Service metadata
- **Location Service**: Provides URL resolution for the Builder App to locate specific agents
- **Orchestration Coordination**: Interfaces with the hosting cell's Nomad orchestrator

### 3. Hosting Cell

The Hosting Cell is a self-contained infrastructure unit that hosts customer services.

#### Infrastructure Components

| Component | Function |
|-----------|----------|
| **Ingress Tier** | Routes external traffic to appropriate customer services |
| **Nomad** | Orchestrates container deployment and lifecycle management |
| **Queue Worker** | Processes create/update/delete operations from SQS |
| **Ceph Network FS** | Provides persistent storage across containers |
| **MySQL Servers** | Database infrastructure for customer applications |

## Customer Service Architecture

Each customer service runs as a Nomad job consisting of multiple Docker containers:

```mermaid
graph LR
    subgraph "Customer Service (Nomad Job)"
        subgraph "Agent Container"
            A[Agent<br/>Domain: *.agents.example.com]
            A --> |Controls| DC1
            A --> |Controls| DC2
            A --> |Controls| PC1
            A --> |Controls| PC2
        end
        
            DC1[Dev App 1<br/>Domain: *.dev.example.com]
            DC2[Dev App 2<br/>Domain: *.dev.example.com]
        
            PC1[Prod App 1<br/>Domain: *.prod.example.com<br/>or custom domain]
            PC2[Prod App 2<br/>Domain: *.prod.example.com<br/>or custom domain]
    end
```

### Container Types

#### 1. Agent Container
- **Purpose**: Central management interface for the customer service
- **Capabilities**:
  - Restart other containers
  - Execute tasks on dev/prod containers
  - Service registration with ingress
- **Domain**: Random subdomain (structure TBD)
- **Mount Points**:
  - `/apps` - Shared ephemeral volume
  - `/git` - Customer's Ceph directory
  - `/assets` - Customer's assets directory

#### 2. Development Containers
- **Purpose**: Run customer applications in development mode
- **Quantity**: One per application
- **Domain**: Random subdomain on dedicated development domain
- **Mount Points**:
  - `/app` - Maps to `/apps/{identifier}` from shared volume
  - `/git` - Maps to `/git/{identifier}` from Ceph
  - `/assets/{identifier}` - Customer's app-specific assets

#### 3. Production Containers
- **Purpose**: Run customer applications in production mode
- **Quantity**: One per deployed application
- **Domain**: 
  - Default: Random subdomain on production domain
  - Optional: Customer-specified custom domain
- **Mount Points**:
  - `/app` - Maps to `/apps/{identifier}` from shared volume
  - `/git` - Maps to `/git/{identifier}` from Ceph
  - `/assets/{identifier}` - Customer's app-specific assets

## Storage Architecture

```mermaid
graph TB
    subgraph "Storage Layers"
        subgraph "Ephemeral Storage (Nomad Volume)"
            EV[Shared Volume]
            EV --> |/apps| AG[Agent]
            EV --> |/apps/app1 → /app| D1[Dev Container 1]
            EV --> |/apps/app2 → /app| D2[Dev Container 2]
            EV --> |/apps/app1 → /app| P1[Prod Container 1]
        end
        
        subgraph "Persistent Storage (Ceph)"
            subgraph "Git Storage"
                GIT[Customer Git Dir]
                GIT --> |/git| AG
                GIT --> |/git/app1 → /git| D1
                GIT --> |/git/app2 → /git| D2
            end
            
            subgraph "Assets Storage"
                ASSETS[Customer Assets Dir]
                ASSETS --> |/assets| AG
                ASSETS --> |/assets/app1| D1
                ASSETS --> |/assets/app2| D2
            end
        end
    end
```

### Storage Types

#### Ephemeral Storage
- **Technology**: Nomad volumes
- **Purpose**: Temporary runtime data and application code
- **Lifecycle**: Persists for the duration of the Nomad job

#### Persistent Storage
- **Technology**: Ceph network filesystem
- **Purpose**: Long-term storage of:
  - Git repositories
  - Customer assets
  - Application data
- **Lifecycle**: Persists beyond container restarts and redeployments

## Workflow Operations

### Application Deployment Flow

```mermaid
sequenceDiagram
    participant User
    participant AiroBuilder
    participant PlatformMgr
    participant QueueWorker
    participant Nomad
    participant Agent
    
    User->>AiroBuilder: Deploy Application
    AiroBuilder->>PlatformMgr: Request Deployment
    PlatformMgr->>PlatformMgr: Update Database
    PlatformMgr->>QueueWorker: Queue Deployment Task
    QueueWorker->>Nomad: Create/Update Job
    Nomad->>Agent: Start Containers
    Agent->>Agent: Mount Volumes
    Agent->>Agent: Register with Ingress
    Agent-->>PlatformMgr: Report Status
    PlatformMgr-->>AiroBuilder: Deployment Complete
    AiroBuilder-->>User: Success Notification
```

### Service Discovery Flow

```mermaid
sequenceDiagram
    participant AiroBuilder
    participant PlatformMgr
    participant Database
    participant Agent
    
    AiroBuilder->>PlatformMgr: Request Agent Location
    PlatformMgr->>Database: Query Service Registry
    Database-->>PlatformMgr: Return Agent URL
    PlatformMgr-->>AiroBuilder: Agent URL
    AiroBuilder->>Agent: Direct Communication
    Agent-->>AiroBuilder: Response
```

## Domain Structure

| Container Type | Domain Pattern | Example |
|---------------|---------------|---------|
| Agent | `{random}.agents.platform.com` | `abc123.agents.platform.com` |
| Development | `{random}.dev.platform.com` | `xyz789.dev.platform.com` |
| Production (Default) | `{random}.prod.platform.com` | `def456.prod.platform.com` |
| Production (Custom) | Customer-specified | `app.customer.com` |

*Note: Exact domain structures are to be defined*

## Security Considerations

### Network Isolation
- Each customer service runs in isolated Nomad jobs
- Container-to-container communication restricted within customer boundaries
- Ingress tier provides traffic filtering and routing

### Access Control
- Agent containers have elevated permissions within their service boundary
- Dev/Prod containers have restricted permissions
- File system access controlled through mount point isolation

### Data Isolation
- Customer data segregated in Ceph using unique directories
- Database isolation per customer app, by provisioning a user and database per app
- Ephemeral volumes restricted to single customer service

---

*Document Version: 1.0*  
*Last Updated: 2025-08-22
*Status: Initial Draft*
