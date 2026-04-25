#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VAR_DIR="${ROOT_DIR}/var"
API_PID_FILE="${VAR_DIR}/api-dev.pid"

STOP_DEPS="${FA_STOP_DEPS:-1}"

header() {
  echo ""
  echo "==> $*"
}

is_pid_running() {
  local pid="$1"
  kill -0 "${pid}" >/dev/null 2>&1
}

stop_api() {
  if [[ ! -f "${API_PID_FILE}" ]]; then
    echo "No API PID file found at ${API_PID_FILE}."
    return 0
  fi

  local pid
  pid="$(cat "${API_PID_FILE}" 2>/dev/null || true)"

  if [[ -z "${pid}" ]]; then
    echo "API PID file was empty. Removing stale file."
    rm -f "${API_PID_FILE}"
    return 0
  fi

  if ! is_pid_running "${pid}"; then
    echo "API PID ${pid} is not running. Removing stale file."
    rm -f "${API_PID_FILE}"
    return 0
  fi

  echo "Stopping API PID ${pid}..."
  kill "${pid}" >/dev/null 2>&1 || true

  for _ in $(seq 1 20); do
    if ! is_pid_running "${pid}"; then
      rm -f "${API_PID_FILE}"
      echo "API stopped."
      return 0
    fi
    sleep 1
  done

  echo "API PID ${pid} did not exit after 20 seconds; sending SIGKILL..."
  kill -9 "${pid}" >/dev/null 2>&1 || true
  rm -f "${API_PID_FILE}"
  echo "API stopped."
}

stop_deps() {
  echo "Stopping Ollama and PostgreSQL containers..."
  bash "${ROOT_DIR}/scripts/deps.sh" down
}

header "Stopping local API..."
stop_api

if [[ "${STOP_DEPS}" == "1" ]]; then
  header "Stopping backend dependencies..."
  stop_deps
else
  echo "Dependency container shutdown skipped (FA_STOP_DEPS=${STOP_DEPS})."
fi

echo ""
echo "FamilyAssistant local runtime stopped."