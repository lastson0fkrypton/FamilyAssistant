#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${ROOT_DIR}/.env"
API_DIR="${ROOT_DIR}/api"
VAR_DIR="${ROOT_DIR}/var"
API_LOG_FILE="${VAR_DIR}/api-dev.log"
API_PID_FILE="${VAR_DIR}/api-dev.pid"

FA_OPEN_BROWSER="${FA_OPEN_BROWSER:-1}"
FA_DETACH="${FA_DETACH:-0}"

header() {
  echo ""
  echo "==> $*"
}

fail() {
  echo "Error: $*" >&2
  exit 1
}

activate_fnm() {
  export FNM_PATH="${HOME}/.local/share/fnm"
  export PATH="${FNM_PATH}:${PATH}"
  if command -v fnm >/dev/null 2>&1; then
    eval "$(fnm env --use-on-cd 2>/dev/null || true)"
  fi
}

read_env_value() {
  local key="$1"

  if [[ ! -f "${ENV_FILE}" ]]; then
    return 1
  fi

  grep -E "^${key}=" "${ENV_FILE}" | tail -n1 | cut -d= -f2-
}

wait_for_http() {
  local url="$1"
  local label="$2"
  local timeout_s="$3"
  local elapsed=0

  while (( elapsed < timeout_s )); do
    if curl -fsS "${url}" >/dev/null 2>&1; then
      echo "${label} is ready at ${url}"
      return 0
    fi
    sleep 1
    elapsed=$((elapsed + 1))
  done

  return 1
}

ensure_api_dependencies() {
  if [[ ! -f "${API_DIR}/package.json" ]]; then
    fail "API package.json not found at ${API_DIR}"
  fi

  if [[ ! -d "${API_DIR}/node_modules" ]]; then
    header "Installing API dependencies..."
    npm --prefix "${API_DIR}" install
  fi
}

is_pid_running() {
  local pid="$1"
  kill -0 "${pid}" >/dev/null 2>&1
}

is_api_healthy() {
  local api_port="$1"
  curl -fsS "http://127.0.0.1:${api_port}/healthz" >/dev/null 2>&1
}

check_port_in_use() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    lsof -iTCP:"${port}" -sTCP:LISTEN -t >/dev/null 2>&1
    return $?
  fi

  if command -v ss >/dev/null 2>&1; then
    ss -ltn "sport = :${port}" | tail -n +2 | grep -q .
    return $?
  fi

  return 1
}

open_browser() {
  local url="$1"

  if [[ "${FA_OPEN_BROWSER}" != "1" ]]; then
    echo "Browser launch skipped (FA_OPEN_BROWSER=${FA_OPEN_BROWSER})."
    return 0
  fi

  if command -v xdg-open >/dev/null 2>&1; then
    xdg-open "${url}" >/dev/null 2>&1 &
    return 0
  fi

  if command -v gio >/dev/null 2>&1; then
    gio open "${url}" >/dev/null 2>&1 &
    return 0
  fi

  if command -v python3 >/dev/null 2>&1; then
    python3 -m webbrowser "${url}" >/dev/null 2>&1 &
    return 0
  fi

  echo "No browser launcher found. Open manually: ${url}"
}

print_recent_logs() {
  if [[ -f "${API_LOG_FILE}" ]]; then
    echo ""
    echo "Recent API logs:"
    tail -n 40 "${API_LOG_FILE}" || true
  fi
}

cleanup() {
  if [[ -n "${STARTED_API_PID:-}" ]] && is_pid_running "${STARTED_API_PID}"; then
    echo ""
    echo "Stopping API (PID ${STARTED_API_PID})..."
    kill "${STARTED_API_PID}" >/dev/null 2>&1 || true
    wait "${STARTED_API_PID}" 2>/dev/null || true
  fi

  if [[ -n "${STARTED_API_PID:-}" ]]; then
    rm -f "${API_PID_FILE}"
  fi
}

trap cleanup EXIT INT TERM

header "Preparing runtime..."
mkdir -p "${VAR_DIR}"

bash "${ROOT_DIR}/scripts/setup-node.sh"
activate_fnm

header "Initialising environment file..."
bash "${ROOT_DIR}/scripts/init-env.sh"

