# BRITTO'S FORGEHSE

**AI-Powered HSE Intelligence Platform**, a product of BRITTO'S AI FORGE.
*Engineered for Safety. Powered by Intelligence.*

FORGEHSE is a multi-tenant HSE management platform for construction and infrastructure organisations. It has a web workspace, an Android field app, a PostgreSQL-backed API and a server-side Claude assistant.

> **Status: v0.2 — verified in development, not production-ready.** v0.1 delivered authentication, tenancy and RBAC, audit, projects and sites, users, Observations end to end, the dashboard, registers, the AI assistant with prompt caching and the Android offline queue. **v0.2 adds AI Studio**: a streaming HSE co-pilot grounded in the user's own records (with citations), voice dictation, one-line generation of checklists, HSE documents (toolbox talks, method statements, risk assessments…), safety posters and flowcharts, AI review of uploaded documents, Word/PDF/SVG/PNG exports, a human review step for every AI draft, a ⌘K command palette, the brand-board palette with light/dark themes, a WebGL light field, 3D tilt, view transitions and optional interface sound. Incidents, permits, inspections, training, man-hours and the other modules are **not built yet**. See [docs/IMPLEMENTATION_REPORT.md](docs/IMPLEMENTATION_REPORT.md), [Phase 1 Foundation](docs/PHASE_1_FOUNDATION.md), and the [Development Readiness Checklist](docs/DEVELOPMENT_READINESS.md).

### AI Studio at a glance

| You do | FORGEHSE does |
|---|---|
| Ask a question (type or speak) | Streams an answer; for questions about your data it searches only records you can open and cites them, e.g. `[OBS-…]` |
| “Make a toolbox talk on heat stress for 40 steel fixers” | Generates a structured document on your risk matrix, with `[to be confirmed]` placeholders instead of invented facts |
| Pick *Checklist / Document / Poster / Flowchart* | Generates directly, previews on the right, exports Word, PDF, SVG or PNG |
| Attach a PDF or Word file | Returns a findings table against good HSE practice (not a legal compliance verdict) |
| Describe something you saw | Opens a pre-filled observation report for you to check and submit |

Every generated item is stored as a **draft**; exports say *AI-assisted draft — NOT reviewed* until a user with the `studio.review` permission (HSE engineer / manager) marks it reviewed. AI never approves permits, closes hazards or certifies compliance.

## Repository layout

```
packages/shared   Validation schemas, RBAC matrix, risk matrix, KPI formulas (used by API, web and mobile)
apps/api          Node 22 HTTP API, PostgreSQL, migrations, Claude service, tests
apps/web          React 19 web app (public site + workspace), esbuild, Playwright e2e
apps/mobile       Expo / React Native Android field app with offline queue
docs/             Architecture, deployment and the implementation report
config/           Pricing table template for AI cost estimates
scripts/          Backup / restore, offline-dependency helper
```

## Quick start (local development)

Requires Node 22+ and PostgreSQL 14+.

```bash
npm install                       # (air-gapped machine: ./scripts/link-offline-deps.sh)
createdb forgehse_dev
export DATABASE_URL=postgres://USER:PASS@127.0.0.1:5432/forgehse_dev
npm run migrate
npm run seed -- --demo            # DEMO org, users and observations (refused in production)
npm run build -w @forgehse/web
WEB_DIST_DIR=apps/web/dist npm run dev:api     # http://localhost:4000
```

Demo sign-ins (local only): `hse.engineer@demo.forgehse.local`, `supervisor@demo.forgehse.local`, `corp.hse@demo.forgehse.local` and `client.rep@demo.forgehse.local`, all with password `DemoUser2026!`. The admin is `admin@demo.forgehse.local` with `DemoAdmin2026!`.

To work on the web app with live rebuilds, run `npm run dev -w @forgehse/web` alongside the API.

**AI:** set `ANTHROPIC_API_KEY` on the server (never in a client). Without a key, AI Studio shows a clear “not configured” notice. To exercise the UI without a key, run the **test-only** canned server `npm run mock:ai` and start the API with `ANTHROPIC_BASE_URL=http://127.0.0.1:4500 ANTHROPIC_API_KEY=mock-key`. Its answers are labelled as mock output; never use it in production.

**Voice:** dictation uses the browser's speech recognition (Chrome, Edge, Safari; not Firefox). Audio is handled by the browser's speech service, not stored by FORGEHSE. The field app uses the phone keyboard's dictation key.

## Tests

```bash
npm test                                   # shared + web unit tests + API integration tests (needs TEST_DATABASE_URL)
npx tsx --test apps/mobile/src/offline/*.test.ts
npm run typecheck
BASE_URL=http://127.0.0.1:4000 npm run e2e # browser end-to-end (needs the demo seed)
E2E_AI=1 BASE_URL=http://127.0.0.1:4000 npm run e2e   # + AI Studio checks (API pointed at a key or the mock)
```

`TEST_DATABASE_URL` must point at a **dedicated, disposable** database. The suite drops and recreates its schema.

## Deployment

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). It covers the Docker image, TLS, migrations, the first administrator, backups, monitoring, rollback and the Android build.

## Licences

Inter typeface: SIL Open Font License (see `apps/web/public/fonts/LICENSE-Inter.txt`).
