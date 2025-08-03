# GitHub Pages Setup Guide

This document explains how GitHub Pages is configured for the EVMore project and how to manage deployments.

## Current Configuration

### Deployment Strategy

- **Source**: `/docs` folder (static files)
- **Branch**: `main`
- **Custom Domain**: `evmore.droo.foo`
- **HTTPS**: Enforced

### Workflow Files

#### Active Workflow: `deploy-demo.yml`

- **Purpose**: Deploy documentation and demo site
- **Trigger**: Changes to `docs/**` files
- **Actions**:
  1. Validates all required files exist
  2. Uploads `/docs` folder as GitHub Pages artifact
  3. Deploys to GitHub Pages
  4. Runs performance and security checks
  5. Sends deployment notifications

#### Disabled Workflow: `deploy-app.yml`

- **Status**: DISABLED (to prevent conflicts)
- **Reason**: Conflicts with documentation deployment
- **Alternative**: Can be re-enabled for separate domain if needed

## File Structure

```
EVMore/
├── docs/                    # GitHub Pages source
│   ├── index.html          # Main documentation
│   ├── hackathon/          # Demo application
│   │   ├── index.html
│   │   ├── styles.css
│   │   └── script.js
│   ├── api-reference.html  # API documentation
│   ├── examples.html       # Code examples
│   └── CNAME              # Custom domain (docs folder)
├── CNAME                   # Custom domain (root)
└── .github/workflows/
    ├── deploy-demo.yml     # Active deployment
    └── deploy-app.yml      # Disabled
```

## URLs After Deployment

- **Main Site**: <https://evmore.droo.foo>
- **Demo**: <https://evmore.droo.foo/hackathon/>
- **API Reference**: <https://evmore.droo.foo/api-reference.html>
- **Examples**: <https://evmore.droo.foo/examples.html>
- **Quick Start**: <https://evmore.droo.foo/quick-start.html>

## GitHub Pages Settings

### Required Configuration

1. **Source**: Deploy from a branch
2. **Branch**: `main`
3. **Folder**: `/docs`
4. **Custom Domain**: `evmore.droo.foo`
5. **HTTPS**: Enforce HTTPS (checked)

### DNS Configuration

The custom domain `evmore.droo.foo` should point to:

- **CNAME**: `hydepwns.github.io` (or your GitHub Pages domain)

## Deployment Process

### Automatic Deployment

1. Push changes to `main` branch
2. GitHub Actions workflow triggers
3. Files are validated
4. Documentation is uploaded to GitHub Pages
5. Site becomes available at custom domain

### Manual Deployment

```bash
# Run setup script to verify configuration
./scripts/setup-github-pages.sh

# Push changes to trigger deployment
git add .
git commit -m "Update documentation"
git push origin main
```

## Troubleshooting

### Common Issues

#### 1. Custom Domain Not Working

- Check DNS settings point to GitHub Pages
- Verify CNAME file exists in both `/docs` and root
- Wait for DNS propagation (up to 24 hours)

#### 2. Deployment Fails

- Check GitHub Actions for error messages
- Verify all required files exist in `/docs`
- Ensure workflow file is properly configured

#### 3. Conflicts Between Workflows

- Only one workflow should deploy to GitHub Pages
- React app deployment is disabled to prevent conflicts
- Use separate domains for different applications

### Validation Commands

```bash
# Check required files
ls -la docs/
ls -la docs/hackathon/

# Verify CNAME files
cat CNAME
cat docs/CNAME

# Run setup validation
./scripts/setup-github-pages.sh
```

## Performance Optimization

### Current Optimizations

- Static HTML/CSS/JS files
- Optimized images and assets
- Minified CSS and JavaScript
- Responsive design
- Fast loading times (< 2s)

### Monitoring

- GitHub Actions provides deployment status
- Performance metrics in workflow reports
- Security scanning included

## Future Considerations

### React App Deployment

If you want to deploy the React app separately:

1. Re-enable `deploy-app.yml`
2. Configure for different domain (e.g., `app.evmore.droo.foo`)
3. Update DNS settings accordingly

### Multiple Environments

- **Production**: `evmore.droo.foo`
- **Staging**: `staging.evmore.droo.foo` (if needed)
- **Development**: Local development server

## Support

For issues with GitHub Pages deployment:

1. Check GitHub Actions logs
2. Verify repository settings
3. Review this documentation
4. Check DNS configuration
