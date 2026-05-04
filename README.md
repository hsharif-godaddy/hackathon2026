# Airo Builder

## The Complete AI-Powered Application Development Platform

Airo Builder is a revolutionary platform that combines the power of artificial intelligence with enterprise-grade hosting and development tools to help you build, deploy, and maintain any application you can imagine.

## 🎯 Vision

Create an AI App builder that is flexible enough to build any website or app you can imagine, while including all the features needed to successfully run that app in production.

## 🤖 Core Philosophy

Instead of just building demos, Airo AI Builder focuses on creating **real, production-ready applications** with a comprehensive suite of AI agents that handle every aspect of the development lifecycle.

## 🛠️ Quick Start

Use the following link to request access to either the `JOMAX\DEV-Airo-Builders` or `JOMAX\SRE-Airo-Builders` AD Groups. This will give you access to our PCP and AWS accounts.

<https://godaddy.service-now.com/esc?id=sc_cat_item&sys_id=3bcb6decdb0f4dd0f1e6eba813961906>

Additionally, you will want to make sure you request access to the GitHub orgs `JOMAX\gdcorp-partners` and `JOMAX\gdcorp-commerce` so that you can make PRs and run the GitHub Actions.

After verifying access via Okta to the AWS account `GD-AWS-USA-GD-AiroBuilde-Dev-Private`, you can then proceed with the setup.

```bash
# Clone the repository
git clone <repository-url>
cd airo-app-builder

# One command to set up and run everything
pnpm run dev
```

`pnpm run dev` launches the **Dev Runner** TUI which automatically runs preflight checks, detects missing tools or configuration, and offers to fix them inline — no separate setup step needed. On subsequent runs, checks pass in ~2 seconds and auto-advance to launching services.

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

### Thought Exercises (Exploratory)

> These documents explore potential future capabilities. They are not committed designs.

- [Platform Architecture](./docs/thought-exercise/platform-architecture.md) - Platform microservices concepts
- [Architecture Diagrams](./docs/thought-exercise/architecture-diagrams.md) - Architecture diagrams
- [Tech Stack](./docs/thought-exercise/tech-stack.md) - Tech stack philosophy
- [Development Features](./docs/thought-exercise/development-features.md) - Standardized tech stack
- [Agent Features](./docs/thought-exercise/agent-features.md) - Specialized AI agent suite
- [AI Features](./docs/thought-exercise/ai-features.md) - Managed AI capabilities
- [Hosting Features](./docs/thought-exercise/hosting-features.md) - Enterprise hosting features
- [Security Features](./docs/thought-exercise/security-features.md) - AI security analyst

## 🎯 Target Use Cases

- **Content Management Systems** - API-first CMS solutions
- **AI Support Chat Bots** - LLM-powered customer service
- **Custom Business Applications** - Auto-CRUD backends and workflows
- **E-commerce Platforms** - Full-stack online stores
- **SaaS Applications** - Multi-tenant software solutions

---

_Built with ❤️ by the Airo team_
