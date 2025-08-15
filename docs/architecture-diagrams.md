# AIRO Architecture Diagrams

This document contains visual diagrams that illustrate the architecture of the AIRO AI Builder platform and its hosting environment.

## 🏗️ Platform Architecture Overview

This diagram shows the high-level architecture of the AIRO AI Builder platform, including all core services and their relationships.

```mermaid
graph TB
    subgraph "Customer Interface"
        UI[Frontend App<br/>Next.js + React + MySQL]
    end
    
    subgraph "Platform Services"
        EW[Entitlement Worker<br/>AWS EventBridge]
        PMS[Platform Management<br/>Service]
        AMS[Agent Mapping<br/>Service]
    end
    
    subgraph "Development Environment"
        CEB[Customer Environment<br/>Backend<br/>Gitolite + Ceph]
        DCS[Development Container<br/>Service<br/>Docker + K8s]
    end
    
    subgraph "AI Agents"
        AS[Agent Service<br/>Per Application<br/>Co-located with App]
        PM[Product Manager]
        SA[Software Architect]
        DA[Data Architect]
        LD[Lead Developer]
        SEC[Security Analyst]
        SRE[Site Reliability Engineer]
    end
    
    subgraph "External Services"
        GD[GoDaddy Chatterbox]
        EB[AWS EventBridge]
        HOSTING[Production Hosting<br/>Environment]
    end
    
    %% Customer Interface Connections
    UI --> PMS
    UI --> AMS
    
    %% Entitlement Flow
    GD --> EB
    EB --> EW
    EW --> UI
    
    %% Platform Management Flow
    PMS --> CEB
    PMS --> DCS
    PMS --> HOSTING
    
    %% Development Flow
    CEB --> DCS
    DCS --> AS
    
    %% Agent Service
    AS --> PM
    AS --> SA
    AS --> DA
    AS --> LD
    AS --> SEC
    AS --> SRE
    
    %% Agent Mapping
    AMS --> AS
    UI --> AMS
    
    %% File System Access
    AS -.-> CEB
    AS -.-> HOSTING
    
    style UI fill:#e1f5fe
    style AS fill:#f3e5f5
    style CEB fill:#e8f5e8
    style HOSTING fill:#fff3e0
```

## 🌐 Production Hosting Architecture

This diagram illustrates the production hosting environment where customer applications are deployed and served globally.

```mermaid
graph TB
    subgraph "Global Infrastructure"
        subgraph "US East Region"
            USE_LB[Load Balancer]
            USE_K8S[Kubernetes Cluster]
            USE_DB[(PostgreSQL)]
            USE_REDIS[(Redis)]
        end
        
        subgraph "EU West Region"
            EUW_LB[Load Balancer]
            EUW_K8S[Kubernetes Cluster]
            EUW_DB[(PostgreSQL)]
            EUW_REDIS[(Redis)]
        end
        
        subgraph "Asia Pacific Region"
            AP_LB[Load Balancer]
            AP_K8S[Kubernetes Cluster]
            AP_DB[(PostgreSQL)]
            AP_REDIS[(Redis)]
        end
    end
    
    subgraph "Edge Network"
        CDN[Global CDN<br/>200+ Edge Locations]
        WAF[Web Application<br/>Firewall]
    end
    
    subgraph "Customer Applications"
        APP1[Customer App 1<br/>Next.js Container]
        APP2[Customer App 2<br/>Next.js Container]
        APP3[Customer App 3<br/>Next.js Container]
    end
    
    subgraph "Storage Layer"
        S3[Object Storage<br/>S3 Compatible]
        BACKUP[Backup Storage<br/>Cross-Region]
        PV[Persistent Volumes<br/>SSD Block Storage]
    end
    
    %% Traffic Flow
    USER[Users] --> CDN
    CDN --> WAF
    WAF --> USE_LB
    WAF --> EUW_LB
    WAF --> AP_LB
    
    %% Regional Deployment
    USE_LB --> USE_K8S
    EUW_LB --> EUW_K8S
    AP_LB --> AP_K8S
    
    %% Application Deployment
    USE_K8S --> APP1
    USE_K8S --> APP2
    EUW_K8S --> APP3
    
    %% Data Connections
    APP1 --> USE_DB
    APP1 --> USE_REDIS
    APP2 --> USE_DB
    APP2 --> USE_REDIS
    APP3 --> EUW_DB
    APP3 --> EUW_REDIS
    
    %% Storage Connections
    APP1 --> S3
    APP2 --> S3
    APP3 --> S3
    USE_K8S --> PV
    EUW_K8S --> PV
    
    %% Backup Replication
    USE_DB -.-> BACKUP
    EUW_DB -.-> BACKUP
    AP_DB -.-> BACKUP
    
    style CDN fill:#e1f5fe
    style USE_K8S fill:#e8f5e8
    style EUW_K8S fill:#e8f5e8
    style AP_K8S fill:#e8f5e8
    style APP1 fill:#f3e5f5
    style APP2 fill:#f3e5f5
    style APP3 fill:#f3e5f5
```

