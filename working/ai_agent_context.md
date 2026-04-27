# AI Agent Context

## Purpose

This document captures durable architecture and implementation context for FamilyAssistant. It is the persistent source for system decisions, constraints, and contracts.

## System Intent

FamilyAssistant is a local-first household assistant that manages events, schedules, and memory. The LLM interprets user intent, while deterministic backend APIs execute all important actions.

## Non-Negotiable Constraints

- No mandatory cloud dependency for core operation.
- LLM output is never authoritative state.
- State-changing actions must execute through deterministic APIs.
- Inputs to APIs and tools must be explicitly validated.
- Prefer transparent behavior and debuggable logs.

## High-Level Architecture

- Interface Layer
  - Local client surfaces (web UI on local network, CLI, or integrations).
  - Sends user requests to orchestration layer.

- Orchestration Layer
  - Accepts user input and context.
  - Calls local LLM (Ollama) for intent parsing and tool selection.
  - Validates and dispatches tool calls to deterministic backend APIs.
  - Supports interruption-first flow: cancel/replan when user guidance arrives mid-process.
  - Returns execution results to the user and to memory pipelines.

- Deterministic Backend Layer (Node.js)
  - Domain services for events, schedules, users.
  - Validation boundary with explicit schemas.
  - Persistence adapters and audit logs.

- Memory Layer
  - Structured memory (SQL): canonical entities and transactional state.
  - Semantic memory (vector DB): preferences, summaries, contextual retrieval.

## Data Ownership Rules

- Structured memory is source of truth for:
  - Users
  - Events
  - Schedules

- Semantic memory stores:
  - User preferences
  - Conversation summaries
  - Context embeddings for retrieval

Semantic memory can inform responses but must not directly mutate canonical state without deterministic API execution.

## Initial Components (Planned)

- API server (Node.js)
  - Health/readiness endpoints
  - Event CRUD service
  - Schedule CRUD service
  - User service

- LLM adapter
  - Ollama client wrapper with timeout/retry policy
  - Model configuration and timeout controls

- Tool execution framework
  - Tool registry with strict schemas
  - Result envelopes with success/error metadata

- Storage adapters
  - SQL adapter (SQLite-first, PostgreSQL-compatible)
  - Vector adapter (Qdrant/Chroma abstraction)

- Observability
  - Structured logs with correlation IDs
  - Audit trail for state-changing actions

## Implemented Backend Baseline

- API endpoints implemented:
  - `GET /healthz`
  - `GET /readyz` (checks PostgreSQL and Ollama)
  - `GET/POST/PATCH/DELETE /events`
  - `GET/POST/PATCH/DELETE /schedules`
- Database migration runner implemented in API startup path using deterministic, append-only migration list.
- Initial SQL tables implemented:
  - `users`
  - `events`
  - `schedules`
  - `audit_log`
  - `schema_migrations`
- Audit logging module implemented for state-changing operations (create/update/delete).
- Ollama client wrapper implemented with:
  - Config-driven timeout (`OLLAMA_TIMEOUT_MS`)
  - Config-driven retry policy (`OLLAMA_MAX_RETRIES`, `OLLAMA_RETRY_DELAY_MS`)
  - Selected local model configuration (`OLLAMA_MODEL`)
  - Configurable planner/system prompt override (`ORCHESTRATION_SYSTEM_PROMPT`)
  - Configurable AI memory context for household identity and preferences (`ORCHESTRATION_MEMORY_CONTEXT`)
  - Health checks that validate service reachability and report missing selected model as warning.
- Tool registry implemented with deterministic allowlist and per-tool Zod argument validation.
- Tool execution API implemented:
  - `GET /tools` returns registered tool names and descriptions.
  - `POST /tools/execute` validates tool call envelope and executes allowlisted tools only.
- Orchestration API implemented:
  - `POST /orchestrate` for interruption-aware intent-to-tool planning and execution.
  - `POST /orchestrate/cancel` for cancellation signaling.
- Orchestration safeguards implemented:
  - Strict planner decision envelope parsing (`response` vs `tool_call`).
  - Bounded step loop to avoid unbounded autonomous execution.
  - Tool request/arg validation and explicit failure envelopes.
  - Unknown/non-allowlisted tool rejection.
- Structured memory adapters implemented:
  - Common `StructuredMemoryAdapter` interface
  - PostgreSQL implementation for users/events/schedules operations
  - SQLite compatibility stub and backend selector
- Semantic memory adapters implemented:
  - Common `SemanticMemoryAdapter` interface
  - Qdrant adapter implementation for persistent vector storage
  - Chroma compatibility stub
  - In-memory semantic adapter for local development/testing
- Semantic ingestion contract defined for conversation summaries and extracted preferences.
- Memory tools exposed to orchestration:
  - Structured KVP memory tools: `memory.kv.save`, `memory.kv.load`, `memory.kv.search`
  - Structured KVP delete tool: `memory.kv.delete`
  - Semantic vector memory tools: `memory.semantic.save`, `memory.semantic.search`, `memory.semantic.delete`
  - KVP storage persisted in PostgreSQL table `memory_kv`
  - Semantic search uses deterministic local embeddings through the configured semantic adapter
  - Retrieval policy recalls relevant KVP and semantic memory before planner inference for memory/schedule/preference turns
- Structured request observability implemented:
  - Global correlation ID middleware (`x-correlation-id`) with response echo
  - pino-http request logging bound to correlation ID
  - Route-level state-changing operations consume the centralized request correlation ID
- Deterministic replay implemented:
  - Append-only NDJSON replay log (`REPLAY_LOG_PATH`)
  - Replay records for critical assistant actions (tool execution, orchestration, cancel)
  - Config-controlled replay enable/disable (`REPLAY_LOG_ENABLED`)
