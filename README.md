# FamilyAssistant

Local-first home automation assistant powered by an LLM interface and deterministic backend services.

## Project Goals

- Run fully self-hosted on local infrastructure.
- Keep business logic deterministic and testable.
- Use the LLM as an intent interface, not a source of truth.
- Preserve transparency and debuggability over hidden automation.

## Core Principles

- Local-first operation with no cloud dependency.
- Deterministic backend, AI as interface layer.
- Modular architecture with clear boundaries.
- Maintainable implementation and minimal dependencies.

## Initial Tech Stack

- Node.js for backend services and APIs.
- Ollama for local LLM inference.
- Qdrant or Chroma for semantic/vector memory.
- SQLite or PostgreSQL for structured data.

## Repository Workflow

Before starting any implementation work:

1. Open working/backlog.md.
2. Select exactly one TODO task.
3. Mark it as IN PROGRESS ([~]).
4. Implement only that task.
5. Mark it DONE ([x]) when finished.

Humans and agents must always select a backlog item before starting work.

## Local Development Setup

Node.js runs locally on your machine (installed to user space via `fnm` — no system package manager or containers needed). Backend dependencies (Ollama and PostgreSQL) run as containers via Podman or Docker.

### Prerequisites

- Podman (preferred, included on Bazzite) or Docker with a compose implementation.
- `curl` and `git`.
- No Node.js pre-installed — `setup.sh` handles it.

### One-command setup

    ./setup.sh

This will:
1. Install `fnm` (Fast Node Manager) to `~/.local/share/fnm` — user space only, safe on immutable distros like Bazzite.
2. Install and activate Node LTS via fnm.
3. Create `.env` from `.env.example` if it does not exist.
4. Start Ollama and PostgreSQL containers.
5. Wait until both are reachable.
6. Pull and warm the configured Ollama model (`OLLAMA_MODEL`, default `llama3:8b`).
7. Install `api/` and `ui/` npm dependencies once those projects are scaffolded.

Note: Ollama does not publish a `llama3:7b` tag. The closest standard option is `llama3:8b` (set as the default).

To skip starting containers (e.g. they are already running):

    SKIP_DEPS=1 ./setup.sh

To skip model download/warmup during setup:

       SKIP_MODEL_PULL=1 ./setup.sh

### One-command run

After setup, start the full local stack with:

       ./start.sh

This will:
1. Ensure Node is available via `fnm`.
2. Ensure `.env` exists.
3. Start Ollama and PostgreSQL containers.
4. Wait for both dependencies to become reachable.
5. Ensure the configured Ollama model exists and warm it into memory.
6. Verify GPU-backed Ollama execution when `OLLAMA_GPU_ENABLED=true`.
7. Start or reuse the local API on port `3000`.
8. Run startup smoke tests against `/healthz`, `/readyz`, and `/ui/`.
9. Open `http://127.0.0.1:3000/ui/` in your browser.

Useful runtime options:

       FA_OPEN_BROWSER=0 ./start.sh
       FA_DETACH=1 ./start.sh

The API log is written to `var/api-dev.log`.

To stop the local runtime:

       ./stop.sh

This stops the API started by `./start.sh` and stops the Ollama and PostgreSQL containers. To stop only the API and leave containers running:

       FA_STOP_DEPS=0 ./stop.sh

> **Bazzite / ostree note:** `fnm` installs Node into your home directory. No `rpm-ostree` layering or reboots are needed. After the first run, open a new terminal for the fnm shell hook to activate automatically.

### Manual steps

1. Start only backend dependencies:

       ./scripts/deps.sh up

2. Check container status:

       ./scripts/compose.sh ps

3. View logs:

       ./scripts/compose.sh logs

4. Stop containers:

       ./scripts/compose.sh down

5. Pull model manually:

       ./scripts/deps.sh model

6. Warm model manually:

       ./scripts/deps.sh warm

7. Stop full local runtime:

       ./stop.sh

## Dependency Test URLs

Once `./scripts/deps.sh up` has completed (or `./scripts/compose.sh up`), verify each dependency is alive:

| Service    | URL / Command                                       | Expected response                          |
|------------|-----------------------------------------------------|--------------------------------------------|
| Ollama API | http://localhost:11435/api/tags                     | JSON object with `models` array            |
| Ollama version | http://localhost:11435/api/version              | JSON with `version` key                    |
| PostgreSQL | `psql -h localhost -p 5433 -U familyassistant -d familyassistant -c '\l'` | Database list |
| API health        | http://localhost:3000/healthz               | `{"status":"ok"}`                          |
| API readiness     | http://localhost:3000/readyz               | `{"status":"ready","checks":{...}}`        |
| Web UI            | http://localhost:3000/ui/                  | FamilyAssistant chat interface             |

Quick curl checks:

    curl http://localhost:11435/api/tags
    curl http://localhost:11435/api/version

Prompt override:

       ORCHESTRATION_SYSTEM_PROMPT="Your custom planner instructions here"

Set that in `.env`, then restart the API to apply it.

Current prompt profile:

- Friendly, family-safe assistant tone.
- Family context for Steve, Stacey, Sienna, and Blake.
- Calendar and schedule help first.
- No internet claims, no device-control claims unless a tool result proves them.

Ollama GPU enablement:

       OLLAMA_GPU_ENABLED=true
       OLLAMA_GPU_DEVICE=nvidia.com/gpu=all
       OLLAMA_WARM_TIMEOUT_S=120

The compose wrapper automatically adds the GPU overlay when `OLLAMA_GPU_ENABLED=true`. On Podman, this expects NVIDIA CDI support on the host. You can verify that with:

       nvidia-ctk cdi list

Ollama processor check:

       podman exec familyassistant-ollama ollama ps

The `PROCESSOR` column will show whether the loaded model is using CPU or GPU.

Notes:
- Compose topology is shared across Podman and Docker.
- On Bazzite and other ostree-based systems, use standalone `podman-compose` rather than the `podman compose` shim (the shim delegates to a docker-compose plugin that expects a Docker socket). Install it without rpm-ostree layering:

      pip install --user podman-compose

- The scripts will automatically prefer `podman-compose` when it is available on your PATH.
- GPU passthrough is implemented as an optional compose overlay so non-GPU systems keep the same base topology. If you change `OLLAMA_GPU_ENABLED`, recreate the Ollama service.

## Contribution Guidelines

- Keep tasks atomic and tracked in working/backlog.md.
- Prefer simple, explicit designs over abstractions.
- Validate API inputs with explicit schemas.
- Keep architecture updates synchronized in working/ai_agent_context.md.
- Add follow-up tasks to backlog when scope expands.

## Current Status

- Deterministic backend APIs, orchestration, memory adapters, observability, and local runtime scripts are in place.
- The web UI is live at `http://localhost:3000/ui/` with dark mode, Enter-to-send text input, and interrupt support.
- Voice capture, STT, TTS, and push-to-talk remain pending backlog items.
