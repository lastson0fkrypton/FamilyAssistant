#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ROOT_DIR}/.env"

read_env_value() {
  local key="$1"

  if [[ ! -f "${ENV_FILE}" ]]; then
    return 1
  fi

  grep -E "^${key}=" "${ENV_FILE}" | tail -n1 | cut -d= -f2-
}

OLLAMA_BASE_URL="$(read_env_value OLLAMA_BASE_URL || true)"
OLLAMA_BASE_URL="${OLLAMA_BASE_URL:-http://127.0.0.1:11434}"
DEFAULT_MODEL="$(read_env_value OLLAMA_MODEL || true)"
DEFAULT_MODEL="${DEFAULT_MODEL:-llama3:8b}"
WARM_TIMEOUT_S="$(read_env_value OLLAMA_WARM_TIMEOUT_S || true)"
WARM_TIMEOUT_S="${WARM_TIMEOUT_S:-120}"
OLLAMA_CONTAINER_NAME="familyassistant-ollama"

usage() {
  cat <<'EOF'
Usage: ./scripts/ollama-model.sh <command> [model]

Commands:
  list                 List locally available Ollama models
  pull [model]         Pull model into local Ollama store (default from OLLAMA_MODEL)
  ensure [model]       Pull model only if missing
  warm [model]         Run a short generation to warm model into memory
  status [model]       Print whether model exists locally

Examples:
  ./scripts/ollama-model.sh list
  ./scripts/ollama-model.sh ensure llama3:8b
  ./scripts/ollama-model.sh warm
EOF
}

require_ollama() {
  if ! curl -fsS "${OLLAMA_BASE_URL}/api/version" >/dev/null; then
    echo "Ollama API is not reachable at ${OLLAMA_BASE_URL}" >&2
    echo "Start dependencies first: ./scripts/deps.sh up && ./scripts/deps.sh wait" >&2
    exit 1
  fi
}

model_exists() {
  local model="$1"
  curl -fsS "${OLLAMA_BASE_URL}/api/tags" | grep -Fq "\"name\":\"${model}\""
}

list_models() {
  curl -fsS "${OLLAMA_BASE_URL}/api/tags"
}

pull_model() {
  local model="$1"
  echo "Pulling model: ${model}"

  # Prefer in-container CLI pull for long downloads: it is more reliable
  # than API pull on some Podman/Desktop setups.
  if command -v podman >/dev/null 2>&1 && podman ps --format '{{.Names}}' | grep -Fxq "${OLLAMA_CONTAINER_NAME}"; then
    podman exec "${OLLAMA_CONTAINER_NAME}" ollama pull "${model}"
    return 0
  fi

  if command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' | grep -Fxq "${OLLAMA_CONTAINER_NAME}"; then
    docker exec "${OLLAMA_CONTAINER_NAME}" ollama pull "${model}"
    return 0
  fi

  # Fallback to HTTP API for non-containerized Ollama.
  curl -fsS "${OLLAMA_BASE_URL}/api/pull" \
    -H 'content-type: application/json' \
    -d "{\"name\":\"${model}\"}" >/dev/null
}

warm_model() {
  local model="$1"
  echo "Warming model: ${model}"
  curl -fsS --max-time "${WARM_TIMEOUT_S}" "${OLLAMA_BASE_URL}/api/generate" \
    -H 'content-type: application/json' \
    -d "{\"model\":\"${model}\",\"prompt\":\"hello\",\"stream\":false,\"keep_alive\":\"5m\",\"options\":{\"num_predict\":1}}" >/dev/null
}

if [[ $# -lt 1 ]]; then
  usage
  exit 1
fi

COMMAND="$1"
MODEL="${2:-${DEFAULT_MODEL}}"

require_ollama

case "${COMMAND}" in
  list)
    list_models
    ;;
  pull)
    pull_model "${MODEL}"
    echo "Model pull complete: ${MODEL}"
    ;;
  ensure)
    if model_exists "${MODEL}"; then
      echo "Model already present: ${MODEL}"
    else
      pull_model "${MODEL}"
      echo "Model pull complete: ${MODEL}"
    fi
    ;;
  warm)
    if ! model_exists "${MODEL}"; then
      echo "Model not found locally, pulling first: ${MODEL}"
      pull_model "${MODEL}"
    fi
    warm_model "${MODEL}"
    echo "Model warmed: ${MODEL}"
    ;;
  status)
    if model_exists "${MODEL}"; then
      echo "present: ${MODEL}"
      exit 0
    fi
    echo "missing: ${MODEL}"
    exit 1
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