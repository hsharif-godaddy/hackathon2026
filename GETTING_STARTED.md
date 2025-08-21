# 🚀 Getting Started - Airo App Builder

Quick setup guide to run the AI builder locally in under 5 minutes.

## Prerequisites
- Node.js 18+ 
- OpenAI API Key

## Setup

### 1. Install Dependencies
```bash
# Install agents backend
cd agents
npm install

# Install main app
cd ../app
npm install

# Install app template dependencies (REQUIRED for creating new apps)
cd ../app-templates/v3
npm install
cd ../..
```

### 2. Configure Environment
Create `agents/.env`:
```bash
OPENAI_API_KEY=your_openai_api_key_here
PORT=4000
APPS_BASE_DIR=/tmp/apps
APP_TEMPLATE_DIR=../app-templates/v3
```

### 3. Start Services
**Terminal 1 - Agents Backend:**
```bash
cd agents
npm run dev
```

**Terminal 2 - Main App:**
```bash
cd app
npm run dev
```

## Access

- **AI Builder**: http://localhost:3000
- **Agents API**: http://localhost:4000
- **Health Check**: http://localhost:4000/health

## Test
```bash
# List available agents
curl http://localhost:4000/agents

# Chat with an agent
curl -X POST http://localhost:4000/agent/example-agent/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello!"}'
```

## What's Running

- **Agents Backend** (port 4000): AI agents with chat APIs
- **Main App** (port 3000): Next.js builder interface
- **Database**: SQLite (auto-created)
- **File Storage**: Generated apps in `/tmp/apps`

## Next Steps

1. Visit http://localhost:3000 to start building
2. Explore the agent chat interface
3. Try generating a simple app
4. Check the API documentation at http://localhost:4000

## Troubleshooting

### "Starting Development Server" gets stuck or fails

**Issue**: The development server fails to start for new apps  
**Cause**: App template dependencies are not installed  
**Solution**: Install template dependencies:
```bash
cd app-templates/v3
npm install
```

### Template directory errors

**Issue**: "Template directory not found" warnings  
**Cause**: The `APP_TEMPLATE_DIR` environment variable points to wrong location  
**Solution**: Ensure your `agents/.env` has:
```bash
APP_TEMPLATE_DIR=../app-templates/v3
```

### Port conflicts

**Issue**: Development servers fail to start due to port conflicts  
**Solution**: The system automatically assigns ports starting from 5001. Kill any conflicting processes:
```bash
lsof -ti:5001 | xargs kill -9
```

---

Need help? Check the full [README.md](./README.md) or [documentation](./docs/).
