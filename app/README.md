# Airo App Builder

An AI-powered application development platform that combines artificial intelligence with enterprise-grade hosting and development tools, built with Next.js, TypeScript, and Tailwind CSS.

## Pages

### 🏠 Homepage (`/`)

- Landing page with hero section and examples
- Navigation to create new sites or browse existing ones
- Built with section showcasing platform capabilities
- Clean, modern design with UXCore design system

### 🏗️ Sites Management (`/sites`)

- View all user sites and their status
- Create new sites with initial prompts
- Site status tracking (creating, running, stopped, error)
- Quick actions for site management

### ⚡ Site Creation (`/create/[id]`)

- Real-time site creation progress tracking
- Animated phase progression with queuing system
- Background orb animations during creation
- Automatic redirect to development environment

### 💻 Development Environment (`/develop/[id]`)

- Full-featured IDE with Monaco editor
- Real-time chat interface with AI agents
- Live preview pane with hot reloading
- File tree navigation and git integration
- Plan tracking and progress monitoring
- Token usage tracking and analytics

### 🎨 Design Tools (`/design`, `/color-scheme`)

- Color scheme generation and customization
- Design guidance and component documentation
- Interactive design flows and questionnaires

### 📱 Apps Dashboard (`/apps`)

- Application management and deployment
- Server status monitoring and controls
- Integration with development workflow

### 🖼️ Gallery (`/gallery`)

- Showcase of example applications and templates
- Browse and discover different app types

## Design System

- **UXCore Components**: Comprehensive design system with consistent styling
- **Color Palette**: AI-themed gradients and semantic color tokens
- **Typography**: Hierarchical text system with proper contrast
- **Animations**: Framer Motion for smooth transitions and micro-interactions
- **Responsive**: Mobile-first design with Tailwind CSS utilities
- **Accessibility**: WCAG compliant components and interactions
- **Dark Mode**: System preference aware theming

## Development Workflow

1. **Site Creation**: User provides initial prompt, system creates project structure
2. **Template Application**: v8 template copied and configured for new app
3. **Agent Interaction**: AI agents help develop features through chat interface
4. **Live Development**: Real-time preview with hot reloading
5. **Version Control**: Automatic git integration and history tracking
6. **Deployment**: Seamless deployment to local or containerized environments

## Running the Application

```bash
# Install dependencies for all workspace packages
pnpm install

# Start development servers (requires OpenAI API key in agents/.env)
pnpm run dev                 # Start both services concurrently
# Or start individually:
pnpm run dev:agents         # Backend agents API (port 4000)
pnpm run dev:app            # Main Next.js app (port 3000)

# Build for production
pnpm run build

# For complete setup instructions, see GETTING_STARTED.md
```

The application supports two deployment modes:

- **Legacy Mode**: Uses local database + Nomad/SQS (default)
- **V2 Mode**: Uses mgmt-airo + mgmt-hosting APIs (test environment)

#### Setting Up V2 Mode for Testing

1. **Create/Edit `.env`:**

```bash
# Enable V2 Control Plane
USE_V2_CONTROL_PLANE=true

# V2 requires test SSO environment (not dev)
SSO_LOGIN_URL=https://sso.test-godaddy.com/login
SSO_LOGOUT_URL=https://sso.test-godaddy.com/logout
LOGIN_REDIRECT_URL=https://airo-builder.test-godaddy.com/
LOGOUT_REDIRECT_URL=https://airo-builder.test-godaddy.com/

# mgmt-airo API Configuration
MGMT_AIRO_BASE_URL=https://mgmt.nstk.net

# Authentication mode
AUTH_TYPE=jwt
```

2. **Restart your development server:**

```bash
pnpm run dev:app
```

3. **Verify V2 Mode is Active:**
   - Create a new site - it should have `controlPlane: "v2"`
   - Check browser console for `control-plane.factory` logs
   - The Publish button should appear on `/develop` pages for V2 sites

#### Features Available in V2 Mode

- ✅ **App Publish Button**: Trigger deployments from the UI
- ✅ **Deployment History**: View past deployments with React Query polling
- ✅ **Real-time Status**: Automatic polling during deployment (every 3s)
- ✅ **mgmt-airo Integration**: Uses production-like infrastructure APIs

