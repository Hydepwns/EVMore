#!/bin/bash

echo "📚 Generating API Documentation for @evmore/* libraries..."
echo "========================================================"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Get the script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
ROOT_DIR="$( cd "$SCRIPT_DIR/.." && pwd )"

# Libraries to document
LIBRARIES=(
  "errors"
  "interfaces" 
  "types"
  "config"
  "utils"
  "connection-pool"
  "test-utils"
)

# Create docs directory if it doesn't exist - FIXED PATH
DOCS_DIR="$ROOT_DIR/docs/@docs/api"
mkdir -p "$DOCS_DIR"

echo -e "${YELLOW}Installing documentation tools...${NC}"
npm install -g typedoc typedoc-plugin-markdown --silent

# Track success/failure
SUCCESS_COUNT=0
FAILURE_COUNT=0

# Generate documentation for each library
for lib in "${LIBRARIES[@]}"; do
  echo -e "\n${YELLOW}Generating docs for @evmore/$lib...${NC}"
  
  LIB_DIR="$ROOT_DIR/libs/$lib"
  OUTPUT_DIR="$DOCS_DIR/$lib"
  
  if [ -d "$LIB_DIR/src" ]; then
    # Create output directory
    mkdir -p "$OUTPUT_DIR"
    
    # Check if index.ts exists
    if [ ! -f "$LIB_DIR/src/index.ts" ]; then
      echo -e "${RED}❌ No index.ts found in $LIB_DIR/src${NC}"
      FAILURE_COUNT=$((FAILURE_COUNT + 1))
      continue
    fi
    
    # Generate TypeDoc documentation
    typedoc \
      --plugin typedoc-plugin-markdown \
      --out "$OUTPUT_DIR" \
      --readme "$LIB_DIR/README.md" \
      --excludePrivate \
      --excludeInternal \
      --includeVersion \
      --gitRevision main \
      --name "@evmore/$lib" \
      "$LIB_DIR/src/index.ts"
    
    if [ $? -eq 0 ]; then
      echo -e "${GREEN}✅ Generated docs for @evmore/$lib${NC}"
      SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
      
      # Also copy any manually written API.md if it exists
      if [ -f "$LIB_DIR/API.md" ]; then
        cp "$LIB_DIR/API.md" "$OUTPUT_DIR/API-manual.md"
        echo -e "${GREEN}✅ Copied manual API docs${NC}"
      fi
    else
      echo -e "${RED}❌ Failed to generate docs for @evmore/$lib${NC}"
      FAILURE_COUNT=$((FAILURE_COUNT + 1))
    fi
  else
    echo -e "${RED}⚠️  No src directory found for $lib${NC}"
    FAILURE_COUNT=$((FAILURE_COUNT + 1))
  fi
done

# Generate index file
echo -e "\n${YELLOW}Generating documentation index...${NC}"
cat > "$DOCS_DIR/README.md" << EOF
# @evmore/* Library API Documentation

This directory contains the API documentation for all @evmore/* libraries.

## Libraries

### Core Libraries

- [@evmore/types](./types/README.md) - Central type system
- [@evmore/interfaces](./interfaces/README.md) - Service contracts and DI interfaces
- [@evmore/errors](./errors/README.md) - Hierarchical error system

### Infrastructure Libraries

- [@evmore/config](./config/README.md) - Configuration management
- [@evmore/utils](./utils/README.md) - Common utilities and DI container
- [@evmore/connection-pool](./connection-pool/README.md) - RPC connection pooling

### Development Libraries

- [@evmore/test-utils](./test-utils/README.md) - Testing utilities and mocks

## Getting Started

\`\`\`bash
# Install a specific library
npm install @evmore/types

# Install all libraries (in a workspace)
npm install
\`\`\`

## Usage Examples

### Using Types

\`\`\`typescript
import { SwapOrder, SwapStatus } from '@evmore/types';

const order: SwapOrder = {
  id: 'swap-123',
  status: SwapStatus.PENDING,
  // ... other fields
};
\`\`\`

### Using Configuration

\`\`\`typescript
import { loadConfig } from '@evmore/config';

const config = await loadConfig();
console.log(config.environment);
\`\`\`

### Using Connection Pool

\`\`\`typescript
import { EthereumConnectionPool } from '@evmore/connection-pool';

const pool = new EthereumConnectionPool({
  endpoints: ['https://eth-rpc.example.com'],
  maxConnections: 10
});

const client = await pool.acquire();
// Use client...
pool.release(client);
\`\`\`

## Architecture

These libraries form the foundation of the EVMore refactored architecture:

\`\`\`
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
\`\`\`

## Contributing

See the main [CONTRIBUTING.md](../../../../CONTRIBUTING.md) for guidelines.

## License

See [LICENSE](../../../../LICENSE) for details.
EOF

echo -e "\n${GREEN}✅ Documentation generation complete!${NC}"
echo -e "\n📊 Summary:"
echo -e "  ✅ Successful: $SUCCESS_COUNT"
echo -e "  ❌ Failed: $FAILURE_COUNT"
echo -e "\n📁 Documentation generated in: $DOCS_DIR"
echo -e "\n🔗 To view the docs:"
echo -e "  cd $DOCS_DIR"
echo -e "  ls -la"
echo -e "\n🌐 Or open in browser:"
echo -e "  open $DOCS_DIR/README.md"