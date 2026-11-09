#!/bin/sh
# Build everything that ships: a universal (arm64 + x86_64), ad-hoc signed helper and a single-file
# server bundle that runs under Node >= 18 or Bun. Output: dist/axeams-helper, dist/axeams-mcp.js
set -e
cd "$(dirname "$0")/.."
mkdir -p dist build
for arch in arm64 x86_64; do
  swiftc -O -swift-version 5 -target "$arch-apple-macos13" helper/TeamsAX.swift -o "build/axeams-helper-$arch"
done
lipo -create build/axeams-helper-arm64 build/axeams-helper-x86_64 -output dist/axeams-helper
codesign --force --sign - --identifier dev.axeams.helper dist/axeams-helper
bun build src/server.ts --target=node --format=esm --minify-syntax --outfile dist/axeams-mcp.js
# Give the bundle a node shebang so `npx axeams-mcp` / `node dist/axeams-mcp.js` work.
{ printf '#!/usr/bin/env node\n'; grep -v '^#!' dist/axeams-mcp.js; } > build/axeams-mcp.js && mv build/axeams-mcp.js dist/axeams-mcp.js
chmod +x dist/axeams-helper dist/axeams-mcp.js
echo "built dist/axeams-helper ($(lipo -archs dist/axeams-helper)) and dist/axeams-mcp.js ($(wc -c < dist/axeams-mcp.js | tr -d ' ') bytes)"
