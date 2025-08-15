# Airo AI Builder Platform Architecture

This document describes the architecture of the Airo AI Builder platform - the system that enables customers to build and manage applications using AI agents.

## 🏗️ System Overview

The Airo AI Builder platform consists of multiple interconnected services that work together to provide a comprehensive application development and hosting experience. The platform is designed to handle the complete lifecycle from customer onboarding through application development to production deployment.

## 🎯 Architecture Principles

- **Microservices Architecture**: Loosely coupled services with clear responsibilities
- **Event-Driven**: Services communicate through events for better scalability
- **Multi-Tenant**: Support multiple customers with isolated environments
- **Container-Based**: Docker containers for consistent deployment and scaling
- **GitOps**: Git-based workflow for application management
- **Security-First**: Authentication and authorization at every layer

---

## 🧩 Core Services

### 1. Frontend Application

**Technology Stack**: Next.js + React + TypeScript + Vitest

#### Purpose
- Customer dashboard and management interface
- Application creation and configuration
- Integration with AI agents
- User authentication and account management

#### Key Features
- **Customer Dashboard**: Overview of applications and usage
- **Application Management**: Create, configure, and monitor applications
- **Agent Interface**: Real-time communication with AI agents
- **Billing Integration**: Usage tracking and subscription management
- **Team Collaboration**: Multi-user access and permissions

#### Database
- **Technology**: MySQL
- **Purpose**: Store customer data, application metadata, and platform state
- **Schema Areas**:
  - Customer accounts and authentication
  - Application configurations and metadata
  - Usage tracking and billing information
  - Team members and permissions
  - Agent interaction logs

---

### 2. Entitlement Worker

**Technology**: Node.js/Python microservice

#### Purpose
Process subscription and billing events from GoDaddy's Chatterbox service to manage customer entitlements and access rights.

#### Event Sources
- **GoDaddy Chatterbox**: Via AWS EventBridge
- **Event Types**:
  - Product purchases
  - Subscription upgrades/downgrades
  - Cancellations and renewals
  - Trial activations

#### Responsibilities
- **Event Processing**: Consume and validate entitlement events
- **Access Management**: Grant/revoke customer access based on subscription status
- **Billing Sync**: Synchronize billing information with customer records
- **Notifications**: Send notifications about subscription changes
- **Audit Trail**: Log all entitlement changes for compliance

#### Integration Points
- **AWS EventBridge**: Event consumption
- **MySQL Database**: Update customer entitlements
- **Notification Service**: Customer communications
- **Audit Service**: Compliance logging

---

### 3. Platform Management Service

**Technology**: Node.js/Go microservice

#### Purpose
Manages the hosting platform infrastructure, including site provisioning, configuration management, and platform feature access.

#### Core Responsibilities

##### Site Provisioning
- **New Site Creation**: Provision hosting environment for new applications
- **Resource Allocation**: Assign compute, storage, and network resources
- **Environment Setup**: Configure development, staging, and production environments
- **Domain Management**: Assign temporary and custom domains

##### Configuration Management
- **Environment Variables**: Manage secure configuration across environments
- **Service Configuration**: Configure databases, caching, and external integrations
- **Scaling Configuration**: Set auto-scaling rules and resource limits
- **Security Policies**: Apply security configurations and access controls

##### Platform Features
- **Backup Management**: Schedule and manage automated backups
- **Restore Operations**: Handle backup restoration requests
- **Monitoring Setup**: Configure application and infrastructure monitoring
- **SSL Certificates**: Manage SSL certificate provisioning and renewal

#### Integration Points
- **Customer Environment Backend**: Coordinate with git repositories
- **Agent Mapping Service**: Register agent endpoints
- **MySQL Database**: Store platform configuration
- **Cloud Providers**: Interface with hosting infrastructure

---

### 4. Customer Environment Backend

**Technology**: Git-based with Gitolite + Ceph filesystem

#### Purpose
Manages individual customer application repositories and provides isolated development environments with snapshot capabilities.

#### Architecture Components

##### Git Repository Management
- **Gitolite**: Git repository hosting and access control
- **Repository Structure**: One repository per customer application
- **Branch Strategy**: Development, staging, and production branches
- **Access Control**: Fine-grained permissions per repository

##### Storage Infrastructure
- **Ceph Filesystem**: Distributed storage for repositories and snapshots
- **High Availability**: Redundant storage across multiple nodes
- **Scalability**: Horizontally scalable storage cluster
- **Performance**: SSD-backed storage pools for active development

