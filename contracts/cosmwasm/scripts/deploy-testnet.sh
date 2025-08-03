#!/bin/bash
set -e

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🚀 Deploying CosmWasm contracts to testnet...${NC}"

# Check required environment variables
required_vars=("COSMOS_RPC_URL" "COSMOS_CHAIN_ID" "COSMOS_MNEMONIC")
for var in "${required_vars[@]}"; do
    if [ -z "${!var}" ]; then
        echo -e "${RED}❌ Error: $var environment variable is required${NC}"
        exit 1
    fi
done

# Default values
COSMOS_REST_URL=${COSMOS_REST_URL:-"${COSMOS_RPC_URL/rpc/lcd}"}
COSMOS_DENOM=${COSMOS_DENOM:-"uosmo"}
COSMOS_GAS_PRICE=${COSMOS_GAS_PRICE:-"0.025${COSMOS_DENOM}"}
COSMOS_GAS_LIMIT=${COSMOS_GAS_LIMIT:-"2000000"}

echo -e "${YELLOW}📋 Deployment Configuration:${NC}"
echo "RPC URL: $COSMOS_RPC_URL"
echo "Chain ID: $COSMOS_CHAIN_ID"
echo "Gas Price: $COSMOS_GAS_PRICE"
echo "Gas Limit: $COSMOS_GAS_LIMIT"

