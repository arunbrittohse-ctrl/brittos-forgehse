# Development readiness checklist — BRITTO'S FORGEHSE

Everything here uses free, open-source tools. No paid service, API key or subscription is required to build, run or test the platform.

## 1. Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Node.js | 22 or later | npm workspaces |
| PostgreSQL | 14 or later (tested on 16) | local install or Docker |
| Chromium | Playwright 1.x | browser end-to-end tests only |

## 2. Configuration profiles

| Profile | Example file | Key settings |
|---|---|---|
| Development | `config/env/development.env.example` | `COOKIE_SECURE=false`, `AI_PROVIDER=local`, `LOG_LEVEL=debug` |
| Test | `config/env/test.env.example` | `TEST_DATABASE_URL` must point at a **disposable** database |
| Production | `config/env/production.env.example` | HTTPS only (`COOKIE_SECURE=true` is enforced), secrets from the host's secret store |
| Full reference | `.env.example` | every variable, with comments |

Copy a profile to `.env.development` (git-ignored) and load it with `set -a; . ./.env.development; set +a`. Never commit real values.

### Required environment variables

- `DATABASE_URL`: always required.
- `COOKIE_SECURE=true`: required in production.
- Optional:
  - AI: `AI_PROVIDER` (`auto`, `local`, `openai_compatible`, `anthropic` or `off`), `LOCAL_AI_BASE_URL`, `LOCAL_AI_MODEL`, `ANTHROPIC_API_KEY`.
  - Storage: `STORAGE_DRIVER`, `STORAGE_DIR`.
  - Network: `CORS_ORIGINS`.
  - Sessions: `SESSION_TTL_HOURS_WEB`, `SESSION_TTL_HOURS_MOBILE`.
  - Limits: `MAX_UPLOAD_MB`, `DB_POOL_MAX`.
  - Serving: `WEB_DIST_DIR`, `MIGRATIONS_DIR`.
  - First administrator: `SEED_*`.

### AI without cost

| `AI_PROVIDER` | What answers | Cost |
|---|---|---|
| `local` (the default when no key is set) | FORGEHSE rules engine: curated guidance library plus your live records. Deterministic, labelled "no AI model" | Free |
| `openai_compatible` | A self-hosted open model, e.g. Ollama at `http://127.0.0.1:11434/v1` | Free if self-hosted |
| `anthropic` | Claude | Paid, optional |
| `off` | AI features disabled; everything else works | — |

## 3. Local start-up

```bash
npm install
createdb forgehse_dev
set -a; . ./.env.development; set +a
npm run migrate                      # applies apps/api/migrations in order (checksummed)
npm run seed -- --demo               # DEMO org, users and observations (refused in production)
npm run build -w @forgehse/web
npm run dev:api                      # http://localhost:4000
```

Demo sign-ins are listed in README.md (local demo data only, clearly labelled DEMO).

## 4. Migrations

| Command | Effect |
|---|---|
| `npm run migrate` | Apply pending migrations; each file runs atomically |
| `npm run migrate -- down` | Undo the most recent migration. **Drops that migration's tables and data.** Use a backup restore instead in production |

A migration that is edited after being applied is refused (sha256 checksum). Current set:

| Migration | Contents |
|---|---|
| 0001 | Core: organisations, users, projects, sites, roles, sessions, audit log, numbering |
| 0002 | Observations |
| 0003 | AI usage |
| 0004 | Studio and chat |
| 0005 | `object_store` |
| 0006 | HSE domain tables. Additive only: no existing table changed |

## 5. Build, type-check and tests

```bash
npm run typecheck                    # shared, API, web — strict, real type definitions
npm run build                        # API bundle (esbuild) + web bundle
npm test                             # shared + web unit + API integration (needs TEST_DATABASE_URL)
npx tsx --test apps/mobile/src/offline/*.test.ts
BASE_URL=http://127.0.0.1:4000 E2E_AI=1 npm run e2e    # needs a running, demo-seeded server
```

There is no linter configured in the repository yet; strict TypeScript is the static check.

## 6. Logging and errors

- One JSON log line per request: request id, method, path, status, latency and IP.
- Bodies, tokens, passwords and prompts are never logged.
- Unhandled errors return `{ "error": { "code", "message" } }` with a reference id. Stack traces and database or provider details never reach clients.

## 7. Architecture map for new modules

| Concern | Location |
|---|---|
| Domain registry: status of every module (`live`, `foundation`, `planned`) | `packages/shared/src/domains/registry.ts` |
| Lifecycles: states and transitions, plus closure rules (comment, evidence, independent verifier) | `packages/shared/src/domains/hse.ts` |
| Validated input schemas | `packages/shared/src/domains/hse.ts` |
| Lifecycle engine (`checkTransition`, `lifecycleProblems`) | `packages/shared/src/domains/lifecycle.ts` |
| Tables | `apps/api/migrations/0006_hse_domains.up.sql` |
| Shared history, revisions and evidence tables | `hse_record_events`, `record_revisions`, `hse_evidence` |

A module moves from `foundation` to `live` only when its API, screens, permissions and tests exist and pass.

---

## Development readiness checklist (from the parallel Phase 1 branch)

This checklist complements [Phase 1 Foundation](./PHASE_1_FOUNDATION.md).

## Before starting
- [ ] Node.js 22+ is installed.
- [ ] PostgreSQL is running and a development database exists.
- [ ] A separate disposable database exists for API integration tests.
- [ ] Local environment variables are copied from the relevant example and edited.
- [ ] No real secrets are committed.
- [ ] Current branch and working tree have been reviewed.

## Build and validation
- [ ] `npm install`
- [ ] `npm run migrate` against development database
- [ ] `npm run typecheck`
- [ ] `npm test` with `TEST_DATABASE_URL` set to the dedicated disposable database
- [ ] `npx tsx --test apps/mobile/src/offline/*.test.ts`
- [ ] `npm run build`
- [ ] `BASE_URL=http://127.0.0.1:4000 npm run e2e` after starting API and seeding demo data
- [ ] Review browser routes and mobile workflow manually.

## Safety checks
- [ ] Existing public and authenticated routes still load.
- [ ] Existing observation and AI Studio workflows remain functional.
- [ ] Tenant/project/site authorization is enforced server-side.
- [ ] Migration is additive and rollback is understood.
- [ ] Incident and occupational-health data are not exposed without specific permissions.
- [ ] AI-generated content remains a draft until human review.
- [ ] Build/test output and known failures are recorded accurately.

## Phase 1 exit
- [ ] Shared domain contracts are exported and typechecked.
- [ ] Migration 0006 applies cleanly on a fresh database and on a copy of the current schema.
- [ ] Rollback succeeds on a disposable database.
- [ ] Build and relevant regression tests pass in a real checkout or CI.
- [ ] Phase report documents any remaining limitations.
