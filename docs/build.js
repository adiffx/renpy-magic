const fs = require('fs');
const path = require('path');
const Mustache = require('mustache');
const { marked } = require('marked');

const SITE_DIR = '_site';
const TEMPLATES_DIR = path.join(__dirname, 'templates');

// Common data for all pages
const commonData = {
  year: new Date().getFullYear()
};

// Ensure directory exists
function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// Read template
function readTemplate(name) {
  return fs.readFileSync(path.join(TEMPLATES_DIR, name), 'utf8');
}

// Build a page
function buildPage(outputPath, title, content, options = {}) {
  const layout = readTemplate('layout.html');
  const html = Mustache.render(layout, {
    ...commonData,
    title,
    content,
    ...options
  });

  ensureDir(path.dirname(outputPath));
  fs.writeFileSync(outputPath, html);
  console.log(`Built: ${outputPath}`);
}

// Main build
function build() {
  ensureDir(SITE_DIR);

  // Build index page
  const indexContent = readTemplate('index.html');
  buildPage(path.join(SITE_DIR, 'index.html'), 'Projects', indexContent);

  // Build renpy-magic page from README
  const readme = fs.readFileSync('README.md', 'utf8');
  let readmeHtml = marked.parse(readme);

  // Wrap the intro section (from h1 to first h2) in a div for styling
  readmeHtml = readmeHtml.replace(
    /(<h1>.*?<\/h1>)([\s\S]*?)(<h2>)/,
    '$1<div class="intro">$2</div>$3'
  );
  // Remove stray </div> from markdown
  readmeHtml = readmeHtml.replace(/<\/div>\s*<\/div>/, '</div>');

  buildPage(
    path.join(SITE_DIR, 'renpy-magic', 'index.html'),
    "Ren'Py Language Support",
    readmeHtml,
    {
      footerLinks: [
        { url: 'https://github.com/adiffx/renpy-magic', text: 'GitHub Repository' },
        { url: 'https://github.com/adiffx/renpy-magic/issues', text: 'Report Issues', last: true }
      ]
    }
  );

  // Copy images to renpy-magic (recursively)
  const imagesDir = path.join(SITE_DIR, 'renpy-magic', 'images');
  copyDirRecursive('images', imagesDir);
  console.log('Copied images to renpy-magic/images/');
}

// Recursively copy a directory
function copyDirRecursive(src, dest) {
  ensureDir(dest);
  if (!fs.existsSync(src)) return;

  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

build();
