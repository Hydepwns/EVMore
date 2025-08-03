# @evmore/interfaces

Service interfaces and type definitions for dependency injection in the EVMore project.

## Installation

```bash
npm install @evmore/interfaces
```

## Usage

```typescript
import { 
  Logger, 
  ChainMonitor, 
  RelayService,
  ServiceContainer,
  CORE_TOKENS 
} from '@evmore/interfaces';

// Implement interfaces
class MyRelayService implements RelayService {
  // Implementation
}

// Use with dependency injection
const container: ServiceContainer = // ... get container
const relayService = container.get(CORE_TOKENS.RelayService);
```