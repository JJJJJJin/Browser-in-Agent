#!/usr/bin/env bash
# ── Browser-in-Agent MCP — one-click local setup (macOS / Linux) ────────────
# Installs dependencies, Playwright browsers, builds the server, and prepares
# a .env file. Re-runnable: safe to run again any time.
set -euo pipefail

# Resolve repo root (this script lives in <root>/scripts) and run from there.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

bold() { printf '\033[1m%s\033[0m\n' "$1"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; }
info() { printf '  \033[36m→\033[0m %s\n' "$1"; }
die()  { printf '  \033[31m✗ %s\033[0m\n' "$1" >&2; exit 1; }

bold "Browser-in-Agent MCP · setup"

# 1. Node.js >= 20 ----------------------------------------------------------
command -v node >/dev/null 2>&1 || die "Node.js not found. Install Node >= 20 from https://nodejs.org"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 20 ]; then
  die "Node.js >= 20 required (found $(node -v))."
fi
ok "Node $(node -v)"

command -v npm >/dev/null 2>&1 || die "npm not found."
ok "npm $(npm -v)"

# 2. Dependencies -----------------------------------------------------------
info "Installing npm dependencies…"
if [ -f package-lock.json ]; then
  npm ci || npm install
else
  npm install
fi
ok "Dependencies installed"

# 3. Playwright browsers ----------------------------------------------------
info "Installing Playwright browsers (chromium + firefox)…"
npx playwright install chromium firefox
ok "Browsers installed"

# 4. Build ------------------------------------------------------------------
info "Building TypeScript…"
npm run build
ok "Built to dist/"

# 5. .env -------------------------------------------------------------------
if [ ! -f .env ]; then
  cp .env.example .env
  ok "Created .env from .env.example (edit it to set PORT / vision keys)"
else
  info ".env already exists — left untouched"
fi

# 6. guidelines dir ---------------------------------------------------------
mkdir -p guidelines
ok "guidelines/ ready"

echo
bold "Done. Next steps:"
echo "  • Start (built):   npm start"
echo "  • Start (dev):     npm run dev"
echo "  • The MCP endpoint is  http://localhost:7777/mcp"
echo "  • Optional vision: set VISION_PROVIDER / VISION_API_KEY in .env"
echo "  • Deployment guide: docs/INSTALL.md"
