#!/bin/bash

# Airo App Builder - Dependency Checker
# This script checks for required dependencies and provides installation instructions

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Print colored output
print_status() {
    echo -e "${GREEN}[✓]${NC} $1"
}

print_error() {
    echo -e "${RED}[✗]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[!]${NC} $1"
}

print_info() {
    echo -e "${BLUE}[i]${NC} $1"
}

print_header() {
    echo ""
    echo "=================================="
    echo "  Airo App Builder Setup Checker"
    echo "=================================="
    echo ""
}

# Check Node.js version
check_nodejs() {
    print_info "Checking Node.js installation..."
    
    if command -v node &> /dev/null; then
        NODE_VERSION=$(node --version)
        NODE_MAJOR=$(echo $NODE_VERSION | cut -d'.' -f1 | sed 's/v//')
        
        if [ "$NODE_MAJOR" -eq 22 ]; then
            print_status "Node.js $NODE_VERSION is installed and compatible"
            return 0
        else
            print_error "Node.js $NODE_VERSION found, but version 22.x is required"
            show_nodejs_install_instructions
            return 1
        fi
    else
        print_error "Node.js is not installed"
        show_nodejs_install_instructions
        return 1
    fi
}

# Check pnpm installation
check_pnpm() {
    print_info "Checking pnpm installation..."
    
    if command -v pnpm &> /dev/null; then
        PNPM_VERSION=$(pnpm --version)
        print_status "pnpm $PNPM_VERSION is installed"
        return 0
    else
        print_error "pnpm is not installed"
        show_pnpm_install_instructions
        return 1
    fi
}

# Show Node.js installation instructions for Ubuntu
show_nodejs_install_instructions() {
    echo ""
    print_warning "Node.js 22 installation required"
    echo ""
    echo "For Ubuntu/Debian systems, install Node.js 22 using NodeSource repository:"
    echo ""
    echo "  # Update package index"
    echo "  sudo apt update"
    echo ""
    echo "  # Install required packages"
    echo "  sudo apt install -y curl software-properties-common"
    echo ""
    echo "  # Add NodeSource repository for Node.js 22"
    echo "  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -"
    echo ""
    echo "  # Install Node.js 22"
    echo "  sudo apt install -y nodejs"
    echo ""
    echo "Alternative using Node Version Manager (nvm):"
    echo ""
    echo "  # Install nvm"
    echo "  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash"
    echo ""
    echo "  # Reload shell or run:"
    echo "  source ~/.bashrc"
    echo ""
    echo "  # Install and use Node.js 22"
    echo "  nvm install 22"
    echo "  nvm use 22"
    echo ""
}

# Show pnpm installation instructions
show_pnpm_install_instructions() {
    echo ""
    print_warning "pnpm installation required"
    echo ""
    echo "Install pnpm using npm (after Node.js is installed):"
    echo ""
    echo "  npm install -g pnpm"
    echo ""
    echo "Alternative installation using curl:"
    echo ""
    echo "  curl -fsSL https://get.pnpm.io/install.sh | sh -"
    echo ""
    echo "For Ubuntu/Debian using package manager:"
    echo ""
    echo "  # Add pnpm repository"
    echo "  curl -fsSL https://get.pnpm.io/install.sh | env PNPM_VERSION=latest sh -"
    echo ""
}

# Main execution
main() {
    # Check if running in integrated mode (called from master setup script)
    local integrated_mode=false
    if [[ "$1" == "--integrated" ]]; then
        integrated_mode=true
    fi
    
    # Only show header if not in integrated mode
    if [ "$integrated_mode" = false ]; then
        print_header
    fi
    
    local nodejs_ok=0
    local pnpm_ok=0
    
    # Check dependencies
    if check_nodejs; then
        nodejs_ok=1
    fi
    
    if check_pnpm; then
        pnpm_ok=1
    fi
    
    # Summary - adjust based on mode
    if [ "$integrated_mode" = false ]; then
        echo ""
        echo "=================================="
        echo "  Dependency Check Summary"
        echo "=================================="
    fi
    
    if [ $nodejs_ok -eq 1 ] && [ $pnpm_ok -eq 1 ]; then
        if [ "$integrated_mode" = false ]; then
            print_status "All dependencies are satisfied!"
            echo ""
            print_info "You can now proceed with the Airo App Builder setup."
            echo ""
            echo "Next steps:"
            echo "  1. Run './setup.sh' for full setup, or"
            echo "  2. Manual setup:"
            echo "     cd agents && pnpm install"
            echo "     cd app && pnpm install"
            echo "  3. Configure your environment files"
        fi
        exit 0
    else
        if [ "$integrated_mode" = false ]; then
            echo ""
            print_error "Some dependencies are missing. Please install them and run this script again."
            echo ""
            print_info "After installing dependencies, you can run the full setup with: ./setup.sh"
        fi
        exit 1
    fi
}

# Run main function
main "$@"