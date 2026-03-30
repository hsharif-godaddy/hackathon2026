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

# Check that a Node.js version manager (mise, fnm, asdf, or nvm) is installed.
# .envrc relies on one of these to load the correct Node.js version from .nvmrc.
check_node_version_manager() {
    if command -v mise &> /dev/null; then
        print_status "mise is installed (Node.js version manager)"
        return 0
    fi

    if command -v fnm &> /dev/null; then
        print_status "fnm is installed (Node.js version manager)"
        return 0
    fi

    if command -v asdf &> /dev/null; then
        print_status "asdf is installed (Node.js version manager)"
        return 0
    fi

    if [ -n "${NVM_DIR:-}" ] && [ -s "${NVM_DIR}/nvm.sh" ]; then
        print_status "nvm is installed (Node.js version manager)"
        return 0
    fi

    print_warning "No Node.js version manager found (mise, fnm, asdf, or nvm)"
    echo ""
    print_info "The .envrc file uses mise, fnm, asdf, or nvm to load the correct Node.js version from .nvmrc"
    echo ""
    echo "  Install mise (recommended):"
    echo "    brew install mise          # macOS"
    echo "    https://mise.jdx.dev/installing-mise.html  # other platforms"
    echo ""
    echo "  Or install fnm:"
    echo "    brew install fnm           # macOS"
    echo "    https://github.com/Schniz/fnm#installation"
    echo ""
    echo "  Or install asdf:"
    echo "    brew install asdf          # macOS"
    echo "    https://asdf-vm.com/guide/getting-started.html"
    echo ""
    echo "  Or install nvm:"
    echo "    https://github.com/nvm-sh/nvm#installing-and-updating"
    echo ""
    return 1
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
            show_pnpm_instructions
            return 1
        fi
    else
        print_error "pnpm is not installed"
        show_pnpm_instructions
        return 1
    fi
}

# Check Go installation (required for local control plane)
check_go() {
    print_info "Checking Go installation..."

    if command -v go &> /dev/null; then
        # Prefer go env GOVERSION (reliable); fall back to parsing `go version` output
        GO_VERSION_RAW=$(go env GOVERSION 2>/dev/null || true)
        if [ -z "$GO_VERSION_RAW" ]; then
            GO_VERSION_RAW=$(go version 2>/dev/null | awk '{print $3}')
        fi

        # Normalize: drop leading "go" and any non-numeric suffix (e.g., rc/beta)
        GO_VERSION=$(printf '%s\n' "$GO_VERSION_RAW" | sed -E 's/^go//; s/[^0-9.].*$//')

        if ! echo "$GO_VERSION" | grep -Eq '^[0-9]+\.[0-9]+'; then
            print_error "Unable to parse Go version from '$GO_VERSION_RAW'"
            print_warning "Please ensure Go 1.25 or higher is installed and available on PATH"
            show_go_install_instructions
            return 1
        fi

        GO_MAJOR=$(echo "$GO_VERSION" | cut -d'.' -f1)
        GO_MINOR=$(echo "$GO_VERSION" | cut -d'.' -f2)

        if [ "$GO_MAJOR" -gt 1 ] || { [ "$GO_MAJOR" -eq 1 ] && [ "$GO_MINOR" -ge 25 ]; }; then
            print_status "Go $GO_VERSION is installed and compatible"
            return 0
        else
            print_error "Go $GO_VERSION found, but version 1.25 or higher is required"
            print_warning "Go 1.25+ is needed for the local control plane"
            show_go_install_instructions
            return 1
        fi
    else
        print_error "Go is not installed"
        print_warning "Go is required for the local control plane service"
        show_go_install_instructions
        return 1
    fi
}

# Check Docker installation
check_docker() {
    print_info "Checking Docker installation..."

    if command -v docker &> /dev/null; then
        DOCKER_VERSION=$(docker --version 2>/dev/null | sed 's/Docker version //' | cut -d',' -f1)
        print_status "Docker $DOCKER_VERSION is installed"

        if docker info &> /dev/null; then
            print_status "Docker daemon is running"
        else
            print_warning "Docker is installed but not running"
            echo ""
            echo "  Open the Docker Desktop application to start it"
            return 1
        fi
        return 0
    else
        print_error "Docker is not installed"
        echo ""
        echo "  Download Docker Desktop:"
        echo "    https://www.docker.com/products/docker-desktop/"
        return 1
    fi
}

# Check AWS CLI installation
check_awscli() {
    print_info "Checking AWS CLI installation..."

    if command -v aws &> /dev/null; then
        AWS_VERSION=$(aws --version 2>&1 | awk '{print $1}' | cut -d'/' -f2)
        print_status "AWS CLI $AWS_VERSION is installed"
        return 0
    else
        print_error "AWS CLI is not installed"
        echo ""
        echo "  macOS:  brew install awscli"
        echo "  Other:  https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html"
        return 1
    fi
}

