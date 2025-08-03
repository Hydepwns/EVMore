#!/bin/bash

# GitHub Pages Setup Script for EVMore Documentation
# This script helps configure GitHub Pages for the documentation site

set -e

echo "🚀 Setting up GitHub Pages for EVMore Documentation"
echo "=================================================="

# Check if we're in the right directory
if [ ! -f "docs/index.html" ]; then
    echo "❌ Error: docs/index.html not found. Please run this script from the repository root."
    exit 1
fi

# Check required files
echo "📋 Checking required files..."

REQUIRED_FILES=(
    "docs/index.html"
    "docs/hackathon/index.html"
    "docs/api-reference.html"
    "docs/examples.html"
    "CNAME"
)

for file in "${REQUIRED_FILES[@]}"; do
    if [ -f "$file" ]; then
        echo "✅ $file"
    else
        echo "❌ $file (missing)"
        exit 1
    fi
done

echo ""
echo "✅ All required files found!"
echo ""
echo "📝 GitHub Pages Configuration Instructions:"
echo "=========================================="
echo ""
echo "1. Go to your GitHub repository settings"
echo "2. Navigate to 'Pages' section"
echo "3. Set Source to 'Deploy from a branch'"
echo "4. Select branch: 'main'"
echo "5. Select folder: '/docs'"
echo "6. Click 'Save'"
echo ""
echo "🌐 Custom Domain Configuration:"
echo "=============================="
echo "1. In the same Pages settings, enter custom domain: evmore.droo.foo"
echo "2. Check 'Enforce HTTPS'"
echo "3. Click 'Save'"
echo ""
echo "📊 Expected URLs after deployment:"
echo "================================="
echo "- Main Site: https://evmore.droo.foo"
echo "- Demo: https://evmore.droo.foo/hackathon/"
echo "- API Reference: https://evmore.droo.foo/api-reference.html"
echo "- Examples: https://evmore.droo.foo/examples.html"
echo "- Quick Start: https://evmore.droo.foo/quick-start.html"
echo ""
echo "🔧 Workflow Configuration:"
echo "========================="
echo "- Documentation deployment: .github/workflows/deploy-demo.yml"
echo "- React app deployment: DISABLED (to prevent conflicts)"
echo "- Custom domain: evmore.droo.foo"
echo ""
echo "✨ Setup complete! Follow the instructions above to configure GitHub Pages." 