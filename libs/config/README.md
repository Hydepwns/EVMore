# @evmore/config

Unified configuration management for the EVMore project. This package provides a centralized configuration system with environment-specific overrides, validation, and type safety.

## Installation

```bash
npm install @evmore/config
```

## Usage

### Basic Configuration Loading

```typescript
import { loadConfig, getConfig } from '@evmore/config';

// Load configuration (async)
const config = await loadConfig({ environment: 'development' });

// Get configuration (sync, after loading)
const config = getConfig();
```

### Environment-Specific Configuration

The configuration system supports multiple environments:

- `development`: Local development settings
- `production`: Production environment settings  
- `test`: Test environment settings

```typescript
import { loadConfig } from '@evmore/config';

// Load development config
const devConfig = await loadConfig({ environment: 'development' });

// Load production config
const prodConfig = await loadConfig({ environment: 'production' });
```

### Configuration Sources

Configuration is loaded from multiple sources in order of precedence:

1. **Default configuration** - Base configuration values
2. **Environment configuration** - Environment-specific overrides
3. **Local configuration** - Local config file (`config.local.json`)
4. **Runtime overrides** - Programmatic overrides
5. **Environment variables** - Environment variable overrides

### Environment Variable Overrides

Many configuration values can be overridden using environment variables:

```bash
# Ethereum configuration
export ETHEREUM_RPC_URL="https://your-rpc-endpoint.com"
export ETHEREUM_CHAIN_ID="1"
export ETHEREUM_HTLC_CONTRACT="0x..."

# Cosmos configuration  
export OSMOSIS_RPC_URL="https://rpc.osmosis.zone"
export OSMOSIS_REST_URL="https://lcd.osmosis.zone"

# Service configuration
export RELAYER_MAX_RETRIES="5"
export RELAYER_BATCH_SIZE="20"

# Monitoring
export METRICS_ENABLED="true"
export METRICS_PORT="9090"
```

### Local Configuration Override

Create a `config.local.json` file in your project root:

```json
{
  "networks": {
    "ethereum": {
      "rpcUrl": "http://localhost:8545"
    }
  },
  "services": {
    "relayer": {
      "maxRetries": 1,
      "batchSize": 5
    }
  }
}
```

### Programmatic Configuration

```typescript
import { ConfigLoader } from '@evmore/config';

const loader = ConfigLoader.getInstance();

const config = await loader.load({
  environment: 'development',
  overrides: {
    services: {
      relayer: {
        maxRetries: 10
      }
    }
  }
});
```

## Configuration Schema

The configuration follows a structured schema with the following sections:

### Environment
- `name`: Environment name (development, production, test)
- `debug`: Debug mode flag
- `logLevel`: Logging level

### Networks
- `ethereum`: Ethereum network configuration
- `cosmos`: Array of Cosmos network configurations

### Services
- `relayer`: Relay service configuration
- `registry`: Chain registry configuration
- `recovery`: Recovery service configuration

### Security
- `secrets`: Secret management configuration
- `encryption`: Encryption settings
- `rateLimit`: Rate limiting configuration
- `firewall`: Firewall settings

### Monitoring
- `metrics`: Metrics collection configuration
- `tracing`: Distributed tracing configuration
- `healthCheck`: Health check configuration
- `alerts`: Alerting configuration

### Feature Flags
- Dynamic feature toggles

## Validation

Configuration is automatically validated when loaded. Invalid configurations will throw a `ConfigurationError`.

```typescript
import { ConfigurationError } from '@evmore/config';

try {
  const config = await loadConfig();
} catch (error) {
  if (error instanceof ConfigurationError) {
    console.error('Configuration error:', error.message);
  }
}
```

## Migration from Legacy Configuration

This package provides compatibility with the existing configuration system. Legacy configuration files are automatically migrated to the new format.

```typescript
import { adaptLegacyConfig } from '@evmore/config';

const legacyConfig = require('./old-config.json');
const newConfig = adaptLegacyConfig(legacyConfig);
```