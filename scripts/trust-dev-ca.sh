#!/bin/bash

# Trust Development CA Script
# This script helps users trust the project's development CA certificate

set -e

CA_CERT=".dev-ca/ca-cert.pem"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}╔══════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║      Airo Builder - Trust Development CA     ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════════╝${NC}"
echo ""

# Check if CA exists
if [ ! -f "$CA_CERT" ]; then
    echo -e "${RED}❌ CA certificate not found at $CA_CERT${NC}"
    echo ""
    echo -e "${YELLOW}The CA will be automatically generated when you create your first app.${NC}"
    echo -e "${YELLOW}After that, run this script again to trust it.${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Found CA certificate at: $CA_CERT${NC}"
echo ""

# Detect OS
if [[ "$OSTYPE" == "linux-gnu"* ]]; then
    echo -e "${BLUE}📋 Detected Linux/WSL2${NC}"
    echo ""
    echo -e "${YELLOW}To trust the CA certificate:${NC}"
    echo ""
    echo "1. Install the certificate to your system trust store:"
    echo "   sudo cp $CA_CERT /usr/local/share/ca-certificates/airo-dev-ca.crt"
    echo "   sudo update-ca-certificates"
    echo ""
    echo "2. For Chrome/Chromium browsers:"
    echo "   - Open chrome://settings/certificates"
    echo "   - Go to 'Authorities' tab"
    echo "   - Click 'Import' and select: $CA_CERT"
    echo "   - Check 'Trust this certificate for identifying websites'"
    echo ""
    echo "3. For Firefox:"
    echo "   - Open about:preferences#privacy"
    echo "   - Scroll to 'Certificates' and click 'View Certificates'"
    echo "   - Go to 'Authorities' tab"
    echo "   - Click 'Import' and select: $CA_CERT"
    echo "   - Check 'Trust this CA to identify websites'"
    echo ""
    echo -e "${GREEN}Would you like to install it to the system trust store now? [y/N]${NC}"
    read -r response
    if [[ "$response" =~ ^([yY][eE][sS]|[yY])$ ]]; then
        sudo cp "$CA_CERT" /usr/local/share/ca-certificates/airo-dev-ca.crt
        sudo update-ca-certificates
        echo -e "${GREEN}✅ CA certificate installed to system trust store${NC}"
        echo ""

        # Check if running in WSL2
        if [ -d "/mnt/c" ] && command -v powershell.exe &> /dev/null; then
            echo -e "${BLUE}🔍 Detected WSL2 with PowerShell access${NC}"
            echo ""
            echo -e "${YELLOW}Install CA to Windows host as well? [y/N]${NC}"
            read -r win_response
            if [[ "$win_response" =~ ^([yY][eE][sS]|[yY])$ ]]; then
                # Convert WSL path to Windows path
                CA_CERT_WIN=$(wslpath -w "$CA_CERT" 2>/dev/null || echo "$CA_CERT" | sed 's|^/mnt/\([a-z]\)/|\1:/|' | sed 's|/|\\|g')

                echo ""
                echo -e "${BLUE}🔐 Installing CA to Windows host certificate store...${NC}"
                echo -e "${YELLOW}   This requires administrator privileges on Windows${NC}"
                echo ""

                powershell.exe -Command "Start-Process powershell -Verb RunAs -ArgumentList '-Command', 'Import-Certificate -FilePath \"$CA_CERT_WIN\" -CertStoreLocation Cert:\\LocalMachine\\Root'" 2>/dev/null

                if [ $? -eq 0 ]; then
                    echo -e "${GREEN}✅ CA certificate installation initiated on Windows host${NC}"
                    echo -e "${YELLOW}   You may see a UAC prompt - please approve it${NC}"
                else
                    echo -e "${RED}❌ Failed to install CA on Windows host${NC}"
                    echo ""
                    echo "You can install it manually by running this in an elevated PowerShell:"
                    echo "  Import-Certificate -FilePath \"$CA_CERT_WIN\" -CertStoreLocation Cert:\\LocalMachine\\Root"
                fi
                echo ""
            fi
        fi

        echo -e "${YELLOW}⚠️  You may still need to manually import it in your browsers${NC}"
    fi

elif [[ "$OSTYPE" == "darwin"* ]]; then
    echo -e "${BLUE}📋 Detected macOS${NC}"
    echo ""
    echo -e "${YELLOW}To trust the CA certificate:${NC}"
    echo ""
    echo "1. Add to system keychain:"
    echo "   sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain $CA_CERT"
    echo ""
    echo "2. For Firefox (separate trust store):"
    echo "   - Open about:preferences#privacy"
    echo "   - Scroll to 'Certificates' and click 'View Certificates'"
    echo "   - Go to 'Authorities' tab"
    echo "   - Click 'Import' and select: $CA_CERT"
    echo "   - Check 'Trust this CA to identify websites'"
    echo ""
    echo -e "${GREEN}Would you like to add it to the system keychain now? [y/N]${NC}"
    read -r response
    if [[ "$response" =~ ^([yY][eE][sS]|[yY])$ ]]; then
        sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain "$CA_CERT"
        echo -e "${GREEN}✅ CA certificate added to system keychain${NC}"
        echo -e "${YELLOW}⚠️  Firefox users still need to manually import it${NC}"
    fi

else
    echo -e "${YELLOW}⚠️  Unknown operating system${NC}"
    echo ""
    echo "Please manually import the CA certificate:"
    echo "  Location: $CA_CERT"
    echo ""
    echo "Import it into your browser/system trust store to avoid HTTPS warnings."
fi

echo ""
echo -e "${BLUE}ℹ️  This CA certificate is only for local development.${NC}"
echo -e "${BLUE}   It is stored in .dev-ca/ (gitignored) and never leaves your machine.${NC}"
