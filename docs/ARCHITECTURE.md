# FORGEHSE architecture (v0.1)

## 1. Overview

```
 Android app (Expo)  ─┐   Bearer token (Keystore)
                      ├──►  FORGEHSE API (Node 22, node:http) ──► PostgreSQL 16
 Web app (React 19) ──┘   HttpOnly cookie + CSRF header      │      (tenancy via org-scoped keys)
                                                              ├──► Object storage (local disk; S3 interface)
                                                              └──► Claude API (server-side only)
```

One authenticated backend and one data model serve both clients. The API also serves the built web app, so a single container can run the whole system.

### Why this stack

- **TypeScript end to end.** The same Zod schemas, RBAC matrix and risk calculation run on server, web and mobile, so client and server validation cannot drift.
- **PostgreSQL.** It gives transactional workflows, composite foreign keys for tenant integrity, an append-only audit trigger, and gap-free numbering with row locks.
- **Minimal dependencies.** The first build environment had no package-registry access. The HTTP layer (`apps/api/src/http/core.ts`) and the PostgreSQL client (`apps/api/src/db/pgwire.ts`) are small and dependency-free. The rest of the code talks to them only through the `Db` interface and the `Router`. **Before production, replace `pgwire.ts` with `pg` (node-postgres).** It is a one-file change behind `db.ts`.

## 2. Multi-tenancy and access control

- Every business row carries `organization_id`. Composite foreign keys such as `(site_id, project_id, organization_id) → sites` make it impossible, at the database level, to attach a record to another tenant's project or site.
- A **session** is bound to one organisation. Organisation, project and site IDs sent by the client are never trusted. Every query adds the session's organisation, plus a scope filter built from the user's role assignments (`scopeFilter()` in `auth/session.ts`).
- **Role assignments** are `(user, organisation, role, project?, site?)`. The matrix is in `packages/shared/src/permissions.ts`:

| Role | Scope | Notable permissions |
|---|---|---|
| Super Administrator | org | everything; only role that can grant super admin |
| Organization Administrator | org | projects, sites, users, audit, AI usage; **not** HSE actions |
| Corporate HSE Manager | org | full observation workflow, export, audit, AI usage |
| Project HSE Manager | project | full observation workflow, export, audit |
| HSE Engineer | project/site | create, edit, assign, verify, export |
| HSE Officer | project/site | create, edit, assign, submit action, export |
| Project Manager | project/site | create, assign, submit action, export |
| Site Engineer / Supervisor | project/site | create, submit action on assigned items |
| Authorized Viewer / Client Rep | project/site | view and export only |

- Out-of-scope records return **404**, not 403, so a record's existence is never revealed.
- **Segregation of duties.** The person who submitted a corrective action cannot verify it. This is an org setting (`segregateVerification`), on by default.
- **Audit.** `audit_log` is append-only, enforced by a trigger that blocks UPDATE, DELETE and TRUNCATE. It records logins and failures, every observation transition, edits as field diffs, permission changes, project and site changes, and exports.

## 3. Data model (migrations in `apps/api/migrations`)

| Table | Purpose |
|---|---|
| organizations | tenant; `settings` JSON (timezone, risk matrix, hazard categories, segregation) |
| users | identity; scrypt password hash; lockout counters |
| projects, sites | tenancy hierarchy; codes unique per org / per project |
| role_assignments | RBAC grants with optional project/site scope |
| sessions | SHA-256 of bearer token (raw token never stored), client, expiry, revocation |
| audit_log | append-only trail |
| number_sequences | gap-free reference numbers per org/scope/year |
| observations | the HSE record; `client_ref` idempotency key; `version` for optimistic locking |
| observation_events | status history and comments |
| attachments | evidence metadata; bytes in object storage under server-generated keys |
| ai_usage | token counts, cache status, latency, cost estimates; **no prompt or response text** |

Reference numbers follow `OBS-<PROJECT>-<YYYY>-<00001>` and are allocated inside the creating transaction.

## 4. Observation workflow

