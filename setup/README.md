# Airo Builder Setup Utilities

This directory contains setup utilities to help you configure and install the Airo Builder development environment.

## 🚀 Quick Start

Run from the project root:

```bash
pnpm run dev
```

The Dev Runner TUI runs preflight checks automatically and offers to fix any issues inline. For selective reconfiguration:

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

## What the Setup Does

### Advanced Setup (`cd setup && ./run-setup.sh`)

- 🐳 **Docker Dependencies**: Checks Docker, Docker Compose, and daemon status
- 📝 **Environment Configuration**: Generates `.env` files with proper MySQL configuration
- 🤖 **AI Model Setup**: Configures GoCode as AI provider
- 🖼️ **Getty Images**: Sets up AWS proxy with Secrets Manager token integration
- 🔐 **AWS SSO**: Automatic credential setup for development services
- 🗄️ **MySQL Integration**: Sets up connection to MySQL container
- 🚀 **Container Management**: Optionally starts the MySQL container

## Generated Configuration

### App Environment (`app/.env`)

The setup generates a complete `.env` file for the main application including:

- **AI Provider**: GoCode configuration
- **Security**: Auto-generated session and JWT secrets
- **Ports**: Development server configuration
- **Features**: Usage tracking, real-time collaboration settings

### MySQL Configuration

- **Container**: `airo-app-mysql`
- **Host**: `localhost:3306`
- **Root Password**: `rootpassword`
- Per-app databases are provisioned dynamically by the local control plane

## AI Model Provider

### GoCode

- Custom API endpoint configuration
- Prompts for: Base URL, API Key
- Uses GoCode API for AI model access

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
   # Recommended: TUI with all services
   pnpm run dev

   # Or start individually:
   pnpm run dev:agents          # Backend API (port 4000)
   pnpm run dev:app             # Frontend App (port 3000)
   pnpm run dev:control-plane   # Local Control Plane (port 4100)
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
