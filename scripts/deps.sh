#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_SCRIPT="${ROOT_DIR}/scripts/compose.sh"
MODEL_SCRIPT="${ROOT_DIR}/scripts/ollama-model.sh"
ENV_FILE="${ROOT_DIR}/.env"

usage() {
  cat <<'EOF'
Usage: ./scripts/deps.sh <command>

Commands:
  init-env    Create .env from .env.example if missing
  configure   Update dependency env vars (passes args to configure-deps.sh)
  up          Start Ollama and PostgreSQL containers
  model       Ensure configured Ollama model is pulled locally
  warm        Warm configured Ollama model (pulls first if missing)
  down        Stop Ollama and PostgreSQL containers
  restart     Restart Ollama and PostgreSQL containers
  status      Show status of Ollama and PostgreSQL containers
  logs        Show logs for Ollama and PostgreSQL containers
  wait        Wait until Ollama HTTP and PostgreSQL TCP ports are reachable

Examples:
  ./scripts/deps.sh init-env
  ./scripts/deps.sh configure --postgres-port 5433 --ollama-port 11435
  ./scripts/deps.sh up
  ./scripts/deps.sh model
  ./scripts/deps.sh wait
EOF
}

ensure_env() {
  if [[ ! -f "${ENV_FILE}" ]]; then
    "${ROOT_DIR}/scripts/init-env.sh"
  fi
}

read_env_value() {
  local key="$1"

  if [[ ! -f "${ENV_FILE}" ]]; then
    return 1
  fi

  grep -E "^${key}=" "${ENV_FILE}" | tail -n1 | cut -d= -f2-
}

wait_for_port() {
  local host="$1"
  local port="$2"
  local name="$3"
  local timeout_s="$4"
  local elapsed=0

  while (( elapsed < timeout_s )); do
    if (echo > "/dev/tcp/${host}/${port}") >/dev/null 2>&1; then
      echo "${name} is reachable on ${host}:${port}"
      return 0
    fi
    sleep 1
    elapsed=$((elapsed + 1))
  done

  echo "Timed out waiting for ${name} on ${host}:${port}" >&2
  return 1
}

wait_for_ollama() {
  local port="$1"
  local timeout_s="$2"
  local elapsed=0

  while (( elapsed < timeout_s )); do
    if curl -fsS "http://127.0.0.1:${port}/api/tags" >/dev/null 2>&1; then
      echo "Ollama API is ready on 127.0.0.1:${port}"
      return 0
    fi
    sleep 1
    elapsed=$((elapsed + 1))
  done

  echo "Timed out waiting for Ollama API on 127.0.0.1:${port}" >&2
  return 1
}

if [[ $# -lt 1 ]]; then
  usage
  exit 1
fi

COMMAND="$1"
shift

case "${COMMAND}" in
  init-env)
    "${ROOT_DIR}/scripts/init-env.sh" "$@"
    ;;
  configure)
    ensure_env
    "${ROOT_DIR}/scripts/configure-deps.sh" "$@"
    ;;
  up)
    ensure_env
    "${COMPOSE_SCRIPT}" up postgres ollama
    ;;
  model)
    ensure_env
    "${MODEL_SCRIPT}" ensure "$@"
    ;;
  warm)
    ensure_env
    "${MODEL_SCRIPT}" warm "$@"
    ;;
  down)
    ensure_env
    "${COMPOSE_SCRIPT}" stop postgres ollama
    ;;
  restart)
    ensure_env
    "${COMPOSE_SCRIPT}" stop postgres ollama
    "${COMPOSE_SCRIPT}" start postgres ollama
    ;;
  status)
    ensure_env
    "${COMPOSE_SCRIPT}" ps
    ;;
  logs)
    ensure_env
    "${COMPOSE_SCRIPT}" logs postgres ollama
    ;;
  wait)
    ensure_env
    POSTGRES_PORT="$(read_env_value POSTGRES_PORT || true)"
    POSTGRES_PORT="${POSTGRES_PORT:-5432}"
    OLLAMA_PORT="$(read_env_value OLLAMA_PORT || true)"
    OLLAMA_PORT="${OLLAMA_PORT:-11434}"
    wait_for_port "127.0.0.1" "${POSTGRES_PORT}" "PostgreSQL" 120
    wait_for_ollama "${OLLAMA_PORT}" 180
    ;;
  -h|--help)
    usage
    ;;
  *)
    echo "Unknown command: ${COMMAND}" >&2
    usage
    exit 1
    ;;
esac
