#!/bin/bash

# Setup IBC Relayer for 1inch Fusion+ Cosmos Extension
# Configures Hermes relayer for multi-chain packet relay

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="$SCRIPT_DIR/hermes-config.toml"
DEPLOYMENTS_DIR="$SCRIPT_DIR/../../deployments"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${BLUE}🔧 Setting up Hermes IBC Relayer${NC}\n"

# Function to install Hermes
install_hermes() {
    if command -v hermes &> /dev/null; then
        echo -e "${GREEN}✅ Hermes is already installed${NC}"
        hermes version
        return
    fi
    
    echo -e "${BLUE}Installing Hermes...${NC}"
    
    # Detect OS
    case "$(uname -s)" in
        Darwin*)
            echo "Installing Hermes on macOS..."
            if command -v brew &> /dev/null; then
                brew install hermes
            else
                echo -e "${RED}❌ Homebrew not found. Please install Homebrew first.${NC}"
                exit 1
            fi
            ;;
        Linux*)
            echo "Installing Hermes on Linux..."
            # Download latest release
            HERMES_VERSION="1.7.4"
            wget https://github.com/informalsystems/hermes/releases/download/v${HERMES_VERSION}/hermes-v${HERMES_VERSION}-x86_64-unknown-linux-gnu.tar.gz
            tar -xzf hermes-v${HERMES_VERSION}-x86_64-unknown-linux-gnu.tar.gz
            sudo mv hermes /usr/local/bin/
            rm hermes-v${HERMES_VERSION}-x86_64-unknown-linux-gnu.tar.gz
            ;;
        *)
            echo -e "${RED}❌ Unsupported operating system${NC}"
            exit 1
            ;;
    esac
    
    echo -e "${GREEN}✅ Hermes installed successfully${NC}"
}

# Function to setup keys
setup_keys() {
    echo -e "${BLUE}Setting up relayer keys...${NC}"
    
    # Create keys directory
    mkdir -p ~/.hermes/keys
    
    # Add keys for each chain
    for chain in "osmo-test-5" "uni-6" "theta-testnet-001"; do
        echo -e "Adding key for $chain..."
        
        # Export key from chain binary
        case $chain in
            "osmo-test-5")
                osmosisd keys export relayer --keyring-backend test 2>/dev/null > ~/.hermes/keys/$chain.json || true
                ;;
            "uni-6")
                junod keys export relayer --keyring-backend test 2>/dev/null > ~/.hermes/keys/$chain.json || true
                ;;
            "theta-testnet-001")
                gaiad keys export relayer --keyring-backend test 2>/dev/null > ~/.hermes/keys/$chain.json || true
                ;;
        esac
        
        # Import key to Hermes
        if [ -f ~/.hermes/keys/$chain.json ]; then
            hermes keys add --chain $chain --key-file ~/.hermes/keys/$chain.json || true
        else
            echo -e "${YELLOW}⚠️  Key not found for $chain. Please create it manually.${NC}"
        fi
    done
    
    echo -e "${GREEN}✅ Keys setup complete${NC}"
}

# Function to setup configuration
setup_config() {
    echo -e "${BLUE}Setting up Hermes configuration...${NC}"
    
    # Create config directory
    mkdir -p ~/.hermes
    
    # Copy configuration
    cp "$CONFIG_FILE" ~/.hermes/config.toml
    
    echo -e "${GREEN}✅ Configuration copied to ~/.hermes/config.toml${NC}"
}

# Function to health check
health_check() {
    echo -e "${BLUE}Running health check...${NC}"
    
    hermes health-check || {
        echo -e "${YELLOW}⚠️  Some chains may be unreachable. Check your configuration.${NC}"
    }
}

