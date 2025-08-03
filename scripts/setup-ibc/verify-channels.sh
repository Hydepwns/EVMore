#!/bin/bash

# Verify IBC Channels for 1inch Fusion+ Cosmos Extension
# Tests and verifies IBC channel connectivity

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_DIR="$SCRIPT_DIR/config"
DEPLOYMENTS_DIR="$SCRIPT_DIR/../../deployments"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${BLUE}🔍 Verifying IBC Channels${NC}\n"

# Function to check channel status
check_channel_status() {
    local chain_id=$1
    local channel_id=$2
    local config_file="$CONFIG_DIR/$chain_id.json"
    
    if [ ! -f "$config_file" ]; then
        echo -e "${RED}❌ Configuration not found for chain: $chain_id${NC}"
        return 1
    fi
    
    local binary=$(jq -r '.binary' "$config_file")
    local rpc=$(jq -r '.rpc' "$config_file")
    
    echo -e "${BLUE}Checking channel $channel_id on $chain_id...${NC}"
    
    # Query channel
    local channel_info=$($binary query ibc channel channels $channel_id \
        --node $rpc --output json 2>/dev/null || echo "{}")
    
    local state=$(echo "$channel_info" | jq -r '.channel.state // "NOT_FOUND"')
    
    case $state in
        "STATE_OPEN")
            echo -e "${GREEN}✅ Channel is OPEN${NC}"
            return 0
            ;;
        "STATE_CLOSED")
            echo -e "${RED}❌ Channel is CLOSED${NC}"
            return 1
            ;;
        "STATE_INIT"|"STATE_TRYOPEN")
            echo -e "${YELLOW}⚠️  Channel is in handshake: $state${NC}"
            return 1
            ;;
        *)
            echo -e "${RED}❌ Channel not found or invalid state: $state${NC}"
            return 1
            ;;
    esac
}

# Function to check client status
check_client_status() {
    local chain_id=$1
    local client_id=$2
    local config_file="$CONFIG_DIR/$chain_id.json"
    
    local binary=$(jq -r '.binary' "$config_file")
    local rpc=$(jq -r '.rpc' "$config_file")
    
    echo -e "${BLUE}Checking client $client_id on $chain_id...${NC}"
    
    # Query client state
    local client_state=$($binary query ibc client state $client_id \
        --node $rpc --output json 2>/dev/null || echo "{}")
    
    if [ "$(echo "$client_state" | jq -r '.client_state.type // ""')" = "NOT_FOUND" ]; then
        echo -e "${RED}❌ Client not found${NC}"
        return 1
    fi
    
    # Check if client is active
    local status=$($binary query ibc client status $client_id \
        --node $rpc --output text 2>/dev/null || echo "Unknown")
    
    if [ "$status" = "Active" ]; then
        echo -e "${GREEN}✅ Client is active${NC}"
        return 0
    else
        echo -e "${RED}❌ Client status: $status${NC}"
        return 1
    fi
}

# Function to verify channel pair
verify_channel_pair() {
    local ibc_file=$1
    
    if [ ! -f "$ibc_file" ]; then
        echo -e "${RED}❌ IBC configuration not found: $ibc_file${NC}"
        return 1
    fi
    
    local config=$(cat "$ibc_file")
    local chain1=$(echo "$config" | jq -r '.chain1')
    local chain2=$(echo "$config" | jq -r '.chain2')
    local channel1=$(echo "$config" | jq -r '.channel1')
    local channel2=$(echo "$config" | jq -r '.channel2')
    
    echo -e "\n${BLUE}Verifying channel pair: $chain1 <-> $chain2${NC}"
    echo "Channels: $channel1 <-> $channel2"
    
    local success=true
    
    # Check channel on chain1
    if ! check_channel_status "$chain1" "$channel1"; then
        success=false
    fi
    
    # Check channel on chain2
    if ! check_channel_status "$chain2" "$channel2"; then
        success=false
    fi
    
    if [ "$success" = true ]; then
        echo -e "${GREEN}✅ Channel pair is healthy${NC}"
        return 0
    else
        echo -e "${RED}❌ Channel pair has issues${NC}"
        return 1
    fi
}

