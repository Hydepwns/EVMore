# Deployment Scripts

This directory contains deployment scripts for the 1inch Fusion+ Cosmos Extension contracts.

## Prerequisites

### For Ethereum Deployment
- Node.js 18+
- Hardhat configured with network settings
- Private key with sufficient ETH for gas fees
- Etherscan API key (for verification)

### For Cosmos Deployment
- `osmosisd` CLI installed
- Keyring with funded account
- Access to RPC endpoints

## Scripts

### `deploy-ethereum.ts`
Deploys Ethereum contracts (CrossChainHTLC and FusionResolver) to any EVM network.

```bash
npx hardhat run scripts/deploy/deploy-ethereum.ts --network sepolia
```

### `deploy-cosmwasm.sh`
Deploys CosmWasm contracts (HTLC, Router, Registry) to Cosmos chains.

```bash
./scripts/deploy/deploy-cosmwasm.sh
```

Environment variables:
- `CHAIN_ID`: Target chain ID (default: osmo-test-5)
- `NODE`: RPC endpoint
- `KEY_NAME`: Key name in keyring (default: deployer)
- `GAS_PRICES`: Gas price setting

### `deploy-all.ts`
Orchestrates deployment across multiple networks.

```bash
# Deploy to all configured networks
npm run deploy:all

# Deploy to specific network
npm run deploy:all ethereum-sepolia
```

## Configuration

Network configurations are defined in `deploy-all.ts`. Add new networks by extending the `networks` array.

## Deployment Outputs

Deployment addresses are saved to:
- `deployments/ethereum-{network}.json` - Ethereum deployments
- `deployments/cosmwasm-{chain-id}.json` - Cosmos deployments
- `deployments/manifest.json` - Combined deployment manifest

## Verification

Ethereum contracts are automatically verified on Etherscan if:
1. Not on localhost/hardhat network
2. Etherscan API key is configured
3. Network is supported by Etherscan

## Post-Deployment

After deployment:
1. Update relayer configuration with new contract addresses
2. Set up IBC channels between Cosmos chains
3. Configure registry with chain and path information
4. Test cross-chain transfers