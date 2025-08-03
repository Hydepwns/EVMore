#!/bin/bash

# EVMore Documentation Update Script
# This script helps maintain and update the documentation

set -e

echo "🔧 EVMore Documentation Update Script"
echo "====================================="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to check if a file exists
check_file() {
    if [ -f "$1" ]; then
        echo -e "${GREEN}✓${NC} $1"
        return 0
    else
        echo -e "${RED}✗${NC} $1 (missing)"
        return 1
    fi
}

# Function to validate links in HTML files
validate_links() {
    echo -e "\n${BLUE}Validating links in HTML files...${NC}"
    
    local docs_dir="docs"
    local html_files=("api-reference.html" "examples.html" "DEVELOPMENT_GUIDE.html" "OPERATIONS_GUIDE.html" "PROTOCOL_DESIGN.html" "quick-start.html")
    
    for file in "${html_files[@]}"; do
        if [ -f "$docs_dir/$file" ]; then
            echo -e "\n${YELLOW}Checking $file...${NC}"
            
            # Check for @docs links
            local docs_links=$(grep -o 'href="[^"]*@docs[^"]*"' "$docs_dir/$file" || true)
            if [ -n "$docs_links" ]; then
                echo -e "${GREEN}Found @docs links:${NC}"
                echo "$docs_links" | sed 's/^/  /'
            else
                echo -e "${YELLOW}No @docs links found${NC}"
            fi
            
            # Check for broken links (basic check)
            local broken_links=$(grep -o 'href="[^"]*"' "$docs_dir/$file" | grep -v 'http' | grep -v '#' | sed 's/href="//' | sed 's/"//' | while read link; do
                if [[ "$link" == /* ]]; then
                    # Absolute path
                    if [ ! -f ".$link" ] && [ ! -d ".$link" ]; then
                        echo "$link"
                    fi
                elif [[ "$link" == ../* ]]; then
                    # Relative path going up
                    if [ ! -f "$(dirname "$docs_dir/$file")/$link" ] && [ ! -d "$(dirname "$docs_dir/$file")/$link" ]; then
                        echo "$link"
                    fi
                fi
            done || true)
            
            if [ -n "$broken_links" ]; then
                echo -e "${RED}Potentially broken links:${NC}"
                echo "$broken_links" | sed 's/^/  /'
            else
                echo -e "${GREEN}No obvious broken links${NC}"
            fi
        fi
    done
}

# Function to check documentation structure
check_docs_structure() {
    echo -e "\n${BLUE}Checking documentation structure...${NC}"
    
    # Check main documentation files
    local main_docs=(
        "docs/index.html"
        "docs/api-reference.html"
        "docs/examples.html"
        "docs/quick-start.html"
        "docs/DEVELOPMENT_GUIDE.html"
        "docs/OPERATIONS_GUIDE.html"
        "docs/PROTOCOL_DESIGN.html"
    )
    
    for doc in "${main_docs[@]}"; do
        check_file "$doc"
    done
    
    # Check @docs structure
    echo -e "\n${YELLOW}Checking @docs structure...${NC}"
    local api_docs=(
        "docs/@docs/README.md"
        "docs/@docs/api/README.md"
        "docs/@docs/api/types/README.md"
        "docs/@docs/api/interfaces/README.md"
        "docs/@docs/api/errors/README.md"
        "docs/@docs/api/config/README.md"
        "docs/@docs/api/utils/README.md"
        "docs/@docs/api/connection-pool/README.md"
        "docs/@docs/api/test-utils/README.md"
    )
    
    for doc in "${api_docs[@]}"; do
        check_file "$doc"
    done
}

# Function to check examples
check_examples() {
    echo -e "\n${BLUE}Checking examples...${NC}"
    
    local examples=(
        "docs/examples/connection-pool/full-integration-example.ts"
        "docs/examples/metrics/prometheus-metrics-example.ts"
        "docs/examples/tracing/opentelemetry-example.ts"
        "docs/examples/validation/input-validation-example.ts"
    )
    
    for example in "${examples[@]}"; do
        check_file "$example"
    done
}

# Function to generate documentation index
generate_index() {
    echo -e "\n${BLUE}Generating documentation index...${NC}"
    
    # Create a simple index of all documentation files
    local index_file="docs/DOCUMENTATION_INDEX.md"
    
    cat > "$index_file" << 'EOF'
# EVMore Documentation Index

This file provides an index of all available documentation for the EVMore project.

## 📚 Main Documentation

- [Home](index.html) - Main documentation homepage
- [Quick Start](quick-start.html) - Get started with EVMore
- [API Reference](api-reference.html) - Complete API documentation
- [Examples](examples.html) - Code examples and tutorials

## 📖 Guides

- [Development Guide](DEVELOPMENT_GUIDE.html) - Development setup and guidelines
- [Operations Guide](OPERATIONS_GUIDE.html) - Deployment and operations
- [Protocol Design](PROTOCOL_DESIGN.html) - Protocol architecture and design

## 🔧 API Documentation

- [Types](@docs/api/types/README.md) - Type definitions
- [Interfaces](@docs/api/interfaces/README.md) - Service interfaces
- [Errors](@docs/api/errors/README.md) - Error handling
- [Config](@docs/api/config/README.md) - Configuration management
- [Utils](@docs/api/utils/README.md) - Utility functions
- [Connection Pool](@docs/api/connection-pool/README.md) - Connection management
- [Test Utils](@docs/api/test-utils/README.md) - Testing utilities

## 💡 Examples

- [Connection Pool Integration](../docs/examples/connection-pool/full-integration-example.ts)
- [Prometheus Metrics](../docs/examples/metrics/prometheus-metrics-example.ts)
- [OpenTelemetry Tracing](../docs/examples/tracing/opentelemetry-example.ts)
- [Input Validation](../docs/examples/validation/input-validation-example.ts)

## 🔗 External Resources

- [GitHub Repository](https://github.com/Hydepwns/EVMore)
- [Issues](https://github.com/Hydepwns/EVMore/issues)
- [Discussions](https://github.com/Hydepwns/EVMore/discussions)

---

*Last updated: $(date)*
EOF

    echo -e "${GREEN}✓${NC} Generated documentation index at $index_file"
}

# Function to show usage
show_usage() {
    echo "Usage: $0 [OPTION]"
    echo ""
    echo "Options:"
    echo "  --check        Check documentation structure and validate links"
    echo "  --validate     Validate all links in HTML files"
    echo "  --index        Generate documentation index"
    echo "  --all          Run all checks and updates"
    echo "  --help         Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0 --check     # Check documentation structure"
    echo "  $0 --validate  # Validate all links"
    echo "  $0 --all       # Run all checks and updates"
}

# Main script logic
case "${1:---help}" in
    --check)
        check_docs_structure
        check_examples
        ;;
    --validate)
        validate_links
        ;;
    --index)
        generate_index
        ;;
    --all)
        check_docs_structure
        check_examples
        validate_links
        generate_index
        ;;
    --help|*)
        show_usage
        ;;
esac

echo -e "\n${GREEN}✅ Documentation update script completed!${NC}" 