```
open ──assign──► assigned ──submit_action──► action_submitted ──verify_close──► closed
  │                 ▲                              │                              │
  │                 └────────reject_action─────────┘                              │
  ├──verify_close (only with an immediate action recorded) ──► closed             │
  └──cancel──► cancelled          assigned ──cancel──► cancelled     closed ──reopen──► open
```

Rules live in `packages/shared/src/observation.ts` and are enforced in `apps/api/src/services/observations.ts`. Further checks: the assignee must hold `observation.action` on the record's project and site; due dates cannot be in the past; every transition requires the current `version`.

### Risk matrix

Score = likelihood × severity on the organisation's matrix (default 5×5). The default bands are Low 1–4, Medium 5–9, High 10–14 and Critical 15–25. These are a **default organisational convention, not a statutory requirement**, and are configurable per organisation. The calculation lives in `packages/shared/src/risk.ts` and is unit-tested.

### KPI formulas (`packages/shared/src/kpi.ts`)

- Frequency rate = cases × base ÷ man-hours. The base is configurable: 1,000,000 hours, or 200,000 for OSHA-style rates. It returns *undefined* rather than 0 when no hours are recorded.
- On-time closure = items closed on or before their due date ÷ closed items that had a due date.
- Man-hours are summed with one record per site, date and employer. Corrections replace earlier revisions, so nothing is double counted. The man-hours module itself is not built yet; the formula is ready and tested.
- Dashboard figures come only from live records in the caller's scope. Modules that aren't built yet are reported as unavailable, never as zero.

## 5. Claude assistant and prompt caching

- All Claude calls are made by `apps/api/src/ai/claude.ts`. The API key exists only in server environment variables, and no client ever calls Anthropic.
- **Prompt layout, stable to dynamic:**
  1. `STABLE_SYSTEM_PROMPT` (`ai/prompts.ts`): role, boundaries, HSE reference knowledge, response schemas. It is identical for every tenant and request, carries one `cache_control: {type: "ephemeral"}` breakpoint, and adds `ttl: "1h"` only when `CLAUDE_CACHE_TTL=1h`.
  2. A dynamic user message: organisation and project context, the org's hazard categories and matrix, records retrieved **after authorisation**, and the user's input. This part is never marked for caching.
- **Tenant isolation.** The cached prefix contains no tenant data, which a test asserts, so sharing it across tenants exposes nothing. Records reach the model only after the same scope checks the UI uses, which a test confirms with two organisations.
- **Thresholds.** `cache_control` is attached only when the estimated prefix size meets the model's configured `minCacheableTokens`. Unknown models fall back to a conservative 4,096. Below the threshold the request is recorded as `not_requested`.
- **Measurement.** `input_tokens`, `cache_creation_input_tokens` (including the 5m/1h split when present), `cache_read_input_tokens` and `output_tokens` are taken from each API response. Cache status is derived from those fields, never assumed. Costs are estimated from `config/ai-pricing*.json` and labelled as estimates. The admin dashboard shows hit rate, cached share of input, latency with and without hits, and estimated savings against the same calls uncached.
- **Safety.** Outputs are drafts. Draft observations are validated against a schema, clamped to the matrix, and never saved automatically. CAPA suggestions are not written to the record. Upstream error bodies are never forwarded to clients.

## 6. Android offline design

- The session token is stored in the Android Keystore via `expo-secure-store`. There are no API secrets in the app.
- Stored offline: the user's project and site list plus reference data (hazard categories, risk matrix), and **queued drafts** with their photos. Observation lists and details are **not** cached, because they need a live connection and a live permission check.
- Each draft gets a UUID `clientRef`, which the API uses as an idempotency key. Retries after a lost response return the original record (HTTP 200, `duplicate: true`).
- Progress is saved per step: observation created, then each photo uploaded. A crash or restart resumes without re-creating the observation.
- Permanent errors (400/403/404/409) stop retries and are shown to the user with *Try again* and *Discard*. Transient errors back off exponentially (5 s, capped at 15 min). Connectivity returning triggers an immediate sync.
- Status changes (assign, verify, close) are never queued offline. Submitting an action requires a connection.

## 7. API reference (all under `/api`)

