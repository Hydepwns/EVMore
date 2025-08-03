#!/bin/bash

# EVMore Frontend Deployment Script
# This script builds and prepares the React app for deployment

set -e

echo "🚀 EVMore Frontend Deployment Script"
echo "====================================="

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
    echo "❌ Error: package.json not found. Please run this script from the frontend directory."
    exit 1
fi

# Install dependencies
echo "📦 Installing dependencies..."
npm ci

# Run type checking
echo "🔍 Running TypeScript type checking..."
npx tsc --noEmit

# Run linting
echo "🧹 Running ESLint..."
npm run lint

# Build the application
echo "🔨 Building application..."
npm run build

# Check build output
echo "✅ Build completed successfully!"
echo "📁 Build output: dist/"
echo "📄 Main file: dist/index.html"

# Show build stats
echo ""
echo "📊 Build Statistics:"
du -sh dist/
echo ""

# Check for common issues
echo "🔍 Checking for common deployment issues..."

if [ ! -f "dist/index.html" ]; then
    echo "❌ Error: index.html not found in build output"
    exit 1
fi

if [ ! -d "dist/assets" ]; then
    echo "❌ Error: assets directory not found in build output"
    exit 1
fi

echo "✅ Build validation passed!"

# Show deployment URLs
echo ""
echo "🌐 Deployment URLs:"
echo "- Local: http://localhost:5173"
echo "- GitHub Pages: https://$GITHUB_REPOSITORY_OWNER.github.io/EVMore/"
echo "- Custom Domain: https://app.evmore.droo.foo (if configured)"
echo ""

echo "🎉 Deployment script completed successfully!"
echo ""
echo "Next steps:"
echo "1. Commit and push your changes"
echo "2. GitHub Actions will automatically deploy to GitHub Pages"
echo "3. Configure custom domain if needed"
echo "" 