#!/bin/bash
# Double-click this file to launch career-ops studio.
cd "$(dirname "$0")" || exit 1

# Prefer a Node >= 22 (the career-ops web app requires it). nvm if present.
if ! node -e 'process.exit(+process.versions.node.split(".")[0] >= 22 ? 0 : 1)' 2>/dev/null; then
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  # shellcheck disable=SC1091
  [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" && nvm use 22 >/dev/null 2>&1
fi

if ! node -e 'process.exit(+process.versions.node.split(".")[0] >= 22 ? 0 : 1)' 2>/dev/null; then
  echo "career-ops studio needs Node 22 or newer. Current: $(node -v 2>/dev/null || echo none)"
  echo "Install it with:  nvm install 22   (or from https://nodejs.org)"
  read -r -p "Press return to close…"
  exit 1
fi

[ -d node_modules ] || npm install
exec node server.mjs
