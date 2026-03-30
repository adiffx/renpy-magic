#!/bin/bash
set -e

# Bump patch version and package extension

# Read current version
CURRENT_VERSION=$(node -p "require('./package.json').version")
echo "Current version: $CURRENT_VERSION"

# Bump patch version
IFS='.' read -r major minor patch <<< "$CURRENT_VERSION"
NEW_VERSION="$major.$minor.$((patch + 1))"
echo "New version: $NEW_VERSION"

# Update package.json
node -e "
const fs = require('fs');
const pkg = require('./package.json');
pkg.version = '$NEW_VERSION';
fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
"

echo "Updated package.json"

# Compile and package
npm run compile
npm run package

echo ""
echo "Package created: renpy-language-support-$NEW_VERSION.vsix"
echo "Upload it at: https://marketplace.visualstudio.com/manage/publishers/adiffx"
