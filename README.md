# EVMore - Cross-Chain Atomic Swap Protocol

A cross-chain atomic swap protocol enabling seamless asset transfers between Ethereum and the Cosmos ecosystem, with multi-hop IBC routing capabilities.

## Project Overview

This project implements a cross-chain atomic swap protocol that supports swaps between Ethereum (EVM) and Cosmos-based chains. It leverages HTLCs (Hash Time Lock Contracts), IBC (Inter-Blockchain Communication), and integrates with Osmosis DEX for optimal liquidity routing.

### Key Features

- **Atomic Cross-Chain Swaps**: Secure asset transfers between Ethereum and Cosmos
- **Multi-Hop IBC Routing**: Route through multiple Cosmos chains for optimal paths
- **Dynamic Route Discovery**: Real-time path optimization using Chain Registry
- **Osmosis DEX Integration**: Direct access to Cosmos ecosystem liquidity
- **MEV Protection**: Commit-reveal scheme and threshold encryption
- **Automatic Recovery**: Timeout handling and refund mechanisms

### Stretch Goals Completed

- **Frontend UI**: Modern React interface with Tailwind CSS for intuitive cross-chain swaps
- **Partial Fills**: Advanced order splitting functionality with percentage-based execution

See [STRETCH_GOALS_SUMMARY.md](docs/hackathon/STRETCH_GOALS_SUMMARY.md) for details.

## Project Structure

```bash
EVMore/
├── libs/                        # Enterprise libraries (Turborepo)
│   ├── @evmore/types           # Core type definitions
│   ├── @evmore/interfaces      # Service contracts
│   ├── @evmore/errors          # Structured error handling
│   ├── @evmore/config          # Configuration management
│   ├── @evmore/utils           # Infrastructure utilities
│   ├── @evmore/connection-pool # Connection management
│   └── @evmore/test-utils      # Testing framework
│
├── contracts/                   # Smart contracts
│   ├── ethereum/               # Ethereum/EVM contracts
│   └── cosmwasm/              # CosmWasm contracts
│
├── relayer/                    # Cross-chain relayer
├── sdk/                        # TypeScript SDK
├── frontend/                   # React web interface
├── tests/                      # Comprehensive test suites
├── scripts/                    # Deployment & setup
└── docs/                       # Documentation
```

## Quick Start

### Prerequisites

- Node.js >= 18.0.0
- Rust >= 1.70.0
- CosmWasm CLI tools
- Docker (for local testing)

### Installation

```bash
# Clone the repository
git clone https://github.com/hydepwns/evmore
cd evmore

# Install dependencies
npm install

# Build contracts
npm run build:contracts

# Run tests
npm test
```

### Local Development

```bash
# Start local blockchain environment
docker-compose up -d

# Deploy contracts locally
npm run deploy:local

# Run relayer in development mode
npm run dev:relayer

# Start frontend
cd frontend && npm run dev
# Open http://localhost:5173
```

## Features

### Core Infrastructure

- Atomic cross-chain swaps between Ethereum and Cosmos
- Multi-hop IBC routing for optimal paths
- Hash Time Lock Contracts (HTLCs) on both chains
- Automated relayer service

### IBC Integration

- Native IBC packet handling
- Packet Forward Middleware support
- Multi-hop transfer logic with timelock cascades
- Comprehensive integration testing

### DEX Integration

- Osmosis pool integration for liquidity
- Dynamic price discovery
- Slippage protection mechanisms
- Multi-DEX aggregation

### Production Features

- Enterprise-grade TypeScript libraries
- Comprehensive test coverage (99.14% pass rate)
- Performance optimized bundles
- Security audited contracts

## Architecture Overview

### High-Level Flow

1. **Order Creation** (Ethereum)
   - User creates cross-chain limit order
   - Assets locked in HTLC contract
   - Order broadcast to relayers

2. **Route Discovery** (Multi-Chain)
   - Relayer finds optimal path through Cosmos chains
   - Considers fees, liquidity, and timeouts
   - May route through multiple DEXs

3. **Execution** (Cosmos)
   - Relayer initiates IBC transfers
   - Assets hop through intermediate chains
   - Final swap executed on target chain

4. **Settlement** (Atomic)
   - Secret revealed on target chain
   - Propagated back through all hops
   - Original HTLC unlocked on Ethereum

### Security Model

- **Atomic Execution**: All-or-nothing via HTLCs
- **Timelock Cascade**: Each hop has decreasing timelock
- **No Trust Required**: Cryptographic proofs only
- **MEV Resistant**: Commit-reveal and encryption

## Supported Chains

### Currently Planned

- **Ethereum** (Mainnet, Sepolia)
- **Osmosis** (Primary DEX hub)
- **Cosmos Hub** (ATOM native chain)
- **Juno** (Smart contract platform)
- **Secret Network** (Privacy features)

### Future Expansion

- Any IBC-enabled Cosmos chain
- Additional EVM chains (Polygon, BSC, etc.)
- Non-EVM chains via adapters

## Technology Stack

- **Smart Contracts**: Solidity (EVM), Rust/CosmWasm (Cosmos)
- **Relayer**: TypeScript, Node.js
- **IBC**: Go, Cosmos SDK
- **Testing**: Hardhat, Jest, CosmWasm Test Tube
- **Infrastructure**: Docker, Kubernetes

## Documentation

- [Development Guide](docs/DEVELOPMENT_GUIDE.md)
- [Protocol Design](docs/PROTOCOL_DESIGN.md)
- [Operations Guide](docs/OPERATIONS_GUIDE.md)

## Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

### Development Process

1. Fork the repository
2. Create feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Resources

- [1inch Limit Order Protocol](https://docs.1inch.io/docs/limit-order-protocol/introduction)
- [Cosmos SDK Documentation](https://docs.cosmos.network/)
- [CosmWasm Documentation](https://docs.cosmwasm.com/)
- [IBC Protocol Specification](https://github.com/cosmos/ibc)

---

**Status**: This project is under active development. Use at your own risk on mainnet.
