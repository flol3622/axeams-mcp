#!/bin/sh
# Launch the axeams MCP server from the plugin (or a checkout): pick a JS runtime, make sure the
# Accessibility helper runs on this Mac, then exec the bundled server.
ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
# GUI hosts start MCP servers with a minimal PATH.
export PATH="$HOME/.bun/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

if [ "$(uname -s)" != "Darwin" ]; then
  echo "axeams: macOS only (it drives Microsoft Teams for Mac)" >&2
  exit 1
fi

HELPER="$ROOT/dist/axeams-helper"
chmod +x "$HELPER" 2>/dev/null
if ! "$HELPER" --version >/dev/null 2>&1; then
  # Prebuilt helper unusable (stripped exec bit, quarantine, ...): build one from source.
  DATA="${AXEAMS_DATA:-$HOME/.cache/axeams}"
  mkdir -p "$DATA"
  HELPER="$DATA/axeams-helper"
  if ! "$HELPER" --version >/dev/null 2>&1; then
    if ! swiftc -O -swift-version 5 "$ROOT/helper/TeamsAX.swift" -o "$HELPER" >/dev/null 2>&1; then
      echo "axeams: the bundled helper cannot run and building it needs the Xcode Command Line Tools (xcode-select --install)" >&2
      exit 1
    fi
  fi
fi
export AXEAMS_HELPER="$HELPER"

if command -v node >/dev/null 2>&1; then
  exec node "$ROOT/dist/axeams-mcp.js"
elif command -v bun >/dev/null 2>&1; then
  exec bun "$ROOT/dist/axeams-mcp.js"
fi
echo "axeams: needs Node.js 18+ or Bun on PATH" >&2
exit 1
