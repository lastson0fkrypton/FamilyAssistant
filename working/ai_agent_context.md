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
  - Event service
  - Schedule service
  - User service

- LLM adapter
  - Ollama client
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