#### Differences Between Modes

| Feature         | Legacy Mode                      | V2 Mode                  |
| --------------- | -------------------------------- | ------------------------ |
| Control Plane   | Database + Nomad                 | mgmt-airo + mgmt-hosting |
| SSO Environment | `sso.dev-godaddy.com`            | `sso.test-godaddy.com`   |
| Deployment      | Manual via SQS                   | API-triggered            |
| Publish Button  | Hidden                           | Visible for V2 sites     |
| Site Fields     | No `subscription_id`/`system_id` | Has V2 metadata          |

## Technology Stack

### Frontend (Port 3000)

- **Framework**: Next.js 14 with App Router
- **Language**: TypeScript
- **Styling**: Tailwind CSS + UXCore Design System
- **State Management**: Zustand stores
- **Real-time**: WebSocket connections
- **Editor**: Monaco Editor for code editing
- **Package Manager**: pnpm

### Backend (Port 4000)

- **Runtime**: Node.js with Express.js
- **Database**: SQLite with Prisma ORM
- **AI Integration**: OpenAI API
- **Agent System**: Custom AI agent registry
- **App Deployment**: Local processes or Docker containers
- **File Operations**: Secure file system tools

## Key Features

1. **AI-Powered Development**: Real-time chat with specialized AI agents
2. **Full Development Environment**: Monaco editor, file tree, live preview
3. **Site Lifecycle Management**: From creation to deployment
4. **Real-time Collaboration**: WebSocket-based streaming conversations
5. **Template System**: v8 templates with Vite + React + Node.js backend
6. **Process Management**: Automatic app lifecycle with health monitoring
7. **Git Integration**: Version control and history tracking
8. **Token Analytics**: Usage tracking and cost monitoring
9. **Responsive Design**: Works across all device sizes
10. **Design System**: UXCore components for consistent UI

## Project Structure

```
app/
├── src/
│   ├── app/                     # Next.js App Router pages
│   │   ├── api/                 # API routes
│   │   │   ├── accounts/        # Account management endpoints
│   │   │   ├── apps/            # App lifecycle API
│   │   │   ├── auth/            # Authentication endpoints
│   │   │   ├── config/          # Configuration endpoints
│   │   │   ├── health/          # Health check
│   │   │   ├── plans/           # Plan management
│   │   │   ├── servers/         # Server management API
│   │   │   └── sites/           # Site management API
│   │   ├── apps/                # Apps dashboard page
│   │   ├── color-scheme/        # Color scheme generation
│   │   ├── components/          # Homepage components
│   │   │   └── color/           # Color design flow components
│   │   ├── create/[id]/         # Site creation page
│   │   ├── design/              # Design tools page
│   │   ├── develop/[id]/        # Development environment
│   │   │   └── components/      # Development IDE components
│   │   ├── gallery/             # Template gallery
│   │   ├── sites/               # Sites management
│   │   └── test/                # Test pages
│   ├── components/              # Shared components
│   │   ├── auth/                # Authentication components
│   │   ├── development/         # Development utilities
│   │   ├── layout/              # Layout components
│   │   └── providers/           # React providers
│   ├── config/                  # Configuration files
│   ├── contexts/                # React contexts
│   ├── hooks/                   # Custom React hooks
│   ├── lib/                     # Core business logic
│   │   ├── account-adapters/    # Account service adapters
│   │   ├── database/            # Database services
│   │   ├── deployment/          # Deployment adapters
│   │   ├── dev-environment/     # Development environment management
│   │   ├── shadcn/              # UI component library
│   │   └── site-adapters/       # Site service adapters
│   ├── services/                # External service integrations
│   ├── stores/                  # Zustand state stores
│   ├── styles/                  # Global styles and design system
│   ├── types/                   # TypeScript type definitions
│   └── utils/                   # Utility functions
├── public/                      # Static assets
└── package.json                 # Dependencies and scripts
```

## Architecture

- **Multi-service Architecture**: Separate frontend and backend services
- **Agent Registry**: Pluggable AI agent system
- **Adapter Pattern**: Support for local and Docker deployment modes
- **Real-time Communication**: WebSocket v2 protocol
- **Database Persistence**: SQLite with foreign key constraints
- **Template Composition**: Dynamic template system with version detection