# Function to create client/connection/channel
setup_path() {
    local src_chain=$1
    local dst_chain=$2
    local path_name="${src_chain}-${dst_chain}"
    
    echo -e "${BLUE}Setting up path: $path_name${NC}"
    
    # Check if path already exists
    if hermes query clients --host-chain $src_chain --reference-chain $dst_chain 2>/dev/null | grep -q "client"; then
        echo -e "${YELLOW}Path already exists, skipping...${NC}"
        return
    fi
    
    # Create path (client, connection, and channel)
    hermes create channel \
        --a-chain $src_chain \
        --b-chain $dst_chain \
        --a-port transfer \
        --b-port transfer \
        --new-client-connection \
        --yes || {
        echo -e "${RED}❌ Failed to create path${NC}"
        return 1
    }
    
    echo -e "${GREEN}✅ Path created successfully${NC}"
}

# Function to start relayer
start_relayer() {
    echo -e "${BLUE}Starting Hermes relayer...${NC}"
    
    # Check if already running
    if pgrep -x "hermes" > /dev/null; then
        echo -e "${YELLOW}⚠️  Hermes is already running${NC}"
        return
    fi
    
    # Start in background
    echo "Starting Hermes in background..."
    nohup hermes start > ~/.hermes/hermes.log 2>&1 &
    
    sleep 3
    
    if pgrep -x "hermes" > /dev/null; then
        echo -e "${GREEN}✅ Hermes started successfully${NC}"
        echo "Logs: tail -f ~/.hermes/hermes.log"
    else
        echo -e "${RED}❌ Failed to start Hermes${NC}"
        echo "Check logs: cat ~/.hermes/hermes.log"
        return 1
    fi
}

# Function to monitor relayer
monitor_relayer() {
    echo -e "${BLUE}Monitoring relayer status...${NC}"
    
    # Show current paths
    echo -e "\n${BLUE}Active Paths:${NC}"
    hermes query paths
    
    # Show pending packets
    echo -e "\n${BLUE}Pending Packets:${NC}"
    for chain in "osmo-test-5" "uni-6" "theta-testnet-001"; do
        echo "Chain: $chain"
        hermes query packet pending --chain $chain || true
    done
    
    # Show recent events
    echo -e "\n${BLUE}Recent Events (last 10 lines):${NC}"
    tail -n 10 ~/.hermes/hermes.log || echo "No logs found"
}

# Function to setup systemd service
setup_systemd() {
    echo -e "${BLUE}Setting up systemd service...${NC}"
    
    cat > /tmp/hermes.service << EOF
[Unit]
Description=Hermes IBC Relayer
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$USER
ExecStart=/usr/local/bin/hermes start
Restart=always
RestartSec=3
StandardOutput=append:/var/log/hermes.log
StandardError=append:/var/log/hermes.log

[Install]
WantedBy=multi-user.target
EOF
    
    sudo mv /tmp/hermes.service /etc/systemd/system/
    sudo systemctl daemon-reload
    sudo systemctl enable hermes
    
    echo -e "${GREEN}✅ Systemd service created${NC}"
    echo "Start with: sudo systemctl start hermes"
    echo "Check status: sudo systemctl status hermes"
}

# Main setup flow
main() {
    case "${1:-setup}" in
        "install")
            install_hermes
            ;;
        "setup")
            install_hermes
            setup_config
            setup_keys
            health_check
            ;;
        "paths")
            # Setup all paths
            setup_path "osmo-test-5" "uni-6"
            setup_path "osmo-test-5" "theta-testnet-001"
            setup_path "uni-6" "theta-testnet-001"
            ;;
        "start")
            start_relayer
            ;;
        "stop")
            echo "Stopping Hermes..."
            pkill hermes || echo "Hermes not running"
            ;;
        "monitor")
            monitor_relayer
            ;;
        "systemd")
            setup_systemd
            ;;
        "logs")
            tail -f ~/.hermes/hermes.log
            ;;
        *)
            echo -e "${RED}Unknown command: $1${NC}"
            echo "Usage: $0 [install|setup|paths|start|stop|monitor|systemd|logs]"
            exit 1
            ;;
    esac
}

# Run main function
main "$@"