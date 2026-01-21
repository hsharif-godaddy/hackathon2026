# Airo Builder

## The Complete AI-Powered Application Development Platform

Airo Builder is a revolutionary platform that combines the power of artificial intelligence with enterprise-grade hosting and development tools to help you build, deploy, and maintain any application you can imagine.

## 🎯 Vision

Create an AI App builder that is flexible enough to build any website or app you can imagine, while including all the features needed to successfully run that app in production.

## 🤖 Core Philosophy

Instead of just building demos, Airo AI Builder focuses on creating **real, production-ready applications** with a comprehensive suite of AI agents that handle every aspect of the development lifecycle.

## 🛠️ Quick Start

You first need to request access to the `GD-AWS-USA-GD-AiroBuilde-Dev-Private` AWS Account, as the app has to retrive secrets in order to run. Please request access in #airo-app-builder-dev. After verifying access via Okta, you can then proceed with the setup.

```bash
# Clone the repository
git clone <repository-url>
cd airo-ai-builder

# Enable Corepack (ensures consistent pnpm version)
corepack enable

# Run the setup utility
./setup.sh
```

The setup utility will guide you through:

- **Environment Configuration** - AI providers (AWS Bedrock/GoCode), authentication, database
- **Getty Images Setup** - Professional stock photos with AWS Secrets Manager integration
- **Docker Environment** - MySQL container and dependency verification
- **AWS SSO Integration** - Automatic credential setup for development services

For selective configuration or reconfiguration:

```bash
# From project root (recommended)
pnpm --filter airo-setup start

# Or from setup directory
cd setup && pnpm start
```

Choose "Selective Configuration" to configure individual components or check system status.

**[📖 Detailed Setup Guide →](./GETTING_STARTED.md)**

## 🚀 Key Features

### AI Agent Suite

- **Product Manager Agent** - Feature definition and requirements gathering
- **Software Architect** - Technology stack selection and system design
- **Data Architect** - Database schema design and data storage optimization
- **Lead Developer** - Collaborative coding with real-time feedback
- **Security Analyst** - Vulnerability detection and automatic remediation
- **Site Reliability Engineer** - Continuous monitoring and maintenance

### Enterprise Hosting

- Daily automated backups with snapshot support
- Temporary domains for testing
- One-click production deployments with auto-scaling
- Modern database support (MySQL, Redis, Vector DB, PostgreSQL)

### AI Integration

- Managed vector database for AI-powered features
- Direct access to Anthropic LLM models
- No additional service sign-ups required

### Security-First

- AI-powered security reviews
- Semgrep scanning integration
- Automated vulnerability remediation

### Developer Experience

- Best-in-class tech stack templates
- Pre-configured patterns for common use cases
- Open source library integration

## 📁 Documentation Structure

### Architecture

- [Platform Architecture](./docs/platform-architecture.md) - Core platform system architecture
- [Hosting Architecture](./docs/hosting-architecture.md) - Production hosting infrastructure
- [Architecture Diagrams](./docs/architecture-diagrams.md) - Visual system diagrams

### Technology & Development

- [Tech Stack](./docs/tech-stack.md) - Standardized TypeScript/React/Node.js stack
- [Development Features](./docs/development-features.md) - Templates and development tools

### Features & Capabilities

- [Agent Features](./docs/agent-features.md) - Detailed breakdown of AI agents
- [AI Features](./docs/ai-features.md) - AI integration for your applications
- [Image Search Feature](./docs/image-search-feature.md) - Web image search capabilities
- [Image Generation Feature](./docs/image-generation-feature.md) - AI-powered image creation
- [Getty Images Feature](./docs/getty-images-feature.md) - Professional stock photo integration
- [Hosting Features](./docs/hosting-features.md) - Infrastructure and deployment capabilities
- [Security Features](./docs/security-features.md) - Security scanning and protection

## 🎯 Target Use Cases

- **Content Management Systems** - API-first CMS solutions
- **AI Support Chat Bots** - LLM-powered customer service
- **Custom Business Applications** - Auto-CRUD backends and workflows
- **E-commerce Platforms** - Full-stack online stores
- **SaaS Applications** - Multi-tenant software solutions

---

_Built with ❤️ by the Airo team_
