#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_EXAMPLE="${ROOT_DIR}/.env.example"
ENV_FILE="${ROOT_DIR}/.env"

FORCE=0

usage() {
  cat <<'EOF'
Usage: ./scripts/init-env.sh [--force]

Options:
  --force   Overwrite existing .env from .env.example
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --force)
      FORCE=1
      shift
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

if [[ ! -f "${ENV_EXAMPLE}" ]]; then
  echo "Missing .env.example at ${ENV_EXAMPLE}" >&2
  exit 1
fi

if [[ -f "${ENV_FILE}" && "${FORCE}" -ne 1 ]]; then
  echo ".env already exists at ${ENV_FILE}" >&2
  exit 0
fi

cp "${ENV_EXAMPLE}" "${ENV_FILE}"
echo "Created ${ENV_FILE} from .env.example"
