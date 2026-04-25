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

## Local Runtime and Deployment Baseline

- Compose topology is shared across Podman and Docker.
- Runtime selection is Podman-first with Docker fallback.
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
