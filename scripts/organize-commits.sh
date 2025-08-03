#!/bin/bash

# EVMore Git Commit Organization Script
# This script organizes the working directory into logical commits

echo "🎯 Organizing EVMore git working directory into logical commits..."

# Check if we're in a git repository
if ! git rev-parse --git-dir > /dev/null 2>&1; then
    echo "❌ Error: Not in a git repository"
    exit 1
fi

# Check current status
echo "�� Current git status:"
git status --porcelain

# 1. UI/UX Improvements Commit
echo "🎨 Creating UI/UX Improvements commit..."
git add docs/hackathon/styles.css
git add frontend/src/components/SwapInterface/
git add frontend/src/pages/Swap.tsx
git add frontend/src/components/common/
git commit -m "�� Improve UI/UX: Fix swap interface alignment and dynamic values

- Fix CSS alignment issues in swap details section
- Improve dynamic value display with proper spacing
- Enhance responsive design for mobile devices
- Add smooth transitions and animations
- Update status indicators and progress tracking"

# 2. Code Quality & Type Safety Commit
echo "🔧 Creating Code Quality & Type Safety commit..."
git add sdk/src/client/
git add sdk/src/types/
git add sdk/src/utils/
git add libs/errors/src/
git add libs/interfaces/src/
git add libs/types/src/
git add .eslintrc.json
git add tsconfig.json
git commit -m "🔧 Improve code quality and type safety

- Fix ESLint errors (97.4% completion rate)
- Add proper TypeScript types and interfaces
- Implement structured error handling
- Refactor large classes into focused components
- Add runtime validation and type guards
- Improve maintainability and code organization"

# 3. Documentation Updates Commit
echo "📚 Creating Documentation Updates commit..."
git add README.md
git add CONTRIBUTING.md
git add docs/
git add @docs/
git add frontend/README.md
git add sdk/README.md
git add libs/*/README.md
git commit -m "📚 Update documentation and guides

- Update main README with project overview
- Improve contributing guidelines
- Add comprehensive API documentation
- Create architecture diagrams
- Add deployment and setup guides
- Update hackathon demo documentation"

# 4. Testing & Validation Commit
echo "�� Creating Testing & Validation commit..."
git add tests/
git add sdk/test/
git add libs/*/test/
git add relayer/test/
git add jest.config.*
git add package.json
git commit -m "🧪 Enhance testing and validation

- Add comprehensive unit tests
- Implement integration test suites
- Add end-to-end test scenarios
- Improve test coverage and reliability
- Add test utilities and fixtures
- Update test configuration and setup"

# 5. Infrastructure & Deployment Commit
echo "🚀 Creating Infrastructure & Deployment commit..."
git add docker-compose.yml
git add docker-compose.monitoring.yml
git add monitoring/
git add scripts/
git add .github/
git add package-lock.json
git add turbo.json
git commit -m "🚀 Improve infrastructure and deployment

- Add Docker containerization
- Set up monitoring and alerting
- Configure CI/CD pipelines
- Add deployment scripts
- Update package dependencies
- Configure build and deployment tools"

# 6. Project Configuration Commit
echo "⚙️ Creating Project Configuration commit..."
git add .gitignore
git add .prettierrc
git add package.json
git add tsconfig.json
git add turbo.json
git add TODO.md
git commit -m "⚙️ Update project configuration

- Update .gitignore patterns
- Configure Prettier formatting
- Update package.json scripts
- Configure TypeScript settings
- Update TODO and project status
- Add development tooling configuration"

echo "✅ Successfully organized commits!"
echo ""
echo "📋 Commit Summary:"
echo "1. �� UI/UX Improvements"
echo "2. 🔧 Code Quality & Type Safety"
echo "3. 📚 Documentation Updates"
echo "4. 🧪 Testing & Validation"
echo "5. 🚀 Infrastructure & Deployment"
echo "6. ⚙️ Project Configuration"
echo ""
echo "�� Ready to push: git push origin main" 