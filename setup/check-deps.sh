#!/bin/bash

# Airo Builder - Dependency Checker
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
    echo "    Airo Builder Setup Checker    "
    echo "=================================="
    echo ""
}

# Check Node.js version
check_nodejs() {
    print_info "Checking Node.js installation..."

    if command -v node &> /dev/null; then
        NODE_VERSION=$(node --version)
        NODE_MAJOR=$(echo $NODE_VERSION | cut -d'.' -f1 | sed 's/v//')
        NODE_MINOR=$(echo $NODE_VERSION | cut -d'.' -f2)

        # Check for Node.js 22.16.0 or higher (required to fix ERR_INVALID_URL_SCHEME bug)
        if [ "$NODE_MAJOR" -gt 22 ] || ([ "$NODE_MAJOR" -eq 22 ] && [ "$NODE_MINOR" -ge 16 ]); then
            print_status "Node.js $NODE_VERSION is installed and compatible"
            return 0
        else
            print_error "Node.js $NODE_VERSION found, but version 22.16.0 or higher is required"
            print_warning "Node.js 22.16.0+ is needed to fix ERR_INVALID_URL_SCHEME bug"
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
        REQUIRED_VERSION="10.17.0"
        
        if [ "$PNPM_VERSION" = "$REQUIRED_VERSION" ]; then
            print_status "pnpm $PNPM_VERSION is installed (matches package.json)"
            return 0
        else
            print_warning "pnpm $PNPM_VERSION is installed, but $REQUIRED_VERSION is required"
            print_info "Different pnpm versions cause lockfile format inconsistencies"
            show_corepack_instructions
            return 1
        fi
    else
        print_error "pnpm is not installed"
        show_corepack_instructions
        return 1
    fi
}

# Check mkcert installation
check_mkcert() {
    print_info "Checking mkcert installation..."

    if command -v mkcert &> /dev/null; then
        MKCERT_VERSION=$(mkcert -version 2>&1 | head -n1)
        print_status "mkcert is installed ($MKCERT_VERSION)"
        return 0
    else
        print_warning "mkcert is not installed (recommended for HTTPS)"
        show_mkcert_install_instructions
        return 1
    fi
}

# Check direnv installation
check_direnv() {
    print_info "Checking direnv installation..."

    if command -v direnv &> /dev/null; then
        DIRENV_VERSION=$(direnv version)
        print_status "direnv $DIRENV_VERSION is installed"
        return 0
    else
        print_warning "direnv is not installed (recommended)"
        show_direnv_install_instructions
        return 1
    fi
}

# Check if direnv hook is configured and working
check_direnv_hook() {
    # Check if DIRENV_DIR is set, which indicates direnv hook is active and .envrc is loaded
    if [ -n "${DIRENV_DIR:-}" ]; then
        print_status "direnv hook is configured and .envrc is already loaded"
        return 0
    else
        print_warning "direnv hook is not active in this shell session"
        echo ""
        print_info "To enable direnv, add the appropriate hook to your shell config:"
        echo ""
        echo "  For bash - add to ~/.bashrc:"
        echo "    eval \"\$(direnv hook bash)\""
        echo ""
        echo "  For zsh - add to ~/.zshrc:"
        echo "    eval \"\$(direnv hook zsh)\""
        echo ""
        echo "  For fish - add to ~/.config/fish/config.fish:"
        echo "    direnv hook fish | source"
        echo ""
        print_info "After adding the hook:"
        echo "  1. Restart your shell or source the config file"
        echo "  2. Navigate to this project directory"
        echo "  3. Run: direnv allow"
        return 1
    fi
}

# Show Node.js installation instructions for Ubuntu
show_nodejs_install_instructions() {
    echo ""
    print_warning "Node.js 22.16.0 or higher installation required"
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
    echo "  # Install Node.js 22 (will install latest 22.x version)"
    echo "  sudo apt install -y nodejs"
    echo ""
    echo "Alternative using Node Version Manager (nvm) - Recommended:"
    echo ""
    echo "  # Install nvm"
    echo "  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash"
    echo ""
    echo "  # Reload shell or run:"
    echo "  source ~/.bashrc"
    echo ""
    echo "  # Install and use Node.js 22.16.0 or higher"
    echo "  nvm install 22"
    echo "  nvm use 22"
    echo ""
    print_info "Note: Node.js 22.16.0+ is required to fix ERR_INVALID_URL_SCHEME bug"
    echo ""
}

# Show Corepack instructions (recommended for pnpm version management)
show_corepack_instructions() {
    echo ""
    print_warning "Corepack ensures consistent pnpm version across all developers"
    echo ""
    print_info "This project requires pnpm 10.17.0 (specified in package.json)"
    print_info "Using Corepack prevents lockfile format inconsistencies"
    echo ""
    echo "Enable Corepack (RECOMMENDED - comes with Node.js 22+):"
    echo ""
    echo "  # Enable Corepack"
    echo "  corepack enable"
    echo ""
    echo "  # Corepack will automatically install and use pnpm 10.17.0"
    echo "  # based on the packageManager field in package.json"
    echo ""
    print_info "After enabling Corepack, pnpm will be automatically managed"
    print_info "Run 'pnpm --version' to verify it shows 10.17.0"
    echo ""
    echo "Alternative: Manual pnpm installation (NOT recommended):"
    echo ""
    echo "  npm install -g pnpm@10.17.0"
    echo ""
    print_warning "Manual installation may cause version drift between developers"
    echo ""
}