##### Snapshot Management
- **Datastore Snapshots**: Point-in-time snapshots of databases and storage
- **File System Snapshots**: Complete application file system snapshots
- **Incremental Backups**: Efficient storage using incremental snapshots
- **Restore Capabilities**: Fast restoration from any snapshot point

#### Key Features
- **Environment Isolation**: Complete isolation between customer environments
- **Version Control**: Full git history and branching capabilities
- **Snapshot Scheduling**: Automated snapshot creation and retention
- **Data Seeding**: Populate environments from production snapshots
- **Migration Support**: Move environments between infrastructure

#### Integration Points
- **Platform Management Service**: Receive provisioning requests
- **Development Container Service**: Provide repository access
- **Agent Service**: File system access for code generation
- **Backup Service**: Coordinate snapshot operations

---

### 5. Development Container Service

**Technology**: Docker + Kubernetes

#### Purpose
Manages ephemeral development containers that provide isolated development environments for customers and AI agents.

#### Container Management
- **On-Demand Provisioning**: Spin up containers as needed
- **Resource Limits**: CPU, memory, and storage quotas per container
- **Network Isolation**: Secure networking between containers
- **Automatic Cleanup**: Remove idle containers to optimize resources

#### Development Environment
- **Standardized Stack**: Pre-configured with AIRO tech stack
- **Git Integration**: Access to customer repositories
- **Development Tools**: IDEs, debuggers, and development utilities
- **Hot Reload**: Live code reloading for development

#### Security Features
- **Sandboxing**: Isolated execution environment
- **Resource Monitoring**: Track resource usage and enforce limits
- **Access Control**: Authentication required for container access
- **Audit Logging**: Log all container activities

#### Integration Points
- **Customer Environment Backend**: Access git repositories
- **Agent Mapping Service**: Register container endpoints
- **Agent Service**: Provide development environment for agents
- **Platform Management Service**: Coordinate with infrastructure

---

### 6. Agent Mapping Service

**Technology**: Node.js/Go microservice

#### Purpose
Provides service discovery and authentication for AI agents, managing the mapping between customers, applications, environments, and their corresponding agent instances.

#### Core Functionality

##### Service Discovery
- **Agent Registration**: Register agent service instances
- **Health Monitoring**: Monitor agent service health and availability
- **Load Balancing**: Distribute requests across healthy agent instances
- **Failover**: Automatic failover to backup agent instances

##### URL Mapping
- **Dynamic Routing**: Route requests to appropriate agent instances
- **Environment Mapping**: Map customer/app/environment to specific agents
- **Version Management**: Support multiple agent versions simultaneously
- **Custom Endpoints**: Support for specialized agent endpoints

##### Authentication & Authorization
- **JWT Token Generation**: Create time-limited access tokens
- **Token Validation**: Validate and refresh authentication tokens
- **Permission Management**: Enforce access control based on customer entitlements
- **Session Management**: Track active agent sessions

#### Security Features
- **Token Expiration**: Automatic token expiration and refresh
- **Rate Limiting**: Prevent abuse and ensure fair usage
- **IP Whitelisting**: Restrict access to authorized networks
- **Audit Logging**: Complete audit trail of agent access

#### Integration Points
- **Frontend Application**: Provide agent URLs and tokens
- **Agent Service**: Register and communicate with agent instances
- **Entitlement Worker**: Validate customer access rights
- **Platform Management Service**: Coordinate agent deployments

---

### 7. Agent Service

**Technology**: Python/Node.js + Docker

#### Purpose
Hosts the AI agents that customers interact with to build applications. Each customer application gets its own agent service instance with access to the local application environment.

#### Deployment Model
- **Per-Application Deployment**: One agent service instance per customer application
- **Co-located Containers**: Runs alongside application containers
- **Shared File System**: Direct access to application file system
- **Local Development**: Access to local development environment

#### AI Agent Components

##### Product Manager Agent
- **Requirements Gathering**: Interview customers and define features
- **User Story Creation**: Generate detailed user stories and acceptance criteria
- **Feature Prioritization**: Help prioritize features based on business value
- **Scope Management**: Prevent scope creep and maintain focus

##### Software Architect Agent
- **Technology Selection**: Choose appropriate technologies from AIRO stack
- **System Design**: Create scalable and maintainable architectures
- **API Design**: Define clean API contracts and interfaces
- **Integration Planning**: Plan third-party integrations and services

