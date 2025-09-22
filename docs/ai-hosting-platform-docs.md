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
            CA1[Customer App 1]
            CA2[Customer App 2]
            CAN[Customer App N]

            ING[Ingress Tier]
            CEPH[Ceph Network FS]
            MySQL[(MySQL Servers)]
        end
        
        QW --> SQS
        NOM --> CA1
        NOM --> CA2
        NOM --> CAN
        ING --> CA1
        ING --> CA2
        ING --> CAN

        CA1 --> CEPH
        CA2 --> CEPH
        CAN --> CEPH

        CA1 --> MySQL
        CA2 --> MySQL
        CAN --> MySQL
        
    end
    
    AB --> PM
    AB --> CA1
    PM --> SQS
    QW --> NOM
```

## Component Details

### 1. Airo Builder App

The Airo Builder App serves as the primary interface for users to interact with the platform. It provides:

- **Communication with Platform Manager**: Manages app state and deployment configurations
- **Direct Agent Communication**: Interfaces with customer app agents for app management
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

The hosting cell architecture can be found at [On-Prem Hosting Architecture](onprem-hosting-architecture.md).

## Storage Architecture

The storage architecture can be found at [Persistent Storage Architecture](persistent-storage-architecture.md).

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
- Each application runs in isolated Nomad jobs
- Container-to-container communication restricted within application boundaries
- Ingress tier provides traffic filtering and routing

### Access Control
- Agent containers have elevated permissions within their service boundary
- Dev/Prod containers have restricted permissions
- File system access controlled through mount point isolation

### Data Isolation
- Application data segregated in Ceph using unique directories
- Database isolation per customer app, by provisioning a user and database per app
- Ephemeral volumes restricted to single customer service

---

*Document Version: 1.0*
*Last Updated: 2025-08-22
*Status: Initial Draft*
