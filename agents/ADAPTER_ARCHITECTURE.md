# 🏗️ Adapter Pattern Architecture

## Overview

The Airo App Builder now uses the **Adapter Pattern** to support multiple deployment modes:
- **Local Mode**: Traditional Node.js processes (default)
- **Docker Mode**: Docker containers for all templates
- **Future**: Cloud providers (AWS, GCP, Azure)

## 🎯 Architecture

```
┌─────────────────┐
│  AppRepository  │  ← Database & App Lifecycle
│  (Clean)        │
└─────────┬───────┘
          │
    ┌─────▼─────┐
    │ Adapter   │  ← Deployment Strategy Selector
    │ Factory   │
    └─────┬─────┘
          │
    ┌─────▼─────┬─────────────────┐
    │           │                 │
┌───▼───┐  ┌────▼────┐    ┌──────▼──────┐
│Local  │  │ Docker  │    │   Cloud     │
│Service│  │ Service │    │  Service    │
│       │  │         │    │ (Future)    │
└───────┘  └─────────┘    └─────────────┘
```

## 📂 File Structure

```
agents/src/
├── adapters/
│   ├── interfaces/
│   │   ├── IAppAdapter.ts      # Main adapter interface
│   │   ├── common.ts           # Types & config resolver
│   │   └── index.ts            # Public exports
│   ├── services/
│   │   ├── DockerAppService.ts # Docker deployment
│   │   ├── LocalAppService.ts  # Local process deployment
│   │   └── docker-container-manager.ts  # Docker manager
│   ├── AppAdapterFactory.ts    # Strategy factory
│   └── index.ts                # Main exports
└── database/repositories/
    └── AppRepository.ts        # Clean interface
```

## 🔄 Responsibilities

### AppRepository (Database & App Lifecycle)
- ✅ **Database operations**: create, read, update, delete records
- ✅ **App creation**: directory setup, template copying, git init
- ✅ **Port management**: assign ports to apps
- ✅ **Dependency installation**: npm/pnpm install
- 🔄 **Delegates deployment** to adapters

### Deployment Adapters (Runtime Operations)
- ✅ **Start/Stop apps**: processes or containers
- ✅ **Status monitoring**: running, stopped, error states
- ✅ **Cleanup operations**: orphan recovery
- ✅ **Advanced features**: logs, rebuild (when supported)

## ⚙️ Configuration

### Environment Variables

```bash
# Local Mode (Default)
DOC_APPS=false
# Uses LocalAppService with Node.js processes

# Docker Mode  
DOC_APPS=true # or unset
# Uses DockerAppService with containers
```

### Automatic Selection

```typescript
// The system automatically chooses the right adapter:
const appRepo = new AppRepository();
await appRepo.initialize(); // Selects Local or Docker based on DOC_APPS

// All operations work the same regardless of mode:
await appRepo.create({ name: "My App" });
await appRepo.startServer(appId);
await appRepo.stopServer(appId);
```

## 🧪 Testing Both Modes

### Test Local Mode
```bash
cd agents
# set DOC_APPS=false in agents/.env
npm run dev

# Should show: "Initializing AppRepository with Local deployment..."
```

### Test Docker Mode
```bash
cd agents
# DOC_APPS is unset (defaults to true)
npm run dev

# Should show: "Initializing AppRepository with Docker deployment..."
```

### API Compatibility
```bash
# These work in BOTH modes:
POST /apps                    # Create app
GET /apps                     # List apps  
POST /apps/:id/stop           # Stop app
POST /apps/:id/restart        # Restart app
DELETE /apps/:id              # Delete app

# These work ONLY in Docker mode (DOC_APPS=true):
GET /apps/:id/container/status    # Container status
POST /apps/:id/container/rebuild  # Rebuild container
GET /apps/:id/container/logs      # Container logs
```

## 🔮 Future Extensibility

### Adding Cloud Support
```typescript
// Easy to add new adapters:
export class CloudAppService implements IAppAdapter {
  // AWS ECS, Google Cloud Run, Azure Container Apps, etc.
  async startApp(appId: string): Promise<boolean> {
    // Cloud-specific deployment logic
  }
}

// Update factory:
case 'cloud':
  return new CloudAppService();
```

### Configuration
```bash
DOC_APPS=aws     # Future: AWS deployment
DOC_APPS=gcp     # Future: Google Cloud deployment  
DOC_APPS=azure   # Future: Azure deployment
```

## 🎯 Benefits

1. **🧹 Clean Separation**: Database logic separate from deployment logic
2. **🔄 Easy Switching**: Change deployment mode with one env var
3. **📦 Backwards Compatible**: Existing local mode unchanged
4. **🚀 Future-Ready**: Easy to add cloud providers
5. **🧪 Testable**: Each adapter can be tested independently
6. **🔧 Maintainable**: Single responsibility principle

## 🚨 Migration Guide

### From Existing Setup
- **No code changes needed!**
- Set `DOC_APPS=false` (or leave unset) → continues using local processes
- Set `DOC_APPS=true` → switches to Docker containers

### Template Support
- **v1 templates**: Local processes OR Docker (both supported)
- **v2 templates**: Local processes OR Docker (both supported)  
- **v3 templates**: Local processes OR Docker (both supported)

The adapter automatically detects template version and uses appropriate commands/configurations.

## 🎉 Ready to Use!

The new architecture is:
- ✅ **Backwards compatible** - existing local mode works unchanged
- ✅ **Docker ready** - all templates supported in containers
- ✅ **Future-proof** - easy to add cloud providers
- ✅ **Clean code** - separation of concerns
- ✅ **Environment driven** - one variable controls everything
