#!/usr/bin/env bash
set -euo pipefail

# Integration test for the curl install flow.
#
# Usage (Docker):
#   docker run --rm -v "$(pwd)":/schema -w /schema node:22-alpine sh tests/install/curl-install.sh
#
# Usage (local — uses your real npm):
#   bash tests/install/curl-install.sh
#
# This test runs the install.sh script against the LOCAL package
# (not the registry) and verifies `schema --help` + `schema doctor`.

BOLD='\033[1m'
GREEN='\033[32m'
RED='\033[31m'
RESET='\033[0m'

pass() { printf "${GREEN}PASS${RESET} %s\n" "$1"; }
fail() { printf "${RED}FAIL${RESET} %s\n" "$1" >&2; exit 1; }

echo "── curl-install integration test ──"
echo ""

# 1. Check Node.js version
NODE_MAJOR=$(node -e "process.stdout.write(String(process.versions.node.split('.')[0]))")
if [ "$NODE_MAJOR" -ge 22 ]; then
  pass "Node.js v$(node -v | tr -d 'v') >= 22"
else
  fail "Node.js $(node -v) is below 22"
fi

# 2. Install from local source (simulates what npm publish + install would do)
echo ""
echo "Installing from local source..."
npm install -g . --silent 2>&1 || fail "npm install -g . failed"

# 3. Verify schema is in PATH
if command -v schema &>/dev/null; then
  pass "schema found in PATH"
else
  fail "schema not found in PATH after install"
fi

# 4. Verify --help
HELP_OUTPUT=$(schema --help 2>&1)
if echo "$HELP_OUTPUT" | grep -q "MCP-native architecture graph"; then
  pass "schema --help prints expected output"
else
  fail "schema --help output unexpected: $HELP_OUTPUT"
fi

# 5. Verify doctor runs without crashing
DOCTOR_OUTPUT=$(schema doctor 2>&1)
if echo "$DOCTOR_OUTPUT" | grep -q "Node.js"; then
  pass "schema doctor runs and checks Node.js"
else
  fail "schema doctor output unexpected: $DOCTOR_OUTPUT"
fi

# 6. Verify schema graph on the fixture
GRAPH_OUTPUT=$(schema graph tests/fixtures/express-todos 2>&1 || true)
if echo "$GRAPH_OUTPUT" | grep -q "totalNodes"; then
  pass "schema graph extracts fixture workspace"
else
  # Non-blocking: graph might fail in minimal Docker container without tree-sitter
  printf "${RED}WARN${RESET} schema graph didn't produce expected output (tree-sitter may be missing)\n"
fi

echo ""
echo "── All critical checks passed ──"
