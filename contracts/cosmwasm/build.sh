#!/bin/bash
set -e

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}Building CosmWasm contracts...${NC}"

# Build each contract (only build implemented ones)
for contract in htlc; do
    echo -e "\n${GREEN}Building $contract...${NC}"
    cd $contract

    # Build in release mode with optimization
    RUSTFLAGS='-C link-arg=-s' cargo build --release --target wasm32-unknown-unknown --locked

    # Optional: Optimize with wasm-opt if available
    if command -v wasm-opt &> /dev/null; then
        echo -e "${GREEN}Optimizing $contract...${NC}"
        wasm-opt -Os -o ../../target/$contract-optimized.wasm ../../target/wasm32-unknown-unknown/release/fusion_${contract}.wasm
    else
        echo -e "${YELLOW}wasm-opt not found, copying unoptimized wasm${NC}"
        cp ../../target/wasm32-unknown-unknown/release/fusion_${contract}.wasm ../../target/$contract.wasm
    fi

    cd ..
done

echo -e "\n${GREEN}Build complete!${NC}"
echo -e "${GREEN}Contracts are available in target/ directory${NC}"