API_PORT="$(read_env_value API_PORT || true)"
API_PORT="${API_PORT:-3000}"
OLLAMA_PORT="$(read_env_value OLLAMA_PORT || true)"
OLLAMA_PORT="${OLLAMA_PORT:-11435}"
OLLAMA_MODEL="$(read_env_value OLLAMA_MODEL || true)"
OLLAMA_MODEL="${OLLAMA_MODEL:-llama3:8b}"
OLLAMA_GPU_ENABLED="$(read_env_value OLLAMA_GPU_ENABLED || true)"
OLLAMA_GPU_ENABLED="${OLLAMA_GPU_ENABLED:-false}"
UI_URL="http://127.0.0.1:${API_PORT}/ui/"

header "Starting backend dependency containers..."
bash "${ROOT_DIR}/scripts/deps.sh" up

header "Waiting for backend dependencies..."
bash "${ROOT_DIR}/scripts/deps.sh" wait

header "Ensuring Ollama model is available..."
bash "${ROOT_DIR}/scripts/deps.sh" model "${OLLAMA_MODEL}"

header "Warming Ollama model..."
bash "${ROOT_DIR}/scripts/deps.sh" warm "${OLLAMA_MODEL}"

if [[ "${OLLAMA_GPU_ENABLED}" == "true" ]]; then
  header "Checking Ollama GPU usage..."
  if command -v podman >/dev/null 2>&1 && podman ps --format '{{.Names}}' | grep -Fxq familyassistant-ollama; then
    OLLAMA_PS_OUTPUT="$(podman exec familyassistant-ollama ollama ps | cat)"
    echo "${OLLAMA_PS_OUTPUT}"
    if ! grep -Eq 'GPU|CUDA' <<<"${OLLAMA_PS_OUTPUT}"; then
      fail "OLLAMA_GPU_ENABLED=true but Ollama did not report GPU-backed execution."
    fi
  else
    echo "Podman container inspection unavailable; skipped direct GPU processor check."
  fi
fi

ensure_api_dependencies

header "Starting API..."
if [[ -f "${API_PID_FILE}" ]]; then
  EXISTING_PID="$(cat "${API_PID_FILE}" 2>/dev/null || true)"
else
  EXISTING_PID=""
fi

if [[ -n "${EXISTING_PID}" ]] && is_pid_running "${EXISTING_PID}" && is_api_healthy "${API_PORT}"; then
  echo "Reusing API process from ${API_PID_FILE} (PID ${EXISTING_PID})."
elif is_api_healthy "${API_PORT}"; then
  echo "Reusing already-running API on port ${API_PORT}."
elif check_port_in_use "${API_PORT}"; then
  fail "Port ${API_PORT} is already in use by a non-responsive process. Stop it and rerun ./run.sh."
else
  : > "${API_LOG_FILE}"
  npm --prefix "${API_DIR}" run dev >>"${API_LOG_FILE}" 2>&1 &
  STARTED_API_PID=$!
  echo "${STARTED_API_PID}" > "${API_PID_FILE}"
  echo "Started API PID ${STARTED_API_PID}. Logs: ${API_LOG_FILE}"
fi

header "Running startup smoke tests..."
wait_for_http "http://127.0.0.1:${API_PORT}/healthz" "API health" 120 || {
  print_recent_logs
  fail "API health endpoint did not become ready."
}

READYZ_RESPONSE="$(curl -fsS "http://127.0.0.1:${API_PORT}/readyz")" || {
  print_recent_logs
  fail "API readiness endpoint failed."
}
echo "Readyz: ${READYZ_RESPONSE}"

wait_for_http "${UI_URL}" "UI" 60 || {
  print_recent_logs
  fail "UI did not become reachable at ${UI_URL}."
}

header "Opening browser..."
open_browser "${UI_URL}"

echo ""
echo "FamilyAssistant is running."
echo "UI:       ${UI_URL}"
echo "API log:  ${API_LOG_FILE}"
echo ""

if [[ -n "${STARTED_API_PID:-}" && "${FA_DETACH}" == "1" ]]; then
  echo "Detached mode enabled. API will continue running in the background."
  trap - EXIT INT TERM
  exit 0
fi

if [[ -n "${STARTED_API_PID:-}" ]]; then
  echo "Press Ctrl+C to stop the API started by this script."
  wait "${STARTED_API_PID}"
else
  echo "API was already running. Press Ctrl+C to exit this helper without stopping the existing API."
  while true; do
    sleep 3600
  done
fi