## 🔄 System Flow Diagram

This sequence diagram shows the typical flow of interactions from customer onboarding through application development to deployment.

```mermaid
sequenceDiagram
    participant C as Customer
    participant UI as Frontend App
    participant PMS as Platform Management
    participant CEB as Customer Environment
    participant DCS as Container Service
    participant AMS as Agent Mapping
    participant AS as Agent Service
    participant HOST as Hosting Environment
    
    %% Customer Onboarding
    Note over C,HOST: Customer Onboarding Flow
    C->>UI: Create Account & Subscribe
    UI->>PMS: Request Environment Setup
    PMS->>CEB: Create Git Repository
    PMS->>DCS: Provision Container
    PMS->>AS: Deploy Agent Service
    AS->>AMS: Register Agent Instance
    AMS-->>UI: Return Agent URL & Token
    UI-->>C: Environment Ready
    
    %% Application Development
    Note over C,HOST: Application Development Flow
    C->>UI: Start New Application
    UI->>AMS: Get Agent Access
    AMS-->>UI: Agent URL & JWT Token
    UI->>AS: Connect to Agents
    AS->>AS: Product Manager<br/>Gathers Requirements
    AS->>AS: Software Architect<br/>Designs System
    AS->>AS: Data Architect<br/>Designs Database
    AS->>AS: Lead Developer<br/>Writes Code
    AS->>CEB: Commit Code Changes
    AS->>AS: Security Analyst<br/>Reviews Code
    AS-->>UI: Development Progress
    
    %% Deployment
    Note over C,HOST: Deployment Flow
    C->>UI: Deploy Application
    UI->>PMS: Request Deployment
    PMS->>CEB: Create Deployment Snapshot
    PMS->>HOST: Deploy to Production
    HOST-->>PMS: Deployment Complete
    PMS-->>UI: Application Live
    UI-->>C: Deployment Success
```

## 📊 Component Relationships

### Service Dependencies

#### Frontend Application
- **Depends on**: Platform Management Service, Agent Mapping Service
- **Provides**: Customer interface, dashboard, agent communication
- **Data Store**: MySQL for customer data and application metadata

#### Platform Management Service
- **Depends on**: Customer Environment Backend, Development Container Service
- **Provides**: Infrastructure provisioning, configuration management
- **Integration**: Cloud providers, hosting infrastructure

#### Agent Service
- **Depends on**: Customer Environment Backend (file system access)
- **Provides**: AI agent functionality, code generation, development assistance
- **Co-located**: Runs alongside customer applications

#### Customer Environment Backend
- **Depends on**: Ceph distributed storage
- **Provides**: Git repository management, snapshot capabilities
- **Technology**: Gitolite for git hosting, Ceph for distributed storage

### Data Flow Patterns

#### Event-Driven Architecture
- **Entitlement Events**: GoDaddy Chatterbox → AWS EventBridge → Entitlement Worker
- **Agent Communication**: Real-time WebSocket connections for agent interactions
- **Deployment Events**: Git commits trigger deployment pipelines

#### Request-Response Patterns
- **Agent Mapping**: Service discovery and authentication token generation
- **Platform Management**: Synchronous API calls for infrastructure operations
- **Frontend APIs**: REST APIs for customer dashboard functionality

### Security Boundaries

#### Authentication Layers
1. **Customer Authentication**: NextAuth.js in frontend application
2. **Service Authentication**: JWT tokens for service-to-service communication
3. **Agent Authentication**: Time-limited tokens from Agent Mapping Service

#### Network Segmentation
- **Public Subnet**: Load balancers and CDN endpoints
- **Private Subnet**: Application containers and services
- **Database Subnet**: Isolated database infrastructure
- **Management Subnet**: Platform management and monitoring services

## 🔐 Security Architecture

### Defense in Depth

#### Network Security
- **WAF**: Web Application Firewall for OWASP protection
- **DDoS Protection**: Multi-layer DDoS mitigation
- **VPC**: Virtual Private Cloud isolation
- **Security Groups**: Fine-grained firewall rules

#### Application Security
- **Container Security**: Image scanning and runtime protection
- **Secret Management**: Centralized secret storage and rotation
- **Encryption**: TLS in transit, encryption at rest
- **Access Control**: Role-based access control (RBAC)

#### Data Security
- **Database Encryption**: Encrypted database connections and storage
- **Backup Encryption**: Encrypted backups with cross-region replication
- **Key Management**: Secure key storage and rotation
- **Audit Logging**: Comprehensive audit trails

These diagrams provide a visual representation of the AIRO AI Builder platform architecture, showing how the various components work together to provide a comprehensive application development and hosting solution.
