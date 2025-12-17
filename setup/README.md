# Airo Builder Setup Utilities

This directory contains setup utilities to help you configure and install the Airo Builder development environment.

## 🚀 Quick Start

### Option 1: Complete Setup (Recommended)
Run from the project root:
```bash
./setup.sh
```

### Option 2: Selective Configuration
For individual component setup or reconfiguration:
```bash
# From project root
pnpm --filter airo-setup start

# Or navigate to setup directory (dependencies already installed via workspace)
cd setup && pnpm start
```

Choose "Selective Configuration" to:
- 🔍 Check Docker Dependencies
- 📱 Configure App Environment (.env) 
- 🤖 Configure Agents Environment (.env)
- 🖼️ Configure Getty Images Proxy
- 🗄️ Check MySQL Container Status
- 🐳 Start MySQL Container
- 🔍 Check Current Configuration Status

### Option 3: Individual Scripts
```bash
# Check Node.js 22 and pnpm only
./check-deps.sh

# Run the full interactive setup
./run-setup.sh
```

## What the Setup Does

### Basic Dependencies (`check-deps.sh`)
- ✅ Verifies Node.js 22.x is installed
- ✅ Checks for pnpm package manager
- 📋 Provides Ubuntu installation instructions for missing deps

### Advanced Setup (`run-setup.sh` or `./setup.sh`)
- 🐳 **Docker Dependencies**: Checks Docker, Docker Compose, and daemon status
- 📝 **Environment Configuration**: Generates `.env` files with proper MySQL configuration
- 🤖 **AI Model Setup**: Configures AWS Bedrock, GoCode, or OpenAI as AI provider
- 🖼️ **Getty Images**: Sets up AWS proxy with Secrets Manager token integration
- 🔐 **AWS SSO**: Automatic credential setup for development services
- 🗄️ **MySQL Integration**: Sets up connection to MySQL container
- 🚀 **Container Management**: Optionally starts the MySQL container

## Generated Configuration

### App Environment (`app/.env`)
The setup generates a complete `.env` file for the main application including:

- **Database**: MySQL connection to Docker container
- **AI Provider**: AWS Bedrock or GoCode configuration
- **Security**: Auto-generated session and JWT secrets
- **Ports**: Development server configuration
- **Features**: Usage tracking, real-time collaboration settings

### MySQL Configuration
- **Container**: `airo-app-mysql` 
- **Host**: `localhost:3306`
- **Database**: `airo_app`
- **User**: `airo`
- **Password**: `airopassword`

## AI Model Providers

### AWS Bedrock
- Requires AWS credentials with Bedrock access
- Uses Claude models (anthropic.claude-3-sonnet-20240229-v1:0)
- Prompts for: AWS Region, Access Key ID, Secret Access Key

### GoCode
- Custom API endpoint configuration
- Prompts for: Base URL, API Key

### OpenAI
- Uses OpenAI's API endpoints
- Prompts for: API Key
- Supports GPT-4 and other OpenAI models

## Getty Images Configuration

The setup can automatically configure Getty Images integration:

### AWS Proxy Mode (Recommended)
- Uses Getty proxy running in AWS development account
- Automatically fetches token from AWS Secrets Manager
- Sets up AWS SSO credentials if needed
- URL: `https://airobuilde-proxy-dev-private-ecs.airobuilde-dev-private.prod.onkatana.net`

### Manual Configuration
- Prompts for manual token entry if AWS setup fails
- Supports legacy SSO JWT tokens

## Next Steps After Setup

1. **Install Project Dependencies**:
   ```bash
   pnpm install  # Install all workspace dependencies
   ```

2. **Start Services**:
   ```bash
   # Option 1: Start both services concurrently
   pnpm run dev
   
   # Option 2: Start services individually
   pnpm run dev:agents  # Backend API (port 4000)
   pnpm run dev:app     # Frontend App (port 3000)
   ```

3. **Access Application**:
   - Frontend: http://localhost:3000
   - Backend API: http://localhost:4000
   - MySQL: localhost:3306

## Troubleshooting

### Use the Status Check
First, run the configuration status check:
```bash
# From project root
pnpm --filter airo-setup start
# Choose "Selective Configuration" → "Check Current Configuration Status"

# Or from setup directory
cd setup && pnpm start
```

### Common Issues

- **Docker not running**: `sudo systemctl start docker`
- **Permission denied**: Add user to docker group: `sudo usermod -aG docker $USER`
- **Port conflicts**: Check if ports 3000, 4000, or 3306 are already in use
- **MySQL connection issues**: Use setup utility or manually: `docker compose up app-mysql -d`
- **Getty Images not working**: Reconfigure via setup utility: "Configure Getty Images Proxy"
- **AWS credentials expired**: Run setup utility to refresh SSO login

### Reconfiguration

To modify any component after initial setup:
```bash
# From project root
pnpm --filter airo-setup start
# Choose "Selective Configuration"

# Or from setup directory
cd setup && pnpm start
```

This allows you to:
- Update AI provider settings
- Reconfigure Getty Images
- Fix MySQL connection issues
- Check system status
- Start/stop containers
