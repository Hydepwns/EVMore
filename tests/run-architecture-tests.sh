#!/bin/bash

echo "🏗️  Running Architecture Validation Tests..."
echo "========================================="

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Ensure we're in the tests directory
cd "$(dirname "$0")"

# Build all libraries first
echo -e "${YELLOW}Building @evmore/* libraries...${NC}"
cd ..
npm run build:libs
if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Library build failed${NC}"
    exit 1
fi

# Build SDK and Relayer
echo -e "${YELLOW}Building SDK...${NC}"
cd sdk && npm run build
if [ $? -ne 0 ]; then
    echo -e "${RED}❌ SDK build failed${NC}"
    exit 1
fi

echo -e "${YELLOW}Building Relayer...${NC}"
cd ../relayer && npm run build
if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Relayer build failed${NC}"
    exit 1
fi

cd ../tests

# Run architecture validation tests
echo -e "\n${YELLOW}Running architecture validation tests...${NC}"
npx jest --config=jest.config.architecture.js --testNamePattern="Architecture Validation" --verbose

# Run migration validation tests
echo -e "\n${YELLOW}Running migration validation tests...${NC}"
npx jest --config=jest.config.architecture.js --testNamePattern="Migration Validation" --verbose

# Run performance benchmarks
echo -e "\n${YELLOW}Running performance benchmarks...${NC}"
# Enable gc for memory tests
node --expose-gc ./node_modules/.bin/jest --config=jest.config.architecture.js --testNamePattern="Performance Benchmarks" --verbose

# Generate coverage report
echo -e "\n${YELLOW}Generating coverage report...${NC}"
npx jest --config=jest.config.architecture.js --coverage --coverageReporters=text-summary

echo -e "\n${GREEN}✅ Architecture tests complete!${NC}"

# Summary
echo -e "\n========================================="
echo "📊 Test Summary:"
echo "- Architecture validation: Tests the integration of new @evmore/* libraries"
echo "- Migration validation: Ensures adapters work correctly"  
echo "- Performance benchmarks: Measures improvements from refactoring"
echo "========================================="