# Show mkcert installation instructions
show_mkcert_install_instructions() {
    echo ""
    print_warning "mkcert installation recommended for HTTPS development"
    echo ""
    print_info "mkcert creates locally-trusted development certificates"
    print_info "This enables HTTPS without browser warnings during development"
    echo ""
    echo "For macOS:"
    echo ""
    echo "  # Using Homebrew"
    echo "  brew install mkcert"
    echo "  mkcert -install"
    echo ""
    echo "For Ubuntu/Debian:"
    echo ""
    echo "  # Install certutil (required by mkcert)"
    echo "  sudo apt update"
    echo "  sudo apt install -y libnss3-tools"
    echo ""
    echo "  # Download and install mkcert"
    echo "  curl -JLO \"https://dl.filippo.io/mkcert/latest?for=linux/amd64\""
    echo "  chmod +x mkcert-v*-linux-amd64"
    echo "  sudo mv mkcert-v*-linux-amd64 /usr/local/bin/mkcert"
    echo ""
    echo "  # Install local CA"
    echo "  mkcert -install"
    echo ""
    print_warning "If Chrome still shows certificate warnings after installation:"
    echo ""
    echo "  1. Go to chrome://certificate-manager/localcerts/usercerts"
    echo "  2. Click on 'Import on Trust Certificates'"
    echo "  3. Select airo-app-builder/.dev-ca/ca-cert.pem"
    echo "     (You might need to press Command + Shift + . to show the .dev-ca directory)"
    echo ""
    print_info "Note: Without mkcert, the system will fall back to OpenSSL self-signed certificates"
    print_info "Self-signed certificates work but will show browser warnings"
    echo ""
    print_info "Learn more at: https://github.com/FiloSottile/mkcert"
    echo ""
}

# Show direnv installation instructions
show_direnv_install_instructions() {
    echo ""
    print_warning "direnv installation recommended"
    echo ""
    print_info "direnv automatically loads environment variables from .envrc files"
    print_info "This project uses .envrc to manage Node.js versions and workspace setup"
    echo ""
    echo "For macOS:"
    echo ""
    echo "  # Using Homebrew"
    echo "  brew install direnv"
    echo ""
    echo "  # Add to your shell config (~/.zshrc, ~/.bashrc, etc.)"
    echo "  eval \"\$(direnv hook zsh)\"  # For zsh"
    echo "  eval \"\$(direnv hook bash)\" # For bash"
    echo ""
    echo "For Ubuntu/Debian:"
    echo ""
    echo "  # Install direnv"
    echo "  sudo apt update"
    echo "  sudo apt install -y direnv"
    echo ""
    echo "  # Add to your shell config (~/.bashrc, ~/.zshrc, etc.)"
    echo "  eval \"\$(direnv hook bash)\" # For bash"
    echo "  eval \"\$(direnv hook zsh)\"  # For zsh"
    echo ""
    echo "After installing and configuring direnv:"
    echo ""
    echo "  # Navigate to the project directory"
    echo "  cd /path/to/airo-app-builder"
    echo ""
    echo "  # Allow the .envrc file to be executed"
    echo "  direnv allow"
    echo ""
    print_info "Once direnv is set up, it will automatically:"
    echo "  - Load the correct Node.js version (22.16.0+) via nvm"
    echo "  - Ensure pnpm is installed"
    echo "  - Set up workspace protection for pnpm commands"
    echo ""
    print_info "Learn more at: https://direnv.net/"
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
    local mkcert_ok=0
    local direnv_ok=0
    local direnv_hook_ok=0

    # Check mkcert (optional but recommended)
    if check_mkcert; then
        mkcert_ok=1
    fi
    echo ""

    # Check direnv first - it can automatically manage Node.js and pnpm
    if check_direnv; then
        direnv_ok=1

        # Check if direnv hook is properly configured in shell
        if check_direnv_hook; then
            direnv_hook_ok=1
        fi

        echo ""
        if [ $direnv_hook_ok -eq 1 ]; then
            print_info "direnv is fully configured - it will automatically manage Node.js and pnpm via .envrc"
            print_info "Make sure to run 'direnv allow' in the project directory"
        else
            print_warning "direnv is installed but shell hook is NOT configured"
            print_info "The .envrc file will not load automatically until you configure the hook"
            print_info "Follow the instructions above to add the hook to your shell config"
        fi
        echo ""
    fi

    # Check other dependencies
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

    if [ $direnv_ok -eq 1 ] && [ $direnv_hook_ok -eq 1 ] && [ $nodejs_ok -eq 1 ] && [ $pnpm_ok -eq 1 ]; then
        if [ "$integrated_mode" = false ]; then
            print_status "All required dependencies are satisfied!"
            echo ""
            print_info "direnv is active and managing your environment!"
            echo ""
            if [ $mkcert_ok -eq 0 ]; then
                print_warning "mkcert is not installed - apps will use self-signed certificates"
                print_info "Consider installing mkcert for better HTTPS development experience"
            else
                print_status "mkcert is installed - apps will use trusted local certificates"
            fi
            echo ""
            print_info "You can now proceed with the Airo Builder setup."
            echo ""
            echo "Next steps:"
            echo "  1. Run './setup.sh' for full setup, or"
            echo "  2. Manual setup:"
            echo "     pnpm install  # Install all workspace dependencies"
            echo "  3. Configure your environment files"
        fi
        exit 0
    else
        if [ "$integrated_mode" = false ]; then
            echo ""
            print_error "Required dependencies are missing."
            echo ""
            print_warning "RECOMMENDED: Install direnv first - it will automatically manage Node.js and pnpm"
            show_direnv_install_instructions
            echo ""
            print_info "Alternatively, you can manually install the missing dependencies."
            print_info "After installing, run this script again or proceed with: ./setup.sh"
        fi
        exit 1
    fi
}

# Run main function
main "$@"
