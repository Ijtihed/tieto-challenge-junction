#!/usr/bin/env bash
set -euo pipefail

# Schema installer — one command to install the Schema MCP server.
# Usage: curl -fsSL https://schema.dev/install.sh | sh
#
# For v1.0 this wraps `npm install -g` since Schema requires Node.js.
# Compiled platform binaries are a v1.1 follow-up; this script will
# detect and prefer them once GitHub releases exist.

BOLD='\033[1m'
DIM='\033[2m'
GREEN='\033[32m'
YELLOW='\033[33m'
RED='\033[31m'
RESET='\033[0m'

info()  { printf "${GREEN}▸${RESET} %s\n" "$1"; }
warn()  { printf "${YELLOW}▸${RESET} %s\n" "$1"; }
error() { printf "${RED}✗${RESET} %s\n" "$1" >&2; }

# ── Detect platform ──

OS="$(uname -s)"
ARCH="$(uname -m)"

case "$OS" in
  Darwin)  PLATFORM="macOS" ;;
  Linux)   PLATFORM="Linux" ;;
  *)       error "Unsupported OS: $OS"; exit 1 ;;
esac

case "$ARCH" in
  x86_64)  ARCH_LABEL="x64" ;;
  arm64|aarch64) ARCH_LABEL="arm64" ;;
  *)       error "Unsupported architecture: $ARCH"; exit 1 ;;
esac

info "Platform: $PLATFORM $ARCH_LABEL"

# ── Check Node.js ──

if ! command -v node &>/dev/null; then
  error "Node.js is required but not found."
  echo ""
  echo "Install Node.js 22+ from https://nodejs.org/ or via:"
  if [ "$PLATFORM" = "macOS" ]; then
    echo "  brew install node"
  fi
  echo "  curl -fsSL https://fnm.vercel.app/install | bash && fnm install 22"
  exit 1
fi

NODE_MAJOR=$(node -e "process.stdout.write(String(process.versions.node.split('.')[0]))")
if [ "$NODE_MAJOR" -lt 22 ]; then
  error "Node.js 22+ required (found v$(node -v | tr -d 'v'))."
  if [ "$PLATFORM" = "macOS" ]; then
    echo "  brew upgrade node"
  fi
  echo "  fnm install 22   or   nvm install 22"
  exit 1
fi

info "Node.js v$(node -v | tr -d 'v') ✓"

# ── Install via npm ──

info "Installing @schema-ai/mcp..."
if npm install -g @schema-ai/mcp@latest 2>/dev/null; then
  : # success
elif command -v sudo &>/dev/null; then
  warn "Retrying with sudo..."
  sudo npm install -g @schema-ai/mcp@latest
else
  error "npm install failed. Check permissions on \$(npm config get prefix)."
  exit 1
fi

# ── Verify ──

if ! command -v schema &>/dev/null; then
  NPM_PREFIX="$(npm config get prefix 2>/dev/null || echo '(unknown)')"
  error "'schema' is not in PATH after install."
  echo ""
  echo "  npm global bin: $NPM_PREFIX/bin"
  echo "  Add it to your PATH:"
  echo "    export PATH=\"$NPM_PREFIX/bin:\$PATH\""
  echo ""
  echo "  Then re-run: schema doctor"
  exit 1
fi

info "schema installed ✓"

# ── Print next steps ──

echo ""
printf "${BOLD}Done!${RESET} Schema is ready.\n"
echo ""
echo "Quick start:"
echo ""
echo "  schema graph .              # Print graph summary for current directory"
echo "  schema rules .              # Evaluate architectural rules"
echo "  schema serve                # Start HTTP server on :7474"
echo "  schema doctor               # Check environment and MCP config"
echo ""
echo "For Claude Code / Cursor / Cline, add to your MCP config:"
echo ""
echo '  {'
echo '    "mcpServers": {'
echo '      "schema": {'
echo '        "command": "npx",'
echo '        "args": ["-y", "@schema-ai/mcp@latest"]'
echo '      }'
echo '    }'
echo '  }'
echo ""
echo "Run 'schema doctor' to verify everything is wired up."
echo ""
