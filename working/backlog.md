# Backlog

Status legend:

- [ ] TODO
- [~] IN PROGRESS
- [x] DONE

## Foundation

- [x] Initialize Node.js backend project structure under src/ with minimal dependencies.
- [x] Create container runtime bootstrap scripts that prefer Podman and fall back to Docker when Podman is unavailable.
- [x] Add one shared compose topology for self-contained local services (api, ui, ollama, postgres) that runs on both Podman and Docker.
- [x] Add dependency configuration scripts for Ollama and PostgreSQL using environment-defined ports and database settings.
- [x] Add configuration loading module with strict environment variable validation (including containerized Ollama and PostgreSQL connection settings).
- [x] Define shared schema package for API contracts (Zod-based) and tool-calling payloads.

### Foundation Checklist: Container Bootstrap and Service Layout

- [x] Create runtime detection script that selects Podman first, Docker second, and exits with clear guidance if neither is installed.
- [x] Create compose wrapper scripts for up, down, logs, and ps commands so developers use one consistent entrypoint regardless of runtime.
- [x] Add base compose file defining services: api, ui, ollama, postgres.
- [x] Add environment template for compose variables (ports, model name, DB credentials, volume paths).
- [x] Add persistent volumes for ollama model cache and postgres data.
- [x] Add explicit internal network and service DNS names for backend-to-dependency communication.
- [x] Add healthchecks for ollama and postgres, then gate api startup on dependency readiness.
- [x] Define image and service naming conventions (for example familyassistant-api, familyassistant-ui, familyassistant-ollama, familyassistant-postgres).
- [x] Add developer documentation for runtime differences between Podman and Docker and how fallback behavior works.

## Frontend Voice Interaction (Web UI)

- [ ] Scaffold a local-network web interface for voice interaction, served from the same Node.js pod/service boundary as the API.
- [ ] Implement configurable push-to-talk keypress handling in the web interface to start listening.
- [ ] Implement listening-start notification sound playback (ding) on microphone capture start.
- [ ] Implement browser microphone capture with voice activity/silence detection and hard timeout fallback.
- [ ] Implement speech-to-text pipeline to convert captured audio into text prompts for LLM input.
- [ ] Implement text-to-speech response playback using Piper for assistant responses.
- [ ] Implement LLM interruption control that halts in-flight processing when new user speech is detected.
- [ ] Implement guidance prompt chaining so interruption speech is appended as supporting context before resuming generation.
- [ ] Integrate web frontend requests with deterministic backend tools for scheduling, recall, and event creation actions.
- [ ] Implement session lifecycle behavior: after affirmative action and conversation completion/timeout, stop listening and return to idle sleep state until next keypress.

## Deterministic Core APIs

- [x] Implement health and readiness endpoints with dependency checks.
- [x] Design and implement event CRUD API with schema validation and deterministic behavior.
- [x] Design and implement schedule CRUD API with schema validation and deterministic behavior.
- [x] Add audit logging module for all state-changing operations.

## Memory Layer

- [ ] Implement structured memory adapter interface (SQLite-first, PostgreSQL-compatible).
- [ ] Create initial structured data model migrations for users, events, and schedules.
- [ ] Implement semantic memory adapter interface for Qdrant/Chroma compatibility.
- [ ] Define semantic memory ingestion contract for conversation summaries and preferences.

## AI Orchestration

- [x] Implement Ollama client wrapper with timeout, retry policy, and local model selection.
- [x] Create tool registry that exposes deterministic backend actions to the LLM.
- [x] Implement interruption-first intent-to-tool orchestration flow with explicit result envelopes and cancellation/replan support.
- [x] Add guardrails to reject unsafe or non-deterministic tool requests.

## Observability and Debuggability

- [ ] Add structured logging format and request correlation IDs.
- [ ] Add deterministic replay format for critical assistant actions.
- [ ] Implement basic metrics endpoint for local monitoring.

## Quality and Developer Experience

- [ ] Add baseline unit test setup and first tests for schema validation modules.
- [ ] Add lint and formatting configuration with scripts.
- [ ] Add Makefile or npm scripts for common local workflows.
- [ ] Expand README with concrete setup, run, and test instructions after scaffolding.
