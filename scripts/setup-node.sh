#!/usr/bin/env bash
set -euo pipefail

# Installs fnm (Fast Node Manager) to user space and activates Node LTS.
# Safe on ostree/immutable distros (Bazzite, Silverblue, etc.) - no system writes.
# Re-running this script is idempotent.

NODE_VERSION="lts/jod"   # Jod = Node 22 LTS, update as needed.

activate_fnm() {
  export FNM_PATH="${HOME}/.local/share/fnm"
  if [[ -d "${FNM_PATH}" ]]; then
    export PATH="${FNM_PATH}:${PATH}"
  fi
  if command -v fnm >/dev/null 2>&1; then
    eval "$(fnm env --use-on-cd 2>/dev/null || true)"
  fi
}

activate_fnm

if ! command -v fnm >/dev/null 2>&1; then
  echo "Installing fnm (Fast Node Manager) to user space..."
  curl -fsSL https://fnm.vercel.app/install | bash -s -- --skip-shell
  activate_fnm
fi

if ! command -v fnm >/dev/null 2>&1; then
  echo "fnm install failed or not on PATH. Try opening a new terminal and re-running." >&2
  exit 1
fi

echo "fnm $(fnm --version) ready."

if ! fnm list | grep -q "$(echo "${NODE_VERSION}" | tr '/' '-')"; then
  echo "Installing Node ${NODE_VERSION}..."
  fnm install "${NODE_VERSION}"
fi

fnm use "${NODE_VERSION}"
echo "Node $(node --version) active via fnm."
echo "npm $(npm --version) ready."

# Ensure fnm is sourced for future shells by adding to shell RC if not already there.
add_shell_hook() {
  local RC_FILE="$1"
  local HOOK='eval "$(fnm env --use-on-cd)"'

  if [[ -f "${RC_FILE}" ]] && grep -qF "fnm env" "${RC_FILE}"; then
    return 0
  fi

  if [[ -f "${RC_FILE}" ]]; then
    echo "" >> "${RC_FILE}"
    echo "# fnm (Fast Node Manager)" >> "${RC_FILE}"
    echo "export PATH=\"\${HOME}/.local/share/fnm:\${PATH}\"" >> "${RC_FILE}"
    echo "${HOOK}" >> "${RC_FILE}"
    echo "Added fnm hook to ${RC_FILE}"
  fi
}

add_shell_hook "${HOME}/.bashrc"
add_shell_hook "${HOME}/.zshrc"

echo "Done. Node is ready for this session. Open a new terminal to have it persist automatically."
