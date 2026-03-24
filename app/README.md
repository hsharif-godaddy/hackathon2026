# Airo Builder

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

The application uses the V2 control plane (mgmt-airo API) for all site management operations. For local development, the `local-control-plane` Go service provides a compatible API backed by SQLite + Docker compose.

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
│   │   │   ├── apps/            # App lifecycle API
│   │   │   ├── auth/            # Authentication endpoints
│   │   │   ├── config/          # Configuration endpoints
│   │   │   ├── health/          # Health check
│   │   │   ├── marketing/       # Marketing calendar API
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
│   │   ├── control-plane/       # V2 control plane adapter (mgmt-airo)
│   │   ├── shadcn/              # UI component library
│   │   └── ...                  # Auth, features, paywall, marketing, etc.
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
- **V2 Control Plane**: All site management via mgmt-airo API (or local-control-plane for local dev)
- **Real-time Communication**: WebSocket v2 protocol
- **Template Composition**: Dynamic template system with version detection