- Basic metrics implemented:
  - `GET /metrics` (JSON snapshot for local dashboards)
  - `GET /metrics/prometheus` (Prometheus-compatible text export)
  - Request counters, error counters, per-route latency aggregates, process uptime/memory
- Web UI scaffold implemented:
  - Static frontend served by API at `/ui` (same service boundary)
  - Root route redirects to `/ui`
  - Text-first chat interface calling `/orchestrate` and displaying transcript
  - Interrupt button path calls orchestration with `isInterrupt=true`
  - Dark-mode visual treatment implemented for the text-first UI
  - Enter submits the current message; Shift+Enter inserts a newline
  - Initial system greeting updated to a user-facing welcome message
  - KVP memory manager panel for save/search/delete operations
- Root-level runtime entrypoint implemented:
  - `./start.sh` prepares Node, starts dependency containers, ensures/warms the Ollama model, verifies GPU-backed execution when enabled, starts or reuses the local API, runs startup smoke tests, and opens `/ui`
  - Detached mode is supported with `FA_DETACH=1`
  - Browser launch can be suppressed with `FA_OPEN_BROWSER=0`
- Root-level shutdown entrypoint implemented:
  - `./stop.sh` stops the API started by `./start.sh` using the tracked PID file and stops backend dependency containers by default
  - Container shutdown can be skipped with `FA_STOP_DEPS=0`

## Local Runtime and Deployment Baseline

- Compose topology is shared across Podman and Docker.
- Runtime selection is Podman-first with Docker fallback.
- Optional Ollama GPU passthrough overlay is enabled via `.env` (`OLLAMA_GPU_ENABLED=true`) and uses Podman CDI device injection (`OLLAMA_GPU_DEVICE=nvidia.com/gpu=all`) on NVIDIA hosts.
- Persistent semantic memory defaults to Qdrant via `.env` (`SEMANTIC_MEMORY_BACKEND=qdrant`, `QDRANT_URL`, `QDRANT_COLLECTION`).
- Services in compose baseline:
  - api
  - ui
  - ollama
  - postgres
- Podman-only pod optimizations are optional and must not change functional behavior compared to Docker.
- Service communication uses internal service DNS names on an explicit internal network.

## API and Tooling Design Rules

- Every endpoint/tool has:
  - Input schema
  - Output schema
  - Deterministic error contract

- Tool calls must be:
  - Explicitly named
  - Versionable
  - Validated before execution

- Responses to LLM should include:
  - Status
  - Machine-readable payload
  - Human-readable summary
  - Optional debug metadata

## Security and Safety Baseline

- Default local-only network binding unless explicitly configured.
- Reject unknown tool names and malformed payloads.
- Log all state-changing requests with actor and timestamp.
- Apply allowlist approach for tool execution.

## Assumptions (Initial)

- Single household deployment initially.
- Single-node runtime for first milestone.
- Local trusted network environment.
- Authentication model to be introduced before multi-user remote access.

## Open Decisions

- Choose vector store default: Qdrant vs Chroma.
- Choose SQL default for first production-like profile: SQLite vs PostgreSQL.
- Select first client interface: CLI, web UI, or messaging connector.

## Change Log

- 2026-04-25: Initial architecture context created during project bootstrap.
- 2026-04-25: Added container runtime baseline (Podman-first, Docker fallback) with one shared compose topology.
- 2026-04-25: Added interruption-first orchestration requirement with cancellation/replan behavior.
- 2026-04-25: Implemented deterministic CRUD APIs for events and schedules with schema validation.
- 2026-04-25: Added migration runner and audit log persistence for state-changing actions.
- 2026-04-25: Implemented robust Ollama client wrapper with retries, timeouts, and local model selection checks.
- 2026-04-25: Implemented deterministic tool registry and execution endpoint with strict request/arg validation.
- 2026-04-25: Implemented interruption-aware orchestration endpoint with explicit planner envelopes and cancellation path.
- 2026-04-25: Added tool guardrails for allowlist enforcement and deterministic error envelopes.
- 2026-04-25: Implemented structured memory adapter abstraction with PostgreSQL implementation and SQLite compatibility stub.
- 2026-04-25: Implemented semantic memory adapter abstraction (Qdrant/Chroma stubs + in-memory fallback) and ingestion contract schemas.
- 2026-04-25: Added structured request logging and centralized correlation ID propagation across API routes.
- 2026-04-25: Added deterministic replay NDJSON logging for critical assistant actions.
- 2026-04-25: Added local metrics endpoints with JSON and Prometheus output formats.
- 2026-04-25: Added local-network web UI scaffold served from API boundary at `/ui`.
- 2026-04-25: Added configurable orchestration system prompt and optional Podman CDI GPU passthrough for the Ollama container.
- 2026-04-25: Moved household-specific identity details out of hardcoded system prompt into configurable AI memory context (`ORCHESTRATION_MEMORY_CONTEXT`) while keeping family-friendly and child-safe behavior in base instructions.
- 2026-04-25: Added `start.sh` as the primary local runtime entrypoint with dependency startup, model warmup, GPU verification, API smoke tests, and browser launch.
- 2026-04-25: Added `stop.sh` as the matching local shutdown entrypoint for the API and dependency containers.
- 2026-04-25: Refined the text-first web UI with dark mode, Enter-to-send, and a more natural welcome message.
- 2026-04-26: Added deterministic memory tool access for save/load/search across KVP and semantic memory stores.
- 2026-04-26: Added memory delete tools, pre-planner memory retrieval policy, persistent Qdrant vector backend defaults, and UI KVP memory manager controls.
