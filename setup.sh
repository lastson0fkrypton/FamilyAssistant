#!/usr/bin/env bash
set -euo pipefail

# One-command local dev setup.
# Installs Node.js (via fnm, user-space only), initialises .env, and
# optionally starts the backend dependency containers (Ollama + PostgreSQL).

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

header() {
  echo ""
  echo "==> $*"
}

# ── 1. Node.js ────────────────────────────────────────────────────────────────
header "Setting up Node.js..."
bash "${ROOT_DIR}/scripts/setup-node.sh"

# Re-activate fnm so the remainder of this script can use node/npm.
export FNM_PATH="${HOME}/.local/share/fnm"
export PATH="${FNM_PATH}:${PATH}"
eval "$(fnm env --use-on-cd 2>/dev/null || true)"

# ── 2. Environment file ───────────────────────────────────────────────────────
header "Initialising environment file..."
bash "${ROOT_DIR}/scripts/init-env.sh"

# ── 3. Start backend dependencies ─────────────────────────────────────────────
if [[ "${SKIP_DEPS:-}" != "1" ]]; then
  header "Starting backend dependency containers (Ollama + PostgreSQL)..."
  bash "${ROOT_DIR}/scripts/deps.sh" up

  header "Waiting for dependencies to be reachable..."
  bash "${ROOT_DIR}/scripts/deps.sh" wait
fi

# ── 4. Install API dependencies ───────────────────────────────────────────────
if [[ -f "${ROOT_DIR}/api/package.json" ]]; then
  header "Installing API dependencies..."
  npm --prefix "${ROOT_DIR}/api" install
fi

# ── 5. Install UI dependencies ────────────────────────────────────────────────
if [[ -f "${ROOT_DIR}/ui/package.json" ]]; then
  header "Installing UI dependencies..."
  npm --prefix "${ROOT_DIR}/ui" install
fi

header "Setup complete."
echo ""
echo "  Start deps:   ./scripts/deps.sh up"
echo "  Check status: ./scripts/compose.sh ps"
echo "  Test Ollama:  curl http://localhost:\${OLLAMA_PORT:-11435}/api/version"
echo ""
echo "  When API and UI are scaffolded, run them locally with:"
echo "    node api/src/index.js"
echo "    npm --prefix ui run dev"
