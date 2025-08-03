#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Favicon sizes for different devices and browsers
const faviconSizes = [
  { size: 16, name: 'favicon-16x16.png' },
  { size: 32, name: 'favicon-32x32.png' },
  { size: 48, name: 'favicon-48x48.png' },
  { size: 180, name: 'apple-touch-icon.png' },
  { size: 192, name: 'android-chrome-192x192.png' },
  { size: 512, name: 'android-chrome-512x512.png' },
  { size: 16, name: 'favicon.ico' } // ICO format
];

// Generate favicon HTML tags
function generateFaviconHTML() {
  return `
<!-- Favicon -->
<link rel="icon" type="image/x-icon" href="/favicon.ico">
<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png">
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">
<link rel="icon" type="image/png" sizes="48x48" href="/favicon-48x48.png">

<!-- Apple Touch Icon -->
<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">

<!-- Android Chrome Icons -->
<link rel="icon" type="image/png" sizes="192x192" href="/android-chrome-192x192.png">
<link rel="icon" type="image/png" sizes="512x512" href="/android-chrome-512x512.png">

<!-- Web App Manifest -->
<link rel="manifest" href="/site.webmanifest">

<!-- Theme Color -->
<meta name="theme-color" content="#3B82F6">
<meta name="msapplication-TileColor" content="#3B82F6">
`;
}

// Generate web app manifest
function generateWebManifest() {
  return {
    name: "EVMore - Cross-Chain Swap Protocol",
    short_name: "EVMore",
    description: "Decentralized cross-chain swap protocol",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#3B82F6",
    icons: [
      {
        src: "/android-chrome-192x192.png",
        sizes: "192x192",
        type: "image/png"
      },
      {
        src: "/android-chrome-512x512.png",
        sizes: "512x512",
        type: "image/png"
      }
    ]
  };
}

// Generate favicon HTML for documentation
function generateDocsFaviconHTML() {
  return `
<!-- Favicon -->
<link rel="icon" type="image/x-icon" href="favicon.ico">
<link rel="icon" type="image/png" sizes="16x16" href="favicon-16x16.png">
<link rel="icon" type="image/png" sizes="32x32" href="favicon-32x32.png">
<link rel="icon" type="image/png" sizes="48x48" href="favicon-48x48.png">

<!-- Apple Touch Icon -->
<link rel="apple-touch-icon" sizes="180x180" href="apple-touch-icon.png">

<!-- Android Chrome Icons -->
<link rel="icon" type="image/png" sizes="192x192" href="android-chrome-192x192.png">
<link rel="icon" type="image/png" sizes="512x512" href="android-chrome-512x512.png">

<!-- Web App Manifest -->
<link rel="manifest" href="site.webmanifest">

<!-- Theme Color -->
<meta name="theme-color" content="#3B82F6">
<meta name="msapplication-TileColor" content="#3B82F6">
`;
}

// Create directories if they don't exist
function ensureDirectoryExists(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

// Copy favicon files to docs directory
function copyFaviconsToDocs() {
  const frontendPublic = path.join(__dirname, '..', 'frontend', 'public');
  const docsDir = path.join(__dirname, '..', 'docs');
  
  faviconSizes.forEach(({ name }) => {
    const sourcePath = path.join(frontendPublic, name);
    const destPath = path.join(docsDir, name);
    
    if (fs.existsSync(sourcePath)) {
      fs.copyFileSync(sourcePath, destPath);
      console.log(`✓ Copied ${name} to docs/`);
    }
  });
  
  // Copy web manifest
  const manifestSource = path.join(frontendPublic, 'site.webmanifest');
  const manifestDest = path.join(docsDir, 'site.webmanifest');
  
  if (fs.existsSync(manifestSource)) {
    fs.copyFileSync(manifestSource, manifestDest);
    console.log('✓ Copied site.webmanifest to docs/');
  }
}

// Update HTML files with favicon tags
function updateHTMLFiles() {
  const frontendIndex = path.join(__dirname, '..', 'frontend', 'index.html');
  const docsIndex = path.join(__dirname, '..', 'docs', 'index.html');
  
  // Update frontend index.html
  if (fs.existsSync(frontendIndex)) {
    let content = fs.readFileSync(frontendIndex, 'utf8');
    
    // Remove existing favicon tags if any
    content = content.replace(/<!-- Favicon -->[\s\S]*?<!-- Theme Color -->\s*<\/meta>/g, '');
    
    // Add new favicon tags
    const faviconHTML = generateFaviconHTML();
    content = content.replace('</head>', `${faviconHTML}\n</head>`);
    
    fs.writeFileSync(frontendIndex, content, 'utf8');
    console.log('✓ Updated frontend/index.html with favicon tags');
  }
  
  // Update docs index.html
  if (fs.existsSync(docsIndex)) {
    let content = fs.readFileSync(docsIndex, 'utf8');
    
    // Remove existing favicon tags if any
    content = content.replace(/<!-- Favicon -->[\s\S]*?<!-- Theme Color -->\s*<\/meta>/g, '');
    
    // Add new favicon tags
    const faviconHTML = generateDocsFaviconHTML();
    content = content.replace('</head>', `${faviconHTML}\n</head>`);
    
    fs.writeFileSync(docsIndex, content, 'utf8');
    console.log('✓ Updated docs/index.html with favicon tags');
  }
}

// Main execution
console.log('🎨 Generating EVMore favicons...\n');

try {
  // Ensure directories exist
  const frontendPublic = path.join(__dirname, '..', 'frontend', 'public');
  ensureDirectoryExists(frontendPublic);
  
  // Generate web manifest
  const manifest = generateWebManifest();
  fs.writeFileSync(
    path.join(frontendPublic, 'site.webmanifest'),
    JSON.stringify(manifest, null, 2),
    'utf8'
  );
  console.log('✓ Generated site.webmanifest');
  
  // Copy favicons to docs
  copyFaviconsToDocs();
  
  // Update HTML files
  updateHTMLFiles();
  
  console.log('\n✅ Favicon generation completed!');
  console.log('\n📝 Next steps:');
  console.log('1. Convert the SVG logo to PNG/ICO formats using an online tool or image editor');
  console.log('2. Place the generated favicon files in frontend/public/');
  console.log('3. The favicon tags have been added to both index.html files');
  console.log('4. Test the favicons in different browsers and devices');
  
} catch (error) {
  console.error('❌ Error generating favicons:', error);
  process.exit(1);
} 