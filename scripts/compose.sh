#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

resolve_compose_cmd() {
  # Prefer standalone podman-compose over the podman compose shim.
  # On Bazzite and other ostree-based distros the shim may delegate to a
  # docker-compose plugin that requires a Docker socket; standalone
  # podman-compose talks directly to the Podman API and avoids that issue.
  # Install with: pip install --user podman-compose
  if command -v podman >/dev/null 2>&1 && podman info >/dev/null 2>&1; then
    if command -v podman-compose >/dev/null 2>&1; then
      echo "podman-compose"
      return 0
    fi

    # Shim fallback: only use if it resolves to something other than docker-compose.
    if podman compose version >/dev/null 2>&1; then
      local shim_target
      shim_target="$(podman compose 2>/dev/null | head -1 || true)"
      if [[ "${shim_target}" != *"docker"* ]]; then
        echo "podman compose"
        return 0
      fi
    fi

    echo "Podman is running but no usable compose implementation was found." >&2
    echo "Install podman-compose with: pip install --user podman-compose" >&2
  fi

  if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    echo "docker compose"
    return 0
  fi

  if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1 && command -v docker-compose >/dev/null 2>&1; then
    echo "docker-compose"
    return 0
  fi

  echo "No usable compose runtime found." >&2
  echo "Options:" >&2
  echo "  Podman (recommended): pip install --user podman-compose" >&2
  echo "  Docker: install docker engine with the compose plugin" >&2
  exit 1
}

usage() {
  cat <<'EOF'
Usage: ./scripts/compose.sh <command> [args]

Commands:
  up      Start stack in detached mode
  down    Stop and remove stack resources
  start   Start existing service containers
  stop    Stop running service containers
  logs    Stream or fetch service logs
  ps      Show service status

Examples:
  ./scripts/compose.sh up
  ./scripts/compose.sh logs api
  ./scripts/compose.sh stop postgres ollama
EOF
}

if [[ $# -lt 1 ]]; then
  usage
  exit 1
fi

COMPOSE_CMD="$(resolve_compose_cmd)"
COMPOSE_FILE="${ROOT_DIR}/compose.yaml"
COMPOSE_GPU_FILE="${ROOT_DIR}/compose.gpu.yaml"
ENV_FILE="${ROOT_DIR}/.env"

SUBCOMMAND="$1"
shift

if [[ ! -f "${ENV_FILE}" ]]; then
  echo ".env not found. Copy .env.example to .env and adjust values before running." >&2
  exit 1
fi

COMPOSE_FILES=(-f "${COMPOSE_FILE}")

GPU_ENABLED="$(grep -E '^OLLAMA_GPU_ENABLED=' "${ENV_FILE}" | tail -n1 | cut -d= -f2- | tr -d '[:space:]')"

if [[ "${GPU_ENABLED:-false}" == "true" ]]; then
  if [[ ! -f "${COMPOSE_GPU_FILE}" ]]; then
    echo "GPU overlay file not found: ${COMPOSE_GPU_FILE}" >&2
    exit 1
  fi

  COMPOSE_FILES+=( -f "${COMPOSE_GPU_FILE}" )
fi

run_compose() {
  # shellcheck disable=SC2086
  ${COMPOSE_CMD} --env-file "${ENV_FILE}" ${COMPOSE_FILES[@]} "$@"
}

case "${SUBCOMMAND}" in
  up)
    run_compose up -d "$@"
    ;;
  down)
    run_compose down "$@"
    ;;
  start)
    run_compose start "$@"
    ;;
  stop)
    run_compose stop "$@"
    ;;
  logs)
    run_compose logs -f "$@"
    ;;
  ps)
    run_compose ps "$@"
    ;;
  *)
    usage
    exit 1
    ;;
esac
