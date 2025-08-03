# @evmore/* Library API Documentation

This directory contains the API documentation for all @evmore/* libraries.

## Libraries

### Core Libraries

- [@evmore/types](/Users/droo/Documents/CODE/EVMore/@docs/api/types/README.md) - Central type system
- [@evmore/interfaces](/Users/droo/Documents/CODE/EVMore/@docs/api/interfaces/README.md) - Service contracts and DI interfaces
- [@evmore/errors](/Users/droo/Documents/CODE/EVMore/@docs/api/errors/README.md) - Hierarchical error system

### Infrastructure Libraries

- [@evmore/config](/Users/droo/Documents/CODE/EVMore/@docs/api/config/README.md) - Configuration management
- [@evmore/utils](/Users/droo/Documents/CODE/EVMore/@docs/api/utils/README.md) - Common utilities and DI container
- [@evmore/connection-pool](/Users/droo/Documents/CODE/EVMore/@docs/api/connection-pool/README.md) - RPC connection pooling

### Development Libraries

- [@evmore/test-utils](/Users/droo/Documents/CODE/EVMore/@docs/api/test-utils/README.md) - Testing utilities and mocks

## Getting Started

```bash
# Install a specific library
npm install @evmore/types

# Install all libraries (in a workspace)
npm install
```

## Usage Examples

### Using Types

```typescript
import { SwapOrder, SwapStatus } from '@evmore/types';

const order: SwapOrder = {
  id: 'swap-123',
  status: SwapStatus.PENDING,
  // ... other fields
};
```

### Using Configuration

```typescript
import { loadConfig } from '@evmore/config';

const config = await loadConfig();
console.log(config.environment);
```

### Using Connection Pool

```typescript
import { EthereumConnectionPool } from '@evmore/connection-pool';

const pool = new EthereumConnectionPool({
  endpoints: ['https://eth-rpc.example.com'],
  maxConnections: 10
});

const client = await pool.acquire();
// Use client...
pool.release(client);
```

## Architecture

These libraries form the foundation of the EVMore refactored architecture:

```
┌─────────────────┐     ┌──────────────────┐
│   Application   │────▶│  @evmore/types   │
└─────────────────┘     └──────────────────┘
         │                       ▲
         ▼                       │
┌─────────────────┐     ┌──────────────────┐
│ @evmore/config  │────▶│@evmore/interfaces│
└─────────────────┘     └──────────────────┘
         │                       ▲
         ▼                       │
┌─────────────────┐     ┌──────────────────┐
│  @evmore/utils  │────▶│ @evmore/errors   │
└─────────────────┘     └──────────────────┘
         │
         ▼
┌─────────────────────────┐
│ @evmore/connection-pool │
└─────────────────────────┘
```

## Contributing

See the main [CONTRIBUTING.md](../../../CONTRIBUTING.md) for guidelines.

## License

See [LICENSE](../../../LICENSE) for details.
