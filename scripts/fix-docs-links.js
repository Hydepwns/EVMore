#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Function to fix @docs links in HTML files
function fixDocsLinks() {
  const docsDir = path.join(__dirname, '..', 'docs');
  const htmlFiles = [
    'api-reference.html',
    'examples.html',
    'DEVELOPMENT_GUIDE.html',
    'OPERATIONS_GUIDE.html',
    'PROTOCOL_DESIGN.html',
    'quick-start.html'
  ];

  htmlFiles.forEach(file => {
    const filePath = path.join(docsDir, file);
    
    if (fs.existsSync(filePath)) {
      console.log(`Processing ${file}...`);
      
      let content = fs.readFileSync(filePath, 'utf8');
      
      // Fix @docs links to point to the correct relative paths
      // Since @docs is now inside docs/, we use simpler paths
      content = content.replace(/href="\.\.\/@docs\//g, 'href="@docs/');
      content = content.replace(/href="\.\.\/\.\.\/@docs\//g, 'href="@docs/');
      
      // Also fix any remaining @docs references
      content = content.replace(/href="\.\.\/@docs\//g, 'href="@docs/');
      
      fs.writeFileSync(filePath, content, 'utf8');
      console.log(`✓ Fixed links in ${file}`);
    } else {
      console.log(`⚠️  File not found: ${file}`);
    }
  });
}

// Function to create a simple redirect page for @docs
function createDocsRedirect() {
  const redirectContent = `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>EVMore API Documentation</title>
    <meta http-equiv="refresh" content="0; url=@docs/api/README.md">
    <style>
        body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
        .loading { color: #666; }
    </style>
</head>
<body>
    <h1>EVMore API Documentation</h1>
    <p class="loading">Redirecting to API documentation...</p>
    <p>If you are not redirected automatically, <a href="@docs/api/README.md">click here</a>.</p>
</body>
</html>`;

  const docsDir = path.join(__dirname, '..', 'docs');
  const redirectPath = path.join(docsDir, 'api', 'index.html');
  
  // Create api directory if it doesn't exist
  const apiDir = path.dirname(redirectPath);
  if (!fs.existsSync(apiDir)) {
    fs.mkdirSync(apiDir, { recursive: true });
  }
  
  fs.writeFileSync(redirectPath, redirectContent, 'utf8');
  console.log('✓ Created API documentation redirect');
}

// Function to create a GitHub Pages 404 page that redirects to main docs
function create404Page() {
  const notFoundContent = `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Page Not Found - EVMore</title>
    <style>
        body { 
            font-family: Arial, sans-serif; 
            text-align: center; 
            padding: 50px; 
            background: #f5f5f5;
        }
        .container {
            max-width: 600px;
            margin: 0 auto;
            background: white;
            padding: 40px;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        h1 { color: #333; }
        .error-code { font-size: 72px; color: #e74c3c; margin: 0; }
        .message { color: #666; margin: 20px 0; }
        .links { margin-top: 30px; }
        .links a {
            display: inline-block;
            margin: 10px;
            padding: 10px 20px;
            background: #3498db;
            color: white;
            text-decoration: none;
            border-radius: 4px;
        }
        .links a:hover { background: #2980b9; }
    </style>
</head>
<body>
    <div class="container">
        <h1 class="error-code">404</h1>
        <h1>Page Not Found</h1>
        <p class="message">
            The page you're looking for doesn't exist. 
            It might have been moved or the link might be broken.
        </p>
        <div class="links">
            <a href="/">Home</a>
            <a href="/docs/">Documentation</a>
            <a href="/docs/api-reference.html">API Reference</a>
            <a href="/docs/examples.html">Examples</a>
        </div>
    </div>
</body>
</html>`;

  const docsDir = path.join(__dirname, '..', 'docs');
  const notFoundPath = path.join(docsDir, '404.html');
  
  fs.writeFileSync(notFoundPath, notFoundContent, 'utf8');
  console.log('✓ Created 404 page');
}

// Main execution
console.log('🔧 Fixing documentation links...\n');

try {
  fixDocsLinks();
  createDocsRedirect();
  create404Page();
  
  console.log('\n✅ All documentation links have been fixed!');
  console.log('\n📝 Next steps:');
  console.log('1. Commit and push the changes');
  console.log('2. GitHub Pages should now properly serve the documentation');
  console.log('3. The @docs links should work correctly');
  
} catch (error) {
  console.error('❌ Error fixing documentation links:', error);
  process.exit(1);
} 