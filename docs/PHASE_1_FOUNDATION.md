# BRITTO'S FORGEHSE — Phase 1 Foundation

**Parent brand:** BRITTO'S AI FORGE  
**Product:** BRITTO'S FORGEHSE — AI-Powered HSE Intelligence Platform  
**Tagline:** *Engineered for Safety. Powered by Intelligence.*

## Scope and preservation

Phase 1 preserves the existing TypeScript monorepo and application routes. It does not replace the web app, add a frontend framework, or claim that planned HSE modules are fully implemented.

- `apps/web`: React 19 workspace and public site, built with esbuild.
- `apps/api`: Node 22 HTTP API, PostgreSQL persistence, migrations, authentication, RBAC, audit trail, HSE observations, AI Studio and exports.
- `apps/mobile`: Expo / React Native Android field app and offline observation queue.
- `packages/shared`: shared Zod validation, permissions, risk calculations, KPI formulas and domain contracts.
- `apps/api/migrations`: ordered, checksum-verified SQL migrations.

## Foundation added in Phase 1

- `packages/shared/src/hse-domain.ts`: shared domain names, statuses, typed record/event/link contracts, create validation, and a common lifecycle-transition guard.
- `apps/api/migrations/0006_hse_domain_foundation.up.sql`: tenant-scoped generic record envelope plus event history, revisions and cross-record links.
- `apps/api/migrations/0006_hse_domain_foundation.down.sql`: explicit rollback for the additive migration.
- `docs/PHASE_1_FOUNDATION.md`: architecture map, lifecycle principles, configuration and readiness checklist.

The generic record envelope is an integration foundation, not a substitute for domain-specific validation. Each module phase must add its own detailed Zod schema, server-side authorization, domain-specific state transitions, normalized tables where justified, API routes, UI, tests and audit events. Do not treat the JSON payload as trusted input.

## Domain boundaries

| Domain | Initial contract | Feature implementation required in later phases |
|---|---|---|
| Projects and sites | Existing relational tables | Site lifecycle, project portfolio workflows |
| Users, roles, permissions | Existing users, role assignments and RBAC matrix | Permission additions must be tested and enforced server-side |
| HSE documents | `document` record domain | Controlled templates, review/approval, revision and transmittal workflow |
| Hazards and risk assessments | `risk_assessment` domain; existing observations remain intact | Hazard library, matrix-bound calculations, risk acceptance and review |
| Permits to Work | `permit` domain | Permit-specific checks, isolations, gas tests, approvals, suspension and closure |
| Inspections and audits | `inspection`, `audit` domains | Templates, findings, schedules, evidence and action links |
| Incidents and investigations | `incident` domain | Classification, investigation, root cause, lessons learned and restricted access |
| Corrective actions and HSE gaps | `corrective_action` domain and cross-record links | Ownership, deadlines, evidence, independent verification and escalation |
| Training and competency | `training` domain | Matrices, attendance, assessments, expiry notifications |
| Contractors and workforce | `contractor`, `workforce` domains | Onboarding, competency and project assignments |
| Environmental monitoring | `environmental` domain | Measurements, thresholds, units, events and environmental reporting |
| Emergency preparedness | `emergency` domain | Plans, drills, contacts, muster checks and lessons learned |
| Man-hours | `man_hours` domain | Revision-safe aggregation and KPI calculations |
| Reporting and document control | Common metadata, revisions and links | Domain-aware reporting, retention, exports and approval records |

## Lifecycle and data rules

- Every record belongs to one organisation and project; a site is optional but, when present, must belong to that same project and organisation.
- Stable UUIDs identify records; human-readable references are unique within an organisation.
- Every record has a version for optimistic concurrency, creator/owner metadata, timestamps and a JSON object payload validated by the domain schema.
- Status changes must be validated in the service layer. The shared transition helper is a conservative baseline; domain workflows must impose stricter rules where needed.
- Submitted/active/closed states require a submission timestamp; closed records require a closure timestamp.
- Events are append-only by application convention; do not update past events to rewrite history. Revisions preserve snapshots before consequential edits.
- Links must stay within one organisation and may connect source records to corrective actions, evidence, permits, inspections or investigations.
- All reads and writes must be authorized server-side and scoped to the authenticated organisation and permitted project/site. Client-provided IDs are not authorization.
- Incident and occupational-health records require additional data minimization and role restrictions before their feature modules are enabled.
- AI outputs remain drafts. AI must not approve permits, certify compliance or close records automatically.

## Configuration

The application uses environment variables. Never commit `.env` files containing credentials.

- `.env.example`: general deployment reference; review its production-oriented defaults before using.
- `.env.development.example`: local development defaults; set a local database URL.
- `.env.test.example`: isolated test database configuration. The API test suite may drop/recreate the test schema; use only a dedicated disposable database.
- Production must use HTTPS and `COOKIE_SECURE=true`.
- `ANTHROPIC_API_KEY` is optional and server-side only. Without it, real AI is not available. The local mock is test-only and must never be enabled in production.
- PostgreSQL 14+ is documented; confirm compatibility against your actual hosting environment before production rollout.

## Development readiness checklist

### Prerequisites
- Node.js 22+
- npm workspaces
- PostgreSQL 14+ and a dedicated development database
- For API integration tests, a separate disposable test database
- No paid service is required to build the base application; live Anthropic calls require an external API key and may incur charges, so they are optional.

### Local startup
1. `cp .env.development.example .env` and edit `DATABASE_URL` to point to your local development database.
2. `npm install` (if dependency registry access is unavailable, follow the repository's offline dependency instructions).
3. `npm run migrate`
4. `npm run seed -- --demo` (development only; demo credentials are not production credentials).
5. `npm run build`
6. Start API: `npm run dev:api`
7. In another terminal, start web: `npm run dev:web`
8. Web/API ports and CORS settings should match local environment configuration.

### Validation commands
- Shared tests: `npm run test -w @forgehse/shared`
- Web tests: `npm run test -w @forgehse/web`
- API tests: `npm run test -w @forgehse/api` (requires test DB)
- Mobile offline queue tests: `npx tsx --test apps/mobile/src/offline/*.test.ts`
- Type checks: `npm run typecheck`
- Production build: `npm run build`
- Browser E2E: start API with demo seed, then `BASE_URL=http://127.0.0.1:4000 npm run e2e`

### Migration and rollback
- Apply additive migrations with `npm run migrate`.
- Review migration SQL and back up the database before production migration.
- The migration runner's `npm run migrate:down` reverts the latest migration only. Confirm which migration is latest before using it; do not run down casually against shared or production data.
- Phase 1 migration adds new tables only; it does not alter or delete existing application tables. Do not apply it to production without a tested backup/restore plan.

## Verification status

The GitHub connector can write repository files but does not execute Node, PostgreSQL, browser or Android test commands. Therefore this phase's source changes are committed on the isolated development branch, but builds, migration execution and tests must be run in a real checkout/CI before declaring acceptance. Do not infer a passing build from source inspection.
