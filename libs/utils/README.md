# @evmore/utils

Common utilities and helper functions for the EVMore project.

## Installation

```bash
npm install @evmore/utils
```

## Usage

```typescript
import { LoggerFactory } from '@evmore/utils';

// Create logger
const factory = LoggerFactory.getInstance();
const logger = factory.create('MyService');

logger.info('Service started');
```