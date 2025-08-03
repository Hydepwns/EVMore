#!/bin/bash

# Deploy CosmWasm contracts to Osmosis testnet

set -e

# Configuration
CHAIN_ID="${CHAIN_ID:-osmo-test-5}"
NODE="${NODE:-https://rpc.testnet.osmosis.zone:443}"
KEYRING="${KEYRING:-test}"
KEY_NAME="${KEY_NAME:-deployer}"
GAS_PRICES="${GAS_PRICES:-0.025uosmo}"
GAS_ADJUSTMENT="${GAS_ADJUSTMENT:-1.3}"

# Contract paths
HTLC_WASM="../../contracts/cosmwasm/target/wasm32-unknown-unknown/release/fusion_htlc.wasm"
ROUTER_WASM="../../contracts/cosmwasm/target/wasm32-unknown-unknown/release/fusion_router.wasm"
REGISTRY_WASM="../../contracts/cosmwasm/target/wasm32-unknown-unknown/release/fusion_registry.wasm"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🚀 Starting CosmWasm contracts deployment...${NC}\n"

# Check if osmosisd is installed
if ! command -v osmosisd &> /dev/null; then
    echo -e "${RED}❌ osmosisd not found! Please install it first.${NC}"
    exit 1
fi

# Get deployer address
DEPLOYER=$(osmosisd keys show $KEY_NAME -a --keyring-backend $KEYRING)
echo -e "${GREEN}👤 Deployer: $DEPLOYER${NC}"

# Check balance
BALANCE=$(osmosisd query bank balances $DEPLOYER --node $NODE -o json | jq -r '.balances[0].amount // "0"')
echo -e "${GREEN}💰 Balance: $((BALANCE / 1000000)) OSMO${NC}\n"

# Function to upload and instantiate contract
deploy_contract() {
    local WASM_FILE=$1
    local CONTRACT_NAME=$2
    local INIT_MSG=$3
    
    echo -e "${BLUE}📦 Deploying $CONTRACT_NAME...${NC}"
    
    # Upload contract
    echo "Uploading contract..."
    TX_UPLOAD=$(osmosisd tx wasm store $WASM_FILE \
        --from $KEY_NAME \
        --keyring-backend $KEYRING \
        --chain-id $CHAIN_ID \
        --node $NODE \
        --gas-prices $GAS_PRICES \
        --gas-adjustment $GAS_ADJUSTMENT \
        --broadcast-mode sync \
        -y -o json)
    
    UPLOAD_TXHASH=$(echo $TX_UPLOAD | jq -r '.txhash')
    echo "Upload TX: $UPLOAD_TXHASH"
    
    # Wait for transaction
    sleep 6
    
    # Get code ID
    CODE_ID=$(osmosisd query tx $UPLOAD_TXHASH --node $NODE -o json | jq -r '.events[] | select(.type=="store_code") | .attributes[] | select(.key=="code_id") | .value')
    echo -e "${GREEN}✅ Contract uploaded! Code ID: $CODE_ID${NC}"
    
    # Instantiate contract
    echo "Instantiating contract..."
    TX_INIT=$(osmosisd tx wasm instantiate $CODE_ID "$INIT_MSG" \
        --from $KEY_NAME \
        --keyring-backend $KEYRING \
        --label "$CONTRACT_NAME" \
        --chain-id $CHAIN_ID \
        --node $NODE \
        --gas-prices $GAS_PRICES \
        --gas-adjustment $GAS_ADJUSTMENT \
        --broadcast-mode sync \
        --admin $DEPLOYER \
        -y -o json)
    
    INIT_TXHASH=$(echo $TX_INIT | jq -r '.txhash')
    echo "Instantiate TX: $INIT_TXHASH"
    
    # Wait for transaction
    sleep 6
    
    # Get contract address
    CONTRACT_ADDRESS=$(osmosisd query tx $INIT_TXHASH --node $NODE -o json | jq -r '.events[] | select(.type=="instantiate") | .attributes[] | select(.key=="_contract_address") | .value')
    echo -e "${GREEN}✅ Contract instantiated at: $CONTRACT_ADDRESS${NC}\n"
    
    echo "$CONTRACT_ADDRESS"
}

# Build contracts if needed
if [ ! -f "$HTLC_WASM" ] || [ ! -f "$ROUTER_WASM" ] || [ ! -f "$REGISTRY_WASM" ]; then
    echo -e "${BLUE}🔨 Building contracts...${NC}"
    cd ../../contracts/cosmwasm
    cargo build --release --target wasm32-unknown-unknown
    cd -
fi

# Deploy HTLC contract
HTLC_INIT='{"admin":null}'
HTLC_ADDRESS=$(deploy_contract $HTLC_WASM "fusion-htlc" "$HTLC_INIT")

# Deploy Router contract
ROUTER_INIT='{
  "admin": null,
  "supported_chains": [
    {
      "chain_id": "osmosis-1",
      "chain_prefix": "osmo",
      "ibc_channel": "channel-0",
      "native_denom": "uosmo"
    }
  ]
}'
ROUTER_ADDRESS=$(deploy_contract $ROUTER_WASM "fusion-router" "$ROUTER_INIT")

# Deploy Registry contract
REGISTRY_INIT='{"admin":null}'
REGISTRY_ADDRESS=$(deploy_contract $REGISTRY_WASM "fusion-registry" "$REGISTRY_INIT")

# Save deployment info
DEPLOYMENT_FILE="../../deployments/cosmwasm-$CHAIN_ID.json"
mkdir -p ../../deployments

cat > $DEPLOYMENT_FILE << EOF
{
  "chain_id": "$CHAIN_ID",
  "contracts": {
    "htlc": "$HTLC_ADDRESS",
    "router": "$ROUTER_ADDRESS",
    "registry": "$REGISTRY_ADDRESS"
  },
  "deployed_at": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "deployer": "$DEPLOYER"
}
EOF

echo -e "${GREEN}✅ Deployment complete!${NC}"
echo -e "${GREEN}📄 Addresses saved to: $DEPLOYMENT_FILE${NC}"

# Register some initial chains in the registry
echo -e "\n${BLUE}🔧 Configuring registry...${NC}"

# Register Osmosis
osmosisd tx wasm execute $REGISTRY_ADDRESS \
  '{"register_chain":{"chain_info":{"chain_id":"osmosis-1","chain_name":"Osmosis","chain_type":"cosmos","native_denom":"uosmo","prefix":"osmo","gas_price":"0.025uosmo","htlc_contract":"'$HTLC_ADDRESS'","router_contract":"'$ROUTER_ADDRESS'","active":true,"metadata":{"rpc_endpoints":["https://rpc.osmosis.zone"],"rest_endpoints":["https://rest.osmosis.zone"],"explorer_url":"https://mintscan.io/osmosis","logo_url":null,"block_time_seconds":6}}}}' \
  --from $KEY_NAME \
  --keyring-backend $KEYRING \
  --chain-id $CHAIN_ID \
  --node $NODE \
  --gas-prices $GAS_PRICES \
  --gas-adjustment $GAS_ADJUSTMENT \
  -y

echo -e "${GREEN}✅ Registry configured!${NC}"