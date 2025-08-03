#!/bin/bash

# EVMore GitHub Pages Setup Script
# This script helps set up GitHub Pages deployment for the hackathon demo

echo "🚀 EVMore GitHub Pages Setup"
echo "============================"
echo ""

# Check if we're in the right directory
if [ ! -f "docs/hackathon/index.html" ]; then
    echo "❌ Error: Demo files not found. Please run this script from the EVMore root directory."
    exit 1
fi

echo "✅ Demo files found:"
ls -la docs/hackathon/
echo ""

# Check if workflow file exists
if [ -f ".github/workflows/deploy-demo.yml" ]; then
    echo "✅ CI/CD workflow configured"
else
    echo "❌ CI/CD workflow not found"
    exit 1
fi

echo ""
echo "📋 Next Steps to Enable GitHub Pages:"
echo "====================================="
echo ""
echo "1. Open GitHub Repository Settings:"
echo "   https://github.com/Hydepwns/EVMore/settings/pages"
echo ""
echo "2. Configure GitHub Pages:"
echo "   - Source: 'Deploy from a branch'"
echo "   - Branch: 'main'"
echo "   - Folder: '/docs'"
echo "   - Click 'Save'"
echo ""
echo "3. Wait for deployment (usually 2-5 minutes)"
echo ""
echo "4. Access your demo at:"
echo "   - GitHub Pages: https://hydepwns.github.io/EVMore/"
echo "   - Custom Domain: https://evmore.droo.foo/ (after DNS setup)"
echo ""
echo "🔧 Optional: Custom Domain Setup"
echo "================================"
echo "1. Add CNAME record in your DNS:"
echo "   - Name: evmore"
echo "   - Value: hydepwns.github.io"
echo ""
echo "2. Configure in GitHub Pages settings:"
echo "   - Custom domain: evmore.droo.foo"
echo "   - Check 'Enforce HTTPS'"
echo ""
echo "📊 Check Deployment Status:"
echo "==========================="
echo "1. GitHub Actions: https://github.com/Hydepwns/EVMore/actions"
echo "2. Pages Settings: https://github.com/Hydepwns/EVMore/settings/pages"
echo ""
echo "🎉 Once deployed, your hackathon demo will be live!"
echo ""
echo "Demo Features:"
echo "- Interactive cross-chain swap simulation"
echo "- Real-time exchange rates and fees"
echo "- Step-by-step process visualization"
echo "- Responsive design for all devices"
echo "- Performance optimized (< 2s load time)"
echo "" 