##### Data Architect Agent
- **Database Design**: Create optimized Prisma schemas
- **Data Modeling**: Design efficient data relationships
- **Migration Planning**: Plan and execute database migrations
- **Performance Optimization**: Optimize queries and database performance

##### Lead Developer Agent
- **Code Generation**: Write TypeScript/React/Next.js code
- **Code Review**: Review and improve existing code
- **Testing**: Create comprehensive test suites with Vitest
- **Documentation**: Generate code documentation and API docs

##### Security Analyst Agent
- **Vulnerability Scanning**: Identify security issues in code
- **Security Reviews**: Review code for security best practices
- **Compliance**: Ensure compliance with security standards
- **Remediation**: Suggest and implement security fixes

##### Site Reliability Engineer Agent
- **Monitoring Setup**: Configure application monitoring
- **Performance Analysis**: Analyze and optimize application performance
- **Incident Response**: Respond to and resolve production issues
- **Maintenance**: Perform routine maintenance and updates

#### Integration Capabilities
- **File System Access**: Direct read/write access to application files
- **Git Operations**: Commit changes and manage branches
- **Database Access**: Connect to application databases
- **External APIs**: Integrate with third-party services
- **Platform APIs**: Access AIRO platform services

#### Communication
- **WebSocket**: Real-time communication with frontend
- **REST API**: Synchronous API endpoints for specific operations
- **Event Streaming**: Asynchronous event processing
- **Agent Collaboration**: Inter-agent communication and coordination

#### Integration Points
- **Agent Mapping Service**: Register service instance and receive requests
- **Customer Environment Backend**: Access git repositories and file systems
- **Development Container Service**: Run within development containers
- **Platform Management Service**: Access platform configuration
- **Frontend Application**: Real-time communication with customers

---

## 🔄 Service Interactions

### Customer Onboarding Flow
1. **Frontend Application** receives new customer registration
2. **Entitlement Worker** processes subscription events from GoDaddy
3. **Platform Management Service** provisions hosting infrastructure
4. **Customer Environment Backend** creates git repository and initial snapshots
5. **Agent Service** instance is deployed and registered
6. **Agent Mapping Service** provides access URLs and authentication tokens

### Application Development Flow
1. **Frontend Application** customer initiates new application
2. **Development Container Service** spins up development environment
3. **Agent Service** agents collaborate to gather requirements and design architecture
4. **Customer Environment Backend** stores code changes in git repository
5. **Platform Management Service** manages environment configurations
6. **Agent Mapping Service** maintains access control and session management

### Deployment Flow
1. **Agent Service** prepares application for deployment
2. **Customer Environment Backend** creates deployment snapshot
3. **Platform Management Service** deploys to staging/production environment
4. **Hosting Infrastructure** serves the deployed application
5. **Monitoring** tracks application performance and health

---

## 🔐 Security Architecture

### Authentication & Authorization
- **Multi-layer Authentication**: Authentication at service and agent levels
- **JWT Tokens**: Time-limited tokens for service access
- **Role-Based Access**: Granular permissions based on customer entitlements
- **API Key Management**: Secure API key storage and rotation

### Network Security
- **Service Mesh**: Secure service-to-service communication
- **TLS Encryption**: All communications encrypted in transit
- **Network Segmentation**: Isolated networks for different service tiers
- **Firewall Rules**: Strict firewall rules limiting access

### Data Security
- **Encryption at Rest**: All data encrypted when stored
- **Database Security**: Secure database access with connection pooling
- **Secret Management**: Centralized secret storage and distribution
- **Audit Logging**: Comprehensive audit logs for compliance

---

## 📊 Monitoring & Observability

### Application Monitoring
- **Health Checks**: Service health monitoring and alerting
- **Performance Metrics**: Response times, throughput, and error rates
- **Resource Usage**: CPU, memory, and storage utilization
- **Custom Metrics**: Business-specific metrics and KPIs

### Logging
- **Centralized Logging**: Structured logs aggregated across all services
- **Log Analysis**: Automated log analysis and alerting
- **Audit Trails**: Complete audit trails for compliance
- **Debug Information**: Detailed debug information for troubleshooting

### Alerting
- **Real-time Alerts**: Immediate notification of critical issues
- **Escalation Procedures**: Automated escalation for unresolved issues
- **Integration**: Alerts integrated with on-call systems
- **Custom Thresholds**: Configurable alerting thresholds

This architecture provides a scalable, secure, and maintainable platform for building and hosting applications with AI assistance, while ensuring excellent developer experience and operational reliability.