# Function to test packet relay
test_packet_relay() {
    local src_chain=$1
    local dst_chain=$2
    local channel=$3
    local amount="1000"
    
    echo -e "\n${BLUE}Testing packet relay: $src_chain -> $dst_chain${NC}"
    
    local config_file="$CONFIG_DIR/$src_chain.json"
    local binary=$(jq -r '.binary' "$config_file")
    local rpc=$(jq -r '.rpc' "$config_file")
    local denom=$(jq -r '.denom' "$config_file")
    local dst_prefix=$(jq -r '.prefix' "$CONFIG_DIR/$dst_chain.json")
    
    # Get addresses
    local sender=$($binary keys show relayer -a --keyring-backend test 2>/dev/null || echo "")
    local receiver=$($binary keys show relayer -a --keyring-backend test \
        --bech32-prefix "$dst_prefix" 2>/dev/null || echo "")
    
    if [ -z "$sender" ] || [ -z "$receiver" ]; then
        echo -e "${YELLOW}⚠️  Cannot test: Missing relayer keys${NC}"
        return 1
    fi
    
    # Create IBC transfer
    echo "Sending $amount$denom from $sender to $receiver..."
    
    local tx_result=$($binary tx ibc-transfer transfer transfer "$channel" \
        "$receiver" "$amount$denom" \
        --from relayer \
        --chain-id "$src_chain" \
        --node "$rpc" \
        --keyring-backend test \
        --gas-prices "0.025$denom" \
        --gas-adjustment 1.3 \
        --broadcast-mode sync \
        -y --output json 2>/dev/null || echo "{}")
    
    local tx_hash=$(echo "$tx_result" | jq -r '.txhash // ""')
    
    if [ -z "$tx_hash" ]; then
        echo -e "${RED}❌ Failed to create transfer${NC}"
        return 1
    fi
    
    echo "TX Hash: $tx_hash"
    echo "Waiting for packet relay..."
    
    # Wait for transaction to be processed
    sleep 10
    
    # Check packet commitment
    local packets=$($binary query ibc channel packet-commitments transfer "$channel" \
        --node "$rpc" --output json 2>/dev/null || echo "{}")
    
    local num_packets=$(echo "$packets" | jq '.commitments | length')
    
    if [ "$num_packets" -gt 0 ]; then
        echo -e "${YELLOW}⚠️  Found $num_packets pending packets${NC}"
        echo "Relayer may need to be started or checked"
        return 1
    else
        echo -e "${GREEN}✅ Packet relayed successfully${NC}"
        return 0
    fi
}

# Function to check all channels
check_all_channels() {
    echo -e "${BLUE}Checking all configured channels...${NC}\n"
    
    local all_healthy=true
    
    # Find all IBC configuration files
    for ibc_file in "$DEPLOYMENTS_DIR"/ibc-*.json; do
        if [ -f "$ibc_file" ]; then
            if ! verify_channel_pair "$ibc_file"; then
                all_healthy=false
            fi
        fi
    done
    
    if [ "$all_healthy" = true ]; then
        echo -e "\n${GREEN}✅ All channels are healthy${NC}"
        return 0
    else
        echo -e "\n${RED}❌ Some channels have issues${NC}"
        return 1
    fi
}

# Function to show channel summary
show_channel_summary() {
    echo -e "${BLUE}📊 IBC Channel Summary${NC}\n"
    
    # Show all configured channels
    for ibc_file in "$DEPLOYMENTS_DIR"/ibc-*.json; do
        if [ -f "$ibc_file" ]; then
            local config=$(cat "$ibc_file")
            local chain1=$(echo "$config" | jq -r '.chain1')
            local chain2=$(echo "$config" | jq -r '.chain2')
            local channel1=$(echo "$config" | jq -r '.channel1')
            local channel2=$(echo "$config" | jq -r '.channel2')
            local created=$(echo "$config" | jq -r '.created_at')
            
            echo "Channel Pair: $chain1 <-> $chain2"
            echo "  $chain1: $channel1"
            echo "  $chain2: $channel2"
            echo "  Created: $created"
            echo ""
        fi
    done
    
    # Show Hermes status if available
    if command -v hermes &> /dev/null; then
        echo -e "${BLUE}Hermes Relayer Status:${NC}"
        if pgrep -x "hermes" > /dev/null; then
            echo -e "${GREEN}✅ Running${NC}"
        else
            echo -e "${RED}❌ Not running${NC}"
        fi
    fi
}

# Main verification flow
main() {
    case "${1:-all}" in
        "channels")
            check_all_channels
            ;;
        "relay")
            # Test specific relay path
            if [ $# -lt 3 ]; then
                echo "Usage: $0 relay <src-chain> <dst-chain>"
                exit 1
            fi
            test_packet_relay "$2" "$3" "channel-0"
            ;;
        "summary")
            show_channel_summary
            ;;
        "all")
            show_channel_summary
            echo ""
            check_all_channels
            ;;
        *)
            echo -e "${RED}Unknown command: $1${NC}"
            echo "Usage: $0 [channels|relay|summary|all]"
            exit 1
            ;;
    esac
}

# Run main function
main "$@"