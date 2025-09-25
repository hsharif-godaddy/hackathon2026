#!/bin/bash

# Airo App Builder - Master Setup Script
# This script orchestrates the complete setup process

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

print_header() {
    clear
    echo -e "${CYAN}╔══════════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║                                              ║${NC}"
    echo -e "${CYAN}║          🚀 Airo App Builder Setup          ║${NC}"
    echo -e "${CYAN}║                                              ║${NC}"
    echo -e "${CYAN}╚══════════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "${BLUE}This setup will guide you through:${NC}"
    echo "  1. Basic dependency verification (Node.js 22 + pnpm)"
    echo "  2. Docker environment setup"
    echo "  3. Environment configuration (.env files)"
    echo "  4. AI model provider setup"
    echo "  5. MySQL container configuration"
    echo ""
}

print_step() {
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${YELLOW}📋 Step $1: $2${NC}"
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
}

print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

confirm_continue() {
    echo ""
    read -p "Press Enter to continue or Ctrl+C to exit..."
    echo ""
}

main() {
    print_header
    
    # Confirm user wants to proceed
    echo -e "${YELLOW}⚠️  This setup will check and potentially modify your system configuration.${NC}"
    echo ""
    read -p "Do you want to continue? [Y/n]: " -r
    if [[ $REPLY =~ ^[Nn]$ ]]; then
        echo -e "${YELLOW}Setup cancelled by user.${NC}"
        exit 0
    fi
    
    echo ""
    
    # Step 1: Basic Dependencies
    print_step "1" "Basic Dependency Check"
    echo -e "${BLUE}Checking Node.js 22 and pnpm installation...${NC}"
    echo ""
    
    if ./setup/check-deps.sh --integrated; then
        print_success "Basic dependencies satisfied"
    else
        print_error "Basic dependencies not satisfied"
        echo ""
        echo -e "${YELLOW}Please install the missing dependencies and run this setup again.${NC}"
        echo "You can also run just the dependency checker: ${BLUE}./setup/check-deps.sh${NC}"
        exit 1
    fi
    
    confirm_continue
    
    # Step 2: Advanced Setup
    print_step "2" "Advanced Configuration"
    echo -e "${BLUE}Starting Docker checks and environment configuration...${NC}"
    echo ""
    
    cd setup
    
    # Check if dependencies are installed for the setup app
    if [ ! -d "node_modules" ]; then
        echo -e "${BLUE}🔑 Authenticating with Artifactory...${NC}"
        pnpm login --progress true --registry https://gdartifactory1.jfrog.io/artifactory/api/npm/node-virt/ --auth-type web
        echo -e "${BLUE}📦 Installing setup dependencies...${NC}"
        pnpm install
        echo ""
    fi
    
    # Run the advanced setup
    if pnpm start; then
        cd ..
        print_success "Advanced setup completed successfully"
    else
        cd ..
        print_error "Advanced setup failed"
        exit 1
    fi
    
    # Step 3: Final Summary
    echo ""
    print_step "3" "Setup Complete"
    
    echo -e "${GREEN}🎉 Airo App Builder setup completed successfully!${NC}"
    echo ""
    echo -e "${CYAN}📋 What's been configured:${NC}"
    echo "  ✅ Node.js 22 and pnpm verified"
    echo "  ✅ Docker environment checked"
    echo "  ✅ Environment files generated"
    echo "  ✅ AI model provider configured"
    echo "  ✅ MySQL integration set up"
    echo ""
    echo -e "${CYAN}🚀 Next Steps:${NC}"
    echo ""
    echo -e "${YELLOW}1. Install project dependencies:${NC}"
    echo "   cd packages/ai-lib && pnpm install && pnpm build"
    echo "   cd agents && pnpm install"
    echo "   cd app && pnpm dlx prisma generate && pnpm install"
    echo ""
    echo -e "${YELLOW}2. Start the development services:${NC}"
    echo "   # Terminal 1 - Backend API (port 4000)"
    echo "   cd agents && pnpm run dev"
    echo ""
    echo "   # Terminal 2 - Frontend App (port 3000)"  
    echo "   cd app && pnpm run dev"
    echo ""
    echo -e "${YELLOW}3. Access your application:${NC}"
    echo -e "   Frontend: ${BLUE}http://localhost:3000${NC}"
    echo -e "   Backend API: ${BLUE}http://localhost:4000${NC}"
    echo ""
    echo -e "${YELLOW}4. Database access (if needed):${NC}"
    echo -e "   MySQL: ${BLUE}localhost:3306${NC}"
    echo "   Database: airo_app"
    echo "   User: airo / Password: airopassword"
    echo ""
    echo -e "${GREEN}Happy coding! 🎯${NC}"
}

# Handle interruption gracefully
trap 'echo -e "\n${YELLOW}Setup interrupted by user. Exiting...${NC}"; exit 130' INT

# Check if we're in the right directory
if [ ! -f "setup/check-deps.sh" ]; then
    echo -e "${RED}❌ Error: Please run this script from the Airo App Builder root directory${NC}"
    echo "Expected to find: setup/check-deps.sh"
    exit 1
fi

# Run main function
main "$@"
