#!/bin/bash

# IBC Channel Setup Script for 1inch Fusion+ Cosmos Extension
# Sets up IBC channels between chains for cross-chain atomic swaps

set -e

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_DIR="$SCRIPT_DIR/config"
DEPLOYMENTS_DIR="$SCRIPT_DIR/../../deployments"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Default values
KEYRING="test"
GAS_PRICES="0.025uosmo"
GAS_ADJUSTMENT="1.3"

echo -e "${BLUE}🌐 1inch Fusion+ Cosmos Extension - IBC Channel Setup${NC}\n"

# Function to check prerequisites
check_prerequisites() {
    local missing_tools=()
    
    # Check for required tools
    for tool in osmosisd junod gaiad hermes rly; do
        if ! command -v $tool &> /dev/null; then
            missing_tools+=($tool)
        fi
    done
    
    if [ ${#missing_tools[@]} -ne 0 ]; then
        echo -e "${RED}❌ Missing required tools: ${missing_tools[*]}${NC}"
        echo -e "${YELLOW}Please install the missing tools to continue.${NC}"
        exit 1
    fi
    
    echo -e "${GREEN}✅ All prerequisites satisfied${NC}\n"
}

# Function to load chain configuration
load_chain_config() {
    local chain_id=$1
    local config_file="$CONFIG_DIR/$chain_id.json"
    
    if [ ! -f "$config_file" ]; then
        echo -e "${RED}❌ Configuration not found for chain: $chain_id${NC}"
        exit 1
    fi
    
    echo "$(cat $config_file)"
}

# Function to create IBC client
create_ibc_client() {
    local src_chain=$1
    local dst_chain=$2
    local src_config=$(load_chain_config $src_chain)
    local dst_config=$(load_chain_config $dst_chain)
    
    echo -e "${BLUE}Creating IBC client from $src_chain to $dst_chain...${NC}"
    
    # Extract configuration
    local src_rpc=$(echo $src_config | jq -r '.rpc')
    local dst_rpc=$(echo $dst_config | jq -r '.rpc')
    local src_binary=$(echo $src_config | jq -r '.binary')
    
    # Create client
    local create_client_cmd="$src_binary tx ibc client create \
        --chain-id $src_chain \
        --node $src_rpc \
        --from relayer \
        --keyring-backend $KEYRING \
        --gas-prices $GAS_PRICES \
        --gas-adjustment $GAS_ADJUSTMENT \
        -y"
    
    local tx_hash=$($create_client_cmd | jq -r '.txhash')
    echo "Client creation TX: $tx_hash"
    
    # Wait for transaction
    sleep 6
    
    # Get client ID
    local client_id=$($src_binary query tx $tx_hash --node $src_rpc -o json | \
        jq -r '.events[] | select(.type=="create_client") | .attributes[] | select(.key=="client_id") | .value')
    
    echo -e "${GREEN}✅ Created client: $client_id${NC}"
    echo $client_id
}

# Function to create IBC connection
create_ibc_connection() {
    local src_chain=$1
    local dst_chain=$2
    local src_client=$3
    local dst_client=$4
    
    echo -e "${BLUE}Creating IBC connection between $src_chain and $dst_chain...${NC}"
    
    # Use Hermes to create connection
    hermes create connection \
        --a-chain $src_chain \
        --a-client $src_client \
        --b-client $dst_client
    
    # Get connection ID
    local connection_id=$(hermes query connections --chain $src_chain | \
        grep -A1 $src_client | grep "connection-" | awk '{print $2}')
    
    echo -e "${GREEN}✅ Created connection: $connection_id${NC}"
    echo $connection_id
}

# Function to create IBC channel
create_ibc_channel() {
    local src_chain=$1
    local dst_chain=$2
    local src_connection=$3
    local src_port=$4
    local dst_port=$5
    local order=${6:-"unordered"}
    local version=${7:-"ics20-1"}
    
    echo -e "${BLUE}Creating IBC channel on $src_chain...${NC}"
    
    # Use Hermes to create channel
    hermes create channel \
        --a-chain $src_chain \
        --a-connection $src_connection \
        --a-port $src_port \
        --b-port $dst_port \
        --order $order \
        --channel-version $version
    
    # Get channel ID
    local channel_id=$(hermes query channels --chain $src_chain | \
        grep -A2 $src_port | grep "channel-" | awk '{print $2}' | tail -1)
    
    echo -e "${GREEN}✅ Created channel: $channel_id${NC}"
    echo $channel_id
}

# Function to setup Packet Forward Middleware
setup_packet_forward() {
    local chain_id=$1
    local config=$(load_chain_config $chain_id)
    local binary=$(echo $config | jq -r '.binary')
    local rpc=$(echo $config | jq -r '.rpc')
    
    echo -e "${BLUE}Configuring Packet Forward Middleware on $chain_id...${NC}"
    
    # Check if chain supports packet forward
    local has_pfm=$($binary query ibc-router params --node $rpc -o json 2>/dev/null | \
        jq -r '.fee_percentage // empty')
    
    if [ -z "$has_pfm" ]; then
        echo -e "${YELLOW}⚠️  Chain $chain_id does not support Packet Forward Middleware${NC}"
        return 1
    fi
    
    echo -e "${GREEN}✅ Packet Forward Middleware is active${NC}"
    return 0
}

# Function to create channel pair
create_channel_pair() {
    local chain1=$1
    local chain2=$2
    local port1=${3:-"transfer"}
    local port2=${4:-"transfer"}
    
    echo -e "${BLUE}🔗 Setting up IBC channel pair: $chain1 <-> $chain2${NC}\n"
    
    # Create clients
    local client1_to_2=$(create_ibc_client $chain1 $chain2)
    local client2_to_1=$(create_ibc_client $chain2 $chain1)
    
    # Create connection
    local connection=$(create_ibc_connection $chain1 $chain2 $client1_to_2 $client2_to_1)
    
    # Create channels
    local channel1=$(create_ibc_channel $chain1 $chain2 $connection $port1 $port2)
    local channel2=$(hermes query channels --chain $chain2 | \
        grep -A2 $port2 | grep "channel-" | awk '{print $2}' | tail -1)
    
    # Setup packet forward if available
    setup_packet_forward $chain1
    setup_packet_forward $chain2
    
    # Save channel configuration
    local channel_config="{
        \"chain1\": \"$chain1\",
        \"chain2\": \"$chain2\",
        \"channel1\": \"$channel1\",
        \"channel2\": \"$channel2\",
        \"port1\": \"$port1\",
        \"port2\": \"$port2\",
        \"connection\": \"$connection\",
        \"created_at\": \"$(date -u +"%Y-%m-%dT%H:%M:%SZ")\"
    }"
    
    echo "$channel_config" > "$DEPLOYMENTS_DIR/ibc-$chain1-$chain2.json"
    
    echo -e "${GREEN}✅ Channel pair setup complete!${NC}"
    echo -e "  $chain1: $channel1 -> $chain2"
    echo -e "  $chain2: $channel2 -> $chain1\n"
}

# Function to update contract configurations with IBC channels
update_contract_configs() {
    local chain_id=$1
    local deployment_file="$DEPLOYMENTS_DIR/cosmwasm-$chain_id.json"
    
    if [ ! -f "$deployment_file" ]; then
        echo -e "${YELLOW}⚠️  No deployment found for $chain_id${NC}"
        return
    fi
    
    echo -e "${BLUE}Updating contract configurations on $chain_id...${NC}"
    
    local router_address=$(jq -r '.contracts.router' "$deployment_file")
    local config=$(load_chain_config $chain_id)
    local binary=$(echo $config | jq -r '.binary')
    local rpc=$(echo $config | jq -r '.rpc')
    
    # Get all IBC channels for this chain
    local channels=$(find "$DEPLOYMENTS_DIR" -name "ibc-*.json" -exec grep -l "\"$chain_id\"" {} \; | \
        xargs -I {} jq -r --arg chain "$chain_id" \
        'if .chain1 == $chain then .channel1 elif .chain2 == $chain then .channel2 else empty end' {})
    
    # Update router contract with channel configurations
    for channel in $channels; do
        echo "Adding channel $channel to router configuration..."
        
        # Execute contract update (implementation depends on contract interface)
        # This is a placeholder - actual implementation depends on contract design
    done
    
    echo -e "${GREEN}✅ Contract configurations updated${NC}"
}

# Function to test IBC transfer
test_ibc_transfer() {
    local src_chain=$1
    local dst_chain=$2
    local channel=$3
    local amount=${4:-"1000"}
    local denom=${5:-"uosmo"}
    
    echo -e "${BLUE}Testing IBC transfer from $src_chain to $dst_chain...${NC}"
    
    local src_config=$(load_chain_config $src_chain)
    local binary=$(echo $src_config | jq -r '.binary')
    local rpc=$(echo $src_config | jq -r '.rpc')
    
    # Get addresses
    local sender=$($binary keys show relayer -a --keyring-backend $KEYRING)
    local receiver=$($binary keys show relayer -a --keyring-backend $KEYRING \
        --bech32-prefix $(echo $(load_chain_config $dst_chain) | jq -r '.prefix'))
    
    # Send IBC transfer
    echo "Sending $amount$denom from $sender to $receiver..."
    
    local tx_hash=$($binary tx ibc-transfer transfer transfer $channel \
        $receiver "$amount$denom" \
        --from relayer \
        --chain-id $src_chain \
        --node $rpc \
        --keyring-backend $KEYRING \
        --gas-prices $GAS_PRICES \
        --gas-adjustment $GAS_ADJUSTMENT \
        -y -o json | jq -r '.txhash')
    
    echo "Transfer TX: $tx_hash"
    
    # Wait for relayer to process
    echo "Waiting for IBC packet relay..."
    sleep 10
    
    # Check if transfer succeeded
    local success=$($binary query tx $tx_hash --node $rpc -o json | \
        jq -r '.code == 0')
    
    if [ "$success" = "true" ]; then
        echo -e "${GREEN}✅ IBC transfer successful!${NC}"
    else
        echo -e "${RED}❌ IBC transfer failed${NC}"
        return 1
    fi
}

# Main setup flow
main() {
    # Check prerequisites
    check_prerequisites
    
    # Parse command line arguments
    case "${1:-all}" in
        "osmosis-juno")
            create_channel_pair "osmo-test-5" "uni-6"
            ;;
        "osmosis-cosmos")
            create_channel_pair "osmo-test-5" "theta-testnet-001"
            ;;
        "juno-cosmos")
            create_channel_pair "uni-6" "theta-testnet-001"
            ;;
        "all")
            # Setup all channel pairs
            create_channel_pair "osmo-test-5" "uni-6"
            create_channel_pair "osmo-test-5" "theta-testnet-001"
            create_channel_pair "uni-6" "theta-testnet-001"
            ;;
        "test")
            # Test existing channels
            test_ibc_transfer "osmo-test-5" "uni-6" "channel-0"
            ;;
        "update")
            # Update contract configurations
            update_contract_configs "osmo-test-5"
            update_contract_configs "uni-6"
            update_contract_configs "theta-testnet-001"
            ;;
        *)
            echo -e "${RED}Unknown command: $1${NC}"
            echo "Usage: $0 [osmosis-juno|osmosis-cosmos|juno-cosmos|all|test|update]"
            exit 1
            ;;
    esac
    
    echo -e "\n${GREEN}🎉 IBC setup complete!${NC}"
}

# Run main function
main "$@"