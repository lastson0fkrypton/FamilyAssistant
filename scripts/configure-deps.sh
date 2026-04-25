#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ROOT_DIR}/.env"

usage() {
  cat <<'EOF'
Usage: ./scripts/configure-deps.sh [options]

Options:
  --ollama-port <port>
  --postgres-port <port>
  --postgres-db <name>
  --postgres-user <user>
  --postgres-password <password>
  --api-port <port>
  --ui-port <port>
  --ollama-model <model>
  -h, --help

Examples:
  ./scripts/configure-deps.sh --ollama-port 11435 --postgres-port 5433
  ./scripts/configure-deps.sh --postgres-db familyassistant --postgres-user app --postgres-password secret
EOF
}

if [[ ! -f "${ENV_FILE}" ]]; then
  "${ROOT_DIR}/scripts/init-env.sh"
fi

set_env_var() {
  local key="$1"
  local value="$2"

  if grep -qE "^${key}=" "${ENV_FILE}"; then
    sed -i "s|^${key}=.*|${key}=${value}|" "${ENV_FILE}"
  else
    echo "${key}=${value}" >> "${ENV_FILE}"
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --ollama-port)
      set_env_var "OLLAMA_PORT" "$2"
      shift 2
      ;;
    --postgres-port)
      set_env_var "POSTGRES_PORT" "$2"
      shift 2
      ;;
    --postgres-db)
      set_env_var "POSTGRES_DB" "$2"
      shift 2
      ;;
    --postgres-user)
      set_env_var "POSTGRES_USER" "$2"
      shift 2
      ;;
    --postgres-password)
      set_env_var "POSTGRES_PASSWORD" "$2"
      shift 2
      ;;
    --api-port)
      set_env_var "API_PORT" "$2"
      shift 2
      ;;
    --ui-port)
      set_env_var "UI_PORT" "$2"
      shift 2
      ;;
    --ollama-model)
      set_env_var "OLLAMA_MODEL" "$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

echo "Updated dependency configuration in ${ENV_FILE}"
