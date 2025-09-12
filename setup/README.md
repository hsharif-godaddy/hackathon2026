# Airo App Builder Setup Utilities

This directory contains setup utilities to help you configure and install the Airo App Builder development environment.

## Quick Start

### 1. Basic Dependencies Check

```bash
# Check Node.js 22 and pnpm
./check-deps.sh
```

### 2. Advanced Setup

```bash
# Run the interactive TypeScript setup app
./run-setup.sh
```

Or manually:

```bash
cd setup
pnpm install
pnpm start
```

## What the Setup Does

### Basic Dependencies (`check-deps.sh`)
- ✅ Verifies Node.js 22.x is installed
- ✅ Checks for pnpm package manager
- 📋 Provides Ubuntu installation instructions for missing deps

### Advanced Setup (`run-setup.sh`)
- 🐳 **Docker Dependencies**: Checks Docker, Docker Compose, and daemon status
- 📝 **Environment Configuration**: Generates `.env` files with proper MySQL configuration
- 🤖 **AI Model Setup**: Configures either AWS Bedrock or GoCode as AI provider
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

## Next Steps After Setup

1. **Install Project Dependencies**:
   ```bash
   cd agents && pnpm install
   cd app && pnpm install
   ```

2. **Start Services**:
   ```bash
   # Terminal 1 - Backend API
   cd agents && pnpm run dev
   
   # Terminal 2 - Frontend App  
   cd app && pnpm run dev
   ```

3. **Access Application**:
   - Frontend: http://localhost:3000
   - Backend API: http://localhost:4000
   - MySQL: localhost:3306

## Troubleshooting

- **Docker not running**: `sudo systemctl start docker`
- **Permission denied**: Add user to docker group: `sudo usermod -aG docker $USER`
- **Port conflicts**: Check if ports 3000, 4000, or 3306 are already in use
- **MySQL connection issues**: Ensure container is running: `docker compose up app-mysql -d`