# Check that make is installed (required for local control plane)
check_make() {
    print_info "Checking make installation..."

    if command -v make &> /dev/null; then
        print_status "make is installed"
        return 0
    else
        print_error "make is not installed"
        echo ""
        echo "  macOS:  xcode-select --install"
        echo "  Linux:  sudo apt install build-essential"
        return 1
    fi
}

# Check /etc/hosts entry for local dev
check_hosts_file() {
    print_info "Checking /etc/hosts for local dev entry..."

    if grep -v '^\s*#' /etc/hosts 2>/dev/null | grep -q "local.gasket.dev-godaddy.com"; then
        print_status "/etc/hosts contains local.gasket.dev-godaddy.com"
        return 0
    else
        print_error "/etc/hosts is missing the local dev entry"
        echo ""
        echo "  Add this line to /etc/hosts:"
        echo "    127.0.0.1  local.gasket.dev-godaddy.com"
        echo ""
        echo "  Run: echo '127.0.0.1  local.gasket.dev-godaddy.com' | sudo tee -a /etc/hosts"
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
    if [ -z "${DIRENV_DIR:-}" ]; then
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

    if [ -f ".envrc" ]; then
        # Extract the allowPath from direnv status and check if it exists on disk.
        # When .envrc is blocked, the allow file doesn't exist (watch shows epoch 0).
        # When approved, the allow file exists with a real timestamp.
        local allow_path
        allow_path=$(direnv status 2>/dev/null | grep "Found RC allowPath" | awk '{print $NF}')

        if [ -n "$allow_path" ] && [ ! -f "$allow_path" ]; then
            print_warning ".envrc needs to be approved"
            echo ""
            echo "  Run: direnv allow"
            return 1
        fi
    fi

    print_status "direnv hook is configured and .envrc is loaded"
    return 0
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
    echo "Alternative using a version manager (recommended):"
    echo ""
    echo "  mise (recommended):  brew install mise"
    echo "    https://mise.jdx.dev/installing-mise.html"
    echo ""
    echo "  fnm:  brew install fnm"
    echo "    https://github.com/Schniz/fnm#installation"
    echo ""
    echo "  asdf: brew install asdf"
    echo "    https://asdf-vm.com/guide/getting-started.html"
    echo ""
    echo "  nvm:"
    echo "    https://github.com/nvm-sh/nvm#installing-and-updating"
    echo ""
    echo "  After installing, run the appropriate install command for your manager"
    echo ""
    print_info "Note: Node.js 22.16.0+ is required to fix ERR_INVALID_URL_SCHEME bug"
    echo ""
}

# Show pnpm fix instructions
show_pnpm_instructions() {
    echo ""
    print_info "This project requires pnpm 10.17.0 (specified in package.json)"
    echo ""
    echo "  Corepack is enabled automatically by .envrc"
    echo "  Try: direnv allow && pnpm --version"
    echo ""
    echo "Alternative: Manual pnpm installation (NOT recommended):"
    echo ""
    echo "  npm install -g pnpm@10.17.0"
    echo ""
    print_warning "Manual installation may cause version drift between developers"
    echo ""
}

# Show Go installation instructions
show_go_install_instructions() {
    echo ""
    print_warning "Go 1.25 or higher installation required for local control plane"
    echo ""
    echo "For macOS:"
    echo ""
    echo "  # Using Homebrew"
    echo "  brew install go"
    echo ""
    echo "For Linux and other platforms:"
    echo ""
    echo "  # Follow the official installation instructions at:"
    echo "  # https://go.dev/doc/install"
    echo "  # This covers all architectures (amd64, arm64, etc.)"
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
    echo "  - Load the correct Node.js version (22.16.0+) via mise, fnm, asdf, or nvm"
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

    local required_checks=(
        check_node_version_manager
        check_direnv
        check_direnv_hook
        check_nodejs
        check_pnpm
        check_go
        check_make
        check_docker
        check_awscli
        check_hosts_file
    )

    for check in "${required_checks[@]}"; do
        if ! "$check"; then
            echo ""
            print_info "Fix the issue above, then re-run this check."
            exit 1
        fi
        echo ""

        if [ "$check" = "check_direnv_hook" ]; then
            print_info "direnv is fully configured - it will automatically manage Node.js and pnpm via .envrc"
            echo ""
        fi
    done

    # Optional — doesn't bail
    check_mkcert
    echo ""

    if [ "$integrated_mode" = false ]; then
        echo ""
        print_status "All required dependencies are satisfied!"
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
}

# Run main function
main "$@"