| Method | Path | Permission |
|---|---|---|
| GET | /health, /ready | public (no secrets disclosed) |
| POST | /auth/login `{email,password,client:'web'|'mobile',organizationId?}` | public, rate-limited, lockout after 5 failures |
| POST | /auth/logout, /auth/password, /auth/switch-organization | signed in |
| GET | /auth/me | signed in |
| GET | /projects, /projects/:id/assignees?siteId= | signed in / observation.assign |
| GET | /observations?projectId&siteId&status&type&assignedToMe&likelihood&severity&q&from&to&page&pageSize | observation.view (scoped) |
| GET | /observations/meta | signed in |
| POST | /observations | observation.create on project+site |
| GET/PATCH | /observations/:id | view / reporter or observation.edit |
| POST | /observations/:id/transitions `{transition, version, …}` | per transition rule |
| POST | /observations/:id/attachments?filename&purpose (raw body) | create or assignee |
| GET | /attachments/:id | view (scoped) |
| GET | /observations/export?format=pdf|xlsx|csv&filters | report.export (scoped), audited |
| GET | /dashboard?projectId&siteId&from&to | dashboard.view (scoped) |
| GET | /audit?entityType&entityId&page | audit.view (org-wide) |
| POST | /ai/assist `{task, input, projectId?, observationId?}` | ai.use (scoped), rate-limited |
| GET | /ai/status, /ai/usage?days | signed in / ai.usage.view |
| GET/POST/PATCH | /admin/projects, /admin/sites, /admin/users | project.manage / user.manage (org-wide) |

Errors have the shape `{ "error": { "code", "message", "details?" } }`. Validation errors list each field and its message.

## 8. Security controls

- Passwords use scrypt (N=2^15, r=8), with rehash on login if parameters change, a policy of at least 12 characters including a letter and a digit, a forced change on first login, and lockout after 5 failures.
- Web sessions use an HttpOnly, SameSite=Strict cookie, Secure in production, and every state-changing request must carry the `X-Requested-With: forgehse` header. Mobile uses a bearer token. Sessions expire after 12 h on web and 14 days on mobile (configurable). Password change and deactivation revoke sessions.
- Headers: CSP on the web app (`script-src 'self'`, no third-party origins), `default-src 'none'` on API responses, nosniff, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, and HSTS when secure.
- CORS uses an allow-list. Rate limits apply per IP, per login email and per AI user. They are in-memory, so multi-instance deployments need a shared store.
- Uploads are capped at 15 MB. The type is decided by magic bytes, never the client's claim; HTML disguised as PNG is rejected. Storage keys are generated by the server. Downloads are scoped and served with a `sandbox` CSP.
- Exports neutralise spreadsheet formula injection.
- All SQL uses bound parameters. Statements time out after 15 s.

## v0.2: AI Studio

```
Browser ──POST /api/ai/chat (SSE)──▶ chat route ──▶ ClaudeService.stream ──▶ Anthropic Messages API
   ▲            meta · delta · tool · action · done        │  tools: search_observations, hse_statistics
   │                                                       │         (run server-side with the caller's scope)
   │                                                       └─ create_studio_draft / prepare_observation → action events only
   └──POST /api/studio/generate ──▶ studio route ──▶ ClaudeService.send (forced tool emit_<kind>, schema from zod)
                                              └─ validate → studio_items (draft) → review (studio.review) → export DOCX/PDF/SVG
```

- **Prompt order for caching:** tools → stable system prefix (cache breakpoint) → dynamic context block (organisation, project, matrix, today; never cached) → messages. In multi-turn chats a second breakpoint on the last earlier turn lets the history be reused.
- **Structured outputs:** one zod schema per Studio kind in `packages/shared/src/studio.ts` is converted to JSON Schema for the tool, then the reply is parsed again on the server. Renderers in `render.ts` are pure functions shared by browser and server; every string is XML-escaped, and the browser shows SVG only through `<img src="data:…">`.
- **Data handling:** conversations (`ai_conversations`, `ai_messages`) are private to their user; Studio items are visible to their creator, to users with `ai.use` in the item's project, and (for org-level items) to users with `ai.use` anywhere in the organisation. Usage telemetry still stores token counts only.
- **Voice** never reaches the server as audio: dictation happens in the browser and only the resulting text is sent.