# Check if osmosisd is available
if ! command -v osmosisd &> /dev/null; then
    echo -e "${RED}❌ osmosisd not found. Installing...${NC}"

    # Download and install osmosisd
    if [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS
        if command -v brew &> /dev/null; then
            brew install osmosis
        else
            echo -e "${RED}❌ Please install Homebrew or manually install osmosisd${NC}"
            exit 1
        fi
    else
        # Linux
        wget https://github.com/osmosis-labs/osmosis/releases/download/v15.2.0/osmosisd-15.2.0-linux-amd64
        chmod +x osmosisd-15.2.0-linux-amd64
        sudo mv osmosisd-15.2.0-linux-amd64 /usr/local/bin/osmosisd
    fi
fi

# Add key if not exists
KEY_NAME="deployer"
if ! osmosisd keys show $KEY_NAME &> /dev/null; then
    echo -e "${YELLOW}🔑 Adding deployer key...${NC}"
    echo "$COSMOS_MNEMONIC" | osmosisd keys add $KEY_NAME --recover --keyring-backend test
fi

DEPLOYER_ADDRESS=$(osmosisd keys show $KEY_NAME -a --keyring-backend test)
echo -e "${GREEN}👤 Deployer address: $DEPLOYER_ADDRESS${NC}"

# Check balance
echo -e "${YELLOW}💰 Checking balance...${NC}"
BALANCE=$(osmosisd query bank balance $DEPLOYER_ADDRESS $COSMOS_DENOM --node $COSMOS_RPC_URL --chain-id $COSMOS_CHAIN_ID --output json | jq -r '.amount // "0"')
echo "Balance: $BALANCE $COSMOS_DENOM"

if [ "$BALANCE" -lt "1000000" ]; then
    echo -e "${RED}❌ Insufficient balance. Need at least 1 $COSMOS_DENOM for deployment${NC}"
    echo -e "${YELLOW}💡 Get testnet tokens from: https://faucet.osmosis.zone/${NC}"
    exit 1
fi

# Build contracts
echo -e "${YELLOW}🔨 Building contracts...${NC}"
cd "$(dirname "$0")/.."
./build.sh

# Check if wasm files exist
if [ ! -f "target/htlc.wasm" ]; then
    echo -e "${RED}❌ HTLC contract not found. Build failed.${NC}"
    exit 1
fi

# Store HTLC contract
echo -e "${YELLOW}📦 Storing HTLC contract...${NC}"
HTLC_STORE_RESULT=$(osmosisd tx wasm store target/htlc.wasm \
    --from $KEY_NAME \
    --gas $COSMOS_GAS_LIMIT \
    --gas-prices $COSMOS_GAS_PRICE \
    --chain-id $COSMOS_CHAIN_ID \
    --node $COSMOS_RPC_URL \
    --keyring-backend test \
    --broadcast-mode block \
    --yes \
    --output json)

# Extract code ID
HTLC_CODE_ID=$(echo $HTLC_STORE_RESULT | jq -r '.logs[0].events[] | select(.type=="store_code") | .attributes[] | select(.key=="code_id") | .value')

if [ "$HTLC_CODE_ID" == "null" ] || [ -z "$HTLC_CODE_ID" ]; then
    echo -e "${RED}❌ Failed to store HTLC contract${NC}"
    echo "Result: $HTLC_STORE_RESULT"
    exit 1
fi

echo -e "${GREEN}✅ HTLC contract stored with code ID: $HTLC_CODE_ID${NC}"

# Instantiate HTLC contract
echo -e "${YELLOW}🏗️ Instantiating HTLC contract...${NC}"
HTLC_INIT_MSG='{"admin":null}'

HTLC_INSTANTIATE_RESULT=$(osmosisd tx wasm instantiate $HTLC_CODE_ID "$HTLC_INIT_MSG" \
    --from $KEY_NAME \
    --label "Fusion HTLC v1.0" \
    --gas $COSMOS_GAS_LIMIT \
    --gas-prices $COSMOS_GAS_PRICE \
    --chain-id $COSMOS_CHAIN_ID \
    --node $COSMOS_RPC_URL \
    --keyring-backend test \
    --broadcast-mode block \
    --yes \
    --output json)

# Extract contract address
HTLC_CONTRACT_ADDRESS=$(echo $HTLC_INSTANTIATE_RESULT | jq -r '.logs[0].events[] | select(.type=="instantiate") | .attributes[] | select(.key=="_contract_address") | .value')

if [ "$HTLC_CONTRACT_ADDRESS" == "null" ] || [ -z "$HTLC_CONTRACT_ADDRESS" ]; then
    echo -e "${RED}❌ Failed to instantiate HTLC contract${NC}"
    echo "Result: $HTLC_INSTANTIATE_RESULT"
    exit 1
fi

echo -e "${GREEN}✅ HTLC contract instantiated at: $HTLC_CONTRACT_ADDRESS${NC}"

# Test contract by querying it
echo -e "${YELLOW}🧪 Testing contract...${NC}"
TEST_QUERY='{"list_htlcs":{"limit":1}}'
TEST_RESULT=$(osmosisd query wasm contract-state smart $HTLC_CONTRACT_ADDRESS "$TEST_QUERY" \
    --chain-id $COSMOS_CHAIN_ID \
    --node $COSMOS_RPC_URL \
    --output json)

if echo $TEST_RESULT | jq -e '.data' > /dev/null; then
    echo -e "${GREEN}✅ Contract query successful${NC}"
else
    echo -e "${YELLOW}⚠️ Contract query failed, but deployment seems successful${NC}"
fi

# Save deployment information
echo -e "${YELLOW}💾 Saving deployment information...${NC}"
DEPLOYMENT_FILE="deployments-${COSMOS_CHAIN_ID}.json"
cat > $DEPLOYMENT_FILE << EOF
{
  "network": "$COSMOS_CHAIN_ID",
  "rpcUrl": "$COSMOS_RPC_URL",
  "restUrl": "$COSMOS_REST_URL",
  "deployer": "$DEPLOYER_ADDRESS",
  "contracts": {
    "htlc": {
      "codeId": $HTLC_CODE_ID,
      "address": "$HTLC_CONTRACT_ADDRESS"
    }
  },
  "deployedAt": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
}
EOF

echo -e "${GREEN}✅ Deployment information saved to $DEPLOYMENT_FILE${NC}"

# Print summary
echo -e "${BLUE}📋 Deployment Summary:${NC}"
echo -e "${GREEN}✅ HTLC Code ID: $HTLC_CODE_ID${NC}"
echo -e "${GREEN}✅ HTLC Contract: $HTLC_CONTRACT_ADDRESS${NC}"
echo -e "${GREEN}✅ Network: $COSMOS_CHAIN_ID${NC}"
echo -e "${GREEN}✅ Explorer: https://testnet.mintscan.io/${COSMOS_CHAIN_ID}/account/$HTLC_CONTRACT_ADDRESS${NC}"

# Export environment variables for relayer
echo -e "${YELLOW}🔧 Environment variables for relayer:${NC}"
cat << EOF
export COSMOS_HTLC_CONTRACT="$HTLC_CONTRACT_ADDRESS"
export COSMOS_RPC_URL="$COSMOS_RPC_URL"
export COSMOS_REST_URL="$COSMOS_REST_URL"
export COSMOS_CHAIN_ID="$COSMOS_CHAIN_ID"
EOF

echo -e "${BLUE}🎉 CosmWasm deployment complete!${NC}"
