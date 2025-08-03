# EVMore API Documentation

Welcome to the EVMore API documentation. This directory contains comprehensive documentation for all the core libraries and packages that make up the EVMore cross-chain swap protocol.

## 📚 Available Documentation

### Core Libraries

- **[Types](./api/types/README.md)** - Central type system for cross-chain operations
- **[Interfaces](./api/interfaces/README.md)** - Service contracts and dependency injection interfaces
- **[Errors](./api/errors/README.md)** - Hierarchical error system with recovery mechanisms

### Infrastructure Libraries

- **[Config](./api/config/README.md)** - Configuration management with validation
- **[Utils](./api/utils/README.md)** - Common utilities and DI container
- **[Connection Pool](./api/connection-pool/README.md)** - RPC connection pooling for blockchain networks
- **[Test Utils](./api/test-utils/README.md)** - Testing utilities and mocks

## 🚀 Quick Start

1. **Install the packages:**
   ```bash
   npm install @evmore/types @evmore/interfaces @evmore/errors @evmore/config @evmore/utils @evmore/connection-pool @evmore/test-utils
   ```

2. **Import and use:**
   ```typescript
   import { CrossChainSwap, SwapStatus } from '@evmore/types';
   import { IHTLCService } from '@evmore/interfaces';
   import { HTLCError } from '@evmore/errors';
   ```

## 📖 Documentation Structure

Each library has its own documentation with:
- **Overview** - What the library does
- **Core Features** - Key capabilities
- **API Reference** - Detailed interface documentation
- **Usage Examples** - Practical code examples
- **Installation** - How to install and set up
- **Development** - How to contribute

## 🔗 Related Resources

- [Main Documentation](./) - Protocol overview and guides
- [API Reference](./api-reference.html) - Interactive API documentation
- [Examples](./examples.html) - Code examples and tutorials
- [GitHub Repository](https://github.com/Hydepwns/EVMore) - Source code

## 🤝 Contributing

When adding new libraries or updating documentation:

1. Create comprehensive README files
2. Include TypeScript examples
3. Add usage patterns
4. Update this index
5. Follow the existing documentation style

## 📝 License

This documentation is part of the EVMore project and follows the same license as the main repository. 