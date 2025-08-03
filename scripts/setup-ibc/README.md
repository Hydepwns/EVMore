# IBC Setup Scripts

This directory contains scripts for setting up and managing IBC (Inter-Blockchain Communication) channels for the EVMore protocol.

## Overview

The IBC setup process involves:

1. Creating IBC clients between chains
2. Establishing connections
3. Opening channels for token transfers
4. Configuring the Hermes relayer
5. Verifying channel connectivity

## Prerequisites

- `osmosisd`, `junod`, `gaiad` CLI tools installed
- `hermes` IBC relayer (installed by setup script)
- Funded accounts on testnets
- Docker (for local testing)

## Scripts

### `setup-channels.sh`

Main script for creating IBC channels between chains.

```bash
# Setup all channel pairs
./setup-channels.sh all

# Setup specific channel pair
./setup-channels.sh osmosis-juno
./setup-channels.sh osmosis-cosmos
./setup-channels.sh juno-cosmos

# Test existing channels
./setup-channels.sh test

# Update contract configurations
./setup-channels.sh update
```

### `setup-relayer.sh`

Configures and manages the Hermes IBC relayer.

```bash
# Install and configure Hermes
./setup-relayer.sh setup

# Setup IBC paths
./setup-relayer.sh paths

# Start relayer
./setup-relayer.sh start

# Monitor relayer
./setup-relayer.sh monitor

# Setup systemd service
./setup-relayer.sh systemd
```

### `verify-channels.sh`

Verifies IBC channel status and connectivity.

```bash
# Check all channels
./verify-channels.sh channels

# Test packet relay
./verify-channels.sh relay osmo-test-5 uni-6

# Show channel summary
./verify-channels.sh summary
```

## Configuration

### Chain Configurations

Chain-specific configurations are stored in `config/`:

- `osmo-test-5.json` - Osmosis testnet
- `uni-6.json` - Juno testnet
- `theta-testnet-001.json` - Cosmos Hub testnet

### Hermes Configuration

The Hermes relayer configuration is in `hermes-config.toml`.

## Setup Flow

### 1. Initial Setup

```bash
# Deploy contracts first
cd ../../
npm run deploy:all

# Setup IBC channels
cd scripts/setup-ibc/
./setup-channels.sh all
```

### 2. Configure Relayer

```bash
# Install and configure Hermes
./setup-relayer.sh setup

# Create IBC paths
./setup-relayer.sh paths

# Start relayer
./setup-relayer.sh start
```

### 3. Verify Setup

```bash
# Check channel status
./verify-channels.sh all

# Test transfers
./verify-channels.sh relay osmo-test-5 uni-6
```

## Channel Architecture

### Supported Paths

```
Osmosis <-> Juno
Osmosis <-> Cosmos Hub
Juno <-> Cosmos Hub
```

### Packet Forward Middleware

Osmosis and Juno support Packet Forward Middleware for multi-hop transfers:

```
Ethereum -> Osmosis -> Juno -> Cosmos Hub
```

## Troubleshooting

### Channel Not Opening

1. Check client and connection status
2. Ensure both chains are running
3. Verify account has sufficient funds
4. Check Hermes logs: `tail -f ~/.hermes/hermes.log`

### Packets Not Relaying

1. Ensure Hermes is running: `./setup-relayer.sh monitor`
2. Check for pending packets: `./verify-channels.sh channels`
3. Restart relayer: `./setup-relayer.sh stop && ./setup-relayer.sh start`

### Client Expiry

Clients expire after the trusting period (14 days). Update expired clients:

```bash
hermes update client --host-chain osmo-test-5 --client 07-tendermint-123
```

## Production Considerations

1. **Security**: Use secure key management (not test keyring)
2. **Monitoring**: Set up alerts for channel status and packet delays
3. **Redundancy**: Run multiple relayer instances
4. **Gas Management**: Monitor and refill relayer accounts
5. **Updates**: Keep Hermes and chain binaries updated

## Local Testing

For local development with Docker:

```bash
# Start local chains
docker-compose -f ../../docker-compose.yml up -d

# Setup local channels
CHAIN_ID=local-osmosis NODE=http://localhost:26657 ./setup-channels.sh
```

## Resources

- [IBC Protocol Documentation](https://ibc.cosmos.network/)
- [Hermes Documentation](https://hermes.informal.systems/)
- [Packet Forward Middleware](https://github.com/cosmos/ibc-apps/tree/main/middleware/packet-forward-middleware)
