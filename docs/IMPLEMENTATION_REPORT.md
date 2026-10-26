# BRITTO'S FORGEHSE: implementation report, v0.2 (AI Studio)

Date: 23 October 2026. Same rule as v0.1: this records only what was built and executed here. The v0.1 report follows below, unchanged.

## 1. What v0.2 adds

| Area | Delivered |
|---|---|
| AI Studio chat | Streaming answers over Server-Sent Events (`POST /api/ai/chat`), conversation history per user, stop button, Markdown with tables, copy and read-aloud. JSON mode (`?stream=0`) for the mobile app |
| Grounding and citations | Tools the model can call: `search_observations` and `hse_statistics` run server-side with the caller's own scope; every record used is returned as a clickable citation. Cross-tenant and cross-project leakage is covered by tests |
| Actions from chat | `create_studio_draft` starts a generator; `prepare_observation` opens a pre-filled report the user checks and submits. Nothing is saved or submitted by the model |
| Generators | Checklist, HSE document (10 types incl. toolbox talk, method statement, risk assessment with ratings on the tenant's matrix, ERP), safety poster, flowchart, review of an uploaded PDF/DOCX/TXT. Structured output via a forced tool whose JSON Schema is generated from the shared zod schemas, then validated again |
| Review workflow | Every item is a draft. `studio.review` (HSE engineer, project/corporate HSE manager, super admin) marks it reviewed with a note; any edit returns it to draft; optimistic versioning; audit entries for generate, edit, review, export, delete |
| Exports | Word (.docx, `docx` library), PDF (pdf-lib), SVG (server) and PNG (client canvas). Drafts are labelled “AI-assisted draft — NOT reviewed” in header/footer and `-DRAFT` in the file name; posters and flowcharts carry a visible draft mark |
| Voice | Browser speech recognition with a live level meter and 7 languages; read-aloud via speech synthesis. Feature-detected with clear messages where unsupported |
| Visual layer | Brand-board palette (#0B1F3B / #3B82F6 / #14B8A6 / #C7D2FE / #475569), light and dark themes, engineering panels (hard shadow + platinum edge) on featured panels, WebGL light field (30 fps cap, half resolution, pauses off-screen, static fallback), 3D tilt with specular light (pointer only), view transitions, one-shot reveals, count-up KPIs. All motion off under reduced motion (OS or in-app) |
| Command palette | Ctrl/⌘+K or `/`: navigation plus “Ask AI / create checklist / document / poster / flowchart” from one line |
| Sound | Web Audio synthesised cues, **off by default**, per-category switches, profiles, volume, preview, throttling, never blocks a workflow, mute stops playing sounds |
| Mobile | AI assistant screen (JSON mode), “Review the observation draft” hand-off into the report form, brand palette |
| Dev tooling | `scripts/dev/mock-anthropic.mjs`: canned, clearly labelled responses so the UI can be tested without a key. The API refuses a local `ANTHROPIC_BASE_URL` in production |

## 2. New and changed files

```
packages/shared/src/studio.ts, hse-icons.ts, render.ts, studio.test.ts      (schemas, 33 original HSE icons, poster + flowchart SVG renderers)
apps/api/migrations/0004_studio_chat.{up,down}.sql                            (studio_sources, studio_items, ai_conversations, ai_messages)
apps/api/src/ai/claude.ts (streaming, tools), tools.ts, usage.ts, prompts.ts (v2)
apps/api/src/routes/chat.ts, studio.ts; services/studio-export.ts; http/core.ts (SSE), static.ts (microphone=self)
apps/api/test/studio.test.ts
apps/web/src/pages/Studio.tsx, StudioLibrary.tsx; components/fx.tsx, markdown.tsx, studio-preview.tsx, CommandPalette.tsx, SoundMotionSettings.tsx
apps/web/src/lib/stream.ts, voice.ts, sound.ts (+ test), motion.ts; styles.css (v0.2 layer); e2e/run.mjs (+5 checks), e2e/visual.mjs
apps/mobile/src/screens/Assistant.tsx; App.tsx, Home.tsx, Report.tsx, theme.ts
scripts/dev/mock-anthropic.mjs
```

## 3. Tests and builds executed here

| Check | Result |
|---|---|
| Shared unit tests (schemas, renderers, escaping, layout, permissions) | 26 / 26 pass |
| Web unit tests (sound service with a fake AudioContext) | 7 / 7 pass |
| API integration tests on PostgreSQL 16 (v0.1 suites + 13 new Studio/chat tests) | 69 / 69 pass |
| Mobile offline-queue tests | 9 / 9 pass |
| Browser e2e (Playwright/Chromium), incl. AI Studio against the **mock** AI server | 18 / 18 pass |
| Type checks: shared, API (strict), web (offline React shim) | pass |
| Builds: web bundle (≈176 KB gzipped JS), API bundle; bundled server generated a DOCX and a PDF and streamed a chat | pass |
| Visual review of 16 screenshots (light, dark, 390 px mobile) | done; layout fixes applied |

## 4. Not done / limitations (honest list)

- **No real Claude call has been made.** There is still no API key in this environment; all AI paths were exercised with the fake fetch in tests and the canned mock server in the browser. Answer quality, latency and real cache-hit rates are unmeasured.
- **The Android app has still not been compiled.** The new screen follows the existing patterns but is untested on a device.
- Voice dictation depends on the browser's speech service (not available in Firefox); recognition quality for Arabic/Hindi/Urdu/Tamil is untested.
- PDF exports use the standard WinAnsi fonts, so Arabic text is replaced in PDFs (DOCX exports keep Unicode). Embedding a Unicode font is the fix.
- Flowchart layout is a heuristic layered layout; very dense charts (30+ nodes, many loops) can still have crossings.
- Conversations and uploaded source documents are stored per tenant with no retention policy yet; set one before production. Uploaded documents are sent to Anthropic for review, like any other AI request.
- The price table is still unverified; the logo is still the placeholder mark; Manrope is not adopted (decisions 3 and 4 in the build plan).
- Incidents, permits, inspections, NCR/CAPA, training, man-hours and the remaining modules are not built.

## 5. Next steps

1. Add a real `ANTHROPIC_API_KEY` in staging, run the e2e AI checks against it and record real token/cache figures.
2. Build the Android APK with EAS and run the offline + assistant flow on a device.
3. Embed a Unicode font for PDF exports (Arabic), then RTL layout.
4. Incidents module reusing the Studio review pattern for investigation reports.

---

# BRITTO'S FORGEHSE: implementation report, v0.1

Date: 23 October 2026. This report records what was **actually built and executed**. Nothing here is projected or assumed.

## 1. Audit of the starting point

- **Existing code:** none. The workspace held only the master prompt, and you confirmed a fresh start as a separate product from BRITTO 360.
- **Environment:** Node 22, Python 3.13, PostgreSQL 16 (local), Java/Gradle. No Android SDK, no reachable Docker daemon, no Anthropic API key.
- **Blocker:** the network policy blocked the npm and PyPI registries, and the Anthropic docs domain. With your approval, the build uses only pre-installed packages (React 19, esbuild, zod, pdf-lib, jszip, TypeScript, tsx, Playwright). The two consequences are:
  - The HTTP layer and the PostgreSQL wire-protocol client are small in-house modules instead of Fastify and `pg`. Both are isolated behind interfaces.
  - The Android app could be written and its offline logic tested, but it could **not be built or run** here.

## 2. Architecture selected

TypeScript monorepo with a shared validation, RBAC and risk package, a Node 22 API on PostgreSQL, a React web app, and an Expo Android app. Details are in [ARCHITECTURE.md](ARCHITECTURE.md).

## 3. Features implemented and verified

| Area | Delivered |
|---|---|
| Authentication | Cookie sessions (web) and bearer tokens (mobile), scrypt hashing, lockout, forced first-login password change, logout and revocation, organisation switching |
| RBAC and tenancy | 10 roles, org/project/site scoping, server-side checks on every endpoint, 404 for out-of-scope records, composite-FK tenant integrity, privilege-escalation guards |
| Audit | Append-only, trigger-enforced log of logins, changes, transitions, permission changes and exports, with an admin viewer |
| Administration | Projects, sites, users and role assignments (web UI and API) |
| Observations | Create (web and mobile), edit with optimistic locking, configurable risk matrix, reference numbers, a 6-transition workflow with segregation of duties, evidence uploads (magic-byte checked), status history, overdue tracking, filters and search |
| Dashboard | Live KPI strip, weekly trend, open-risk matrix (click through to filtered list), high/critical open items, hazard categories, by site, overdue by owner. Unbuilt modules are shown as unavailable, never as zero |
| Reports | Observation register as branded PDF (page numbers, timestamps, filters, source note), XLSX and CSV. Scoped, audited and formula-injection safe |
| Claude assistant | Draft an observation from notes, CAPA suggestions, 30-day management summary, HSE Q&A. Server-side only, human approval required, tenant-isolated retrieval |
| Prompt caching | Stable cached system prefix with a dynamic uncached suffix, threshold-aware, 5m TTL by default with 1h configurable. Token and cache telemetry with an admin usage dashboard |
| Public website | Overview, features, workflow, security, contact, sign-in |
| Android app | Sign-in (Keystore token), my actions and recent lists, quick report with camera, offline queue with idempotent sync, submit corrective action |
| Deployment | Dockerfile, docker-compose, `.env.example`, backup/restore scripts, deployment and rollback guide |

## 4. Files created

```
package.json, tsconfig.base.json, .gitignore, .env.example, Dockerfile, docker-compose.yml, README.md
config/ai-pricing.example.json
scripts/backup.sh, restore.sh, link-offline-deps.sh
docs/ARCHITECTURE.md, DEPLOYMENT.md, IMPLEMENTATION_REPORT.md
packages/shared/src/{permissions,risk,kpi,observation,schemas,index}.ts, shared.test.ts
apps/api/migrations/0001_core, 0002_observations, 0003_ai_usage (.up.sql/.down.sql)
apps/api/src/{server,app,config}.ts
apps/api/src/db/{pgwire,db,migrate}.ts
apps/api/src/http/{core,static}.ts
apps/api/src/auth/{passwords,session}.ts
apps/api/src/services/{audit,access,org,observations,exports,storage}.ts
apps/api/src/ai/{claude,prompts,pricing}.ts
apps/api/src/routes/{auth,admin,observations,dashboard,audit,ai,health}.ts
apps/api/src/cli/{migrate,seed}.ts
apps/api/test/{helpers,auth,admin,observations,ai,db}.test.ts
apps/web/{build.mjs,index.html}, public/{favicon.svg,fonts/*}, e2e/run.mjs, types-offline/react.d.ts
apps/web/src/{main.tsx,styles.css,env.d.ts}, lib/*, components/*, pages/* (14 screens)
apps/mobile/{App.tsx,index.ts,app.json,metro.config.js,package.json,tsconfig.json}
apps/mobile/src/{api,theme,types}.ts, offline/{queue,queue.test,instance}.ts, screens/{Login,Home,Report,Detail}.tsx
```

## 5. Database migrations

`0001_core` (organisations, users, projects, sites, role assignments, sessions, audit log with append-only trigger, number sequences), `0002_observations` (observations, events, attachments), `0003_ai_usage`. Applying migrations, rolling back and re-applying, and detecting a tampered checksum were all tested.

## 6. Environment variables

Listed in `.env.example`. Required: `DATABASE_URL`, plus `COOKIE_SECURE=true` in production. Optional: `ANTHROPIC_API_KEY`, `CLAUDE_MODEL` (default `claude-sonnet-5-5`), `CLAUDE_CACHE_TTL` (default `5m`), `AI_PRICING_FILE`, `CORS_ORIGINS`, session TTLs, upload limit, pool size and storage dir. No secret values are committed.

## 7. Prompt-caching design

The system block holds a ~2,300-token (estimated) stable prefix with one `cache_control: {type:"ephemeral"}` breakpoint. Tenant context, retrieved records and the user's request go in the user message, which is never cached. `cache_control` is skipped below the configured per-model minimum. Cache status comes only from `cache_read_input_tokens` and `cache_creation_input_tokens` in the response. Costs use a configurable price table and are labelled as estimates. The defaults are marked **unverified**, because the official pricing page could not be reached from the build environment.

## 8. Tests and builds executed (results from this environment)

| Check | Result |
|---|---|
| Typecheck: shared, API | Pass |
| Typecheck: web (offline React shim, `noImplicitAny` off for JSX handlers) | Pass |
| Shared unit tests (risk matrix, KPI formulas, RBAC scope, workflow, validation) | 17/17 pass |
| API integration tests on real PostgreSQL 16 (auth, CSRF, lockout, RBAC, cross-org/project/site isolation, workflow, segregation, optimistic locking, idempotency, uploads, exports, audit immutability, admin escalation guards, AI caching, accounting and isolation, upstream failures, DB layer, migrations) | 56/56 pass |
| Mobile offline-queue tests (idempotency, resume after crash, backoff, permanent failures, concurrent enqueue) | 9/9 pass |
| API production bundle (esbuild) and smoke run with `NODE_ENV=production` | Pass |
| Web production build | Pass |
| Browser end-to-end in Chromium (Playwright) on a fresh database using production bundles: public site, sign-in, dashboard, list, report with photo, assign, site-scoped submit, verify/close, viewer restrictions, admin pages, mobile viewport, dark theme, zero console errors | 14/14 pass |
| Backup → restore into a new database (row counts and files compared) | Pass |
| Secret scan of source and web bundle | Nothing found |

## 9. Token usage and savings

**Not measured.** No Anthropic API key was available, so no real Claude calls were made. Caching behaviour, token accounting and cost arithmetic are verified against a faked API returning realistic usage fields. Real hit rates and savings will appear on the AI usage page once a key is set.

## 10. Not done, and known limitations

**Modules not built:** incidents and near misses, permit to work, inspections and checklists, risk assessments, NCR/CAPA/audit, training and competency, HSE activities and meetings, man-hours (formula only), environmental, document management, the daily/weekly/monthly planner, scheduled reports, and notifications (no email or push is sent, and none is claimed).

**Engineering limitations to close before production:**

1. Replace `pgwire.ts` with `pg` (node-postgres) now that dependency access is possible. Consider Fastify for the HTTP layer.
2. Install the real dependencies (`@types/react`, Expo SDK packages) and run `npm run typecheck` (strict, without the offline shim) and `tsc` in `apps/mobile`.
3. The Android app has **never been compiled or run**. It needs `npx expo install --fix`, a device test, and an EAS build.
4. Add an S3/MinIO `ObjectStorage` implementation and Redis-backed rate limiting before running multiple instances.
5. Optional defence in depth: PostgreSQL row-level security on the tenant tables.
6. Arabic/RTL is not implemented. PDF exports use standard fonts (Latin only), so non-Latin characters print as "?".
7. Verify AI prices and the minimum cacheable token counts for the chosen model against the official docs.
8. No external penetration test or security review has been done.
9. There is no password-reset email flow; administrators reset passwords.

## 11. Deployment and rollback

See [DEPLOYMENT.md](DEPLOYMENT.md), sections 2 and 7.

## 12. Recommended next steps

1. On a machine with registry access: `npm install`, swap in `pg`, run the full strict typecheck and every suite.
2. Build and field-test the Android app on a real device on site, including offline use.
3. Set an Anthropic key on staging, verify pricing, and review real cache hit rates on the AI usage page.
4. Build **Incidents & Near Misses** next, reusing the workflow, audit, numbering, attachment and export services.
5. Add notifications (email first) with delivery confirmation, then the scheduled weekly and monthly reports.

---

# v0.3 increment — premium visual layer and interactive analytics (26 October 2026)

Recorded on the same rule: only what was built and executed here.

| Area | Delivered |
|---|---|
| Typography | Manrope adopted (self-hosted woff2, 400–800, SIL OFL, `public/fonts/LICENSE-Manrope.txt`); Inter kept as fallback. No external font requests, CSP unchanged |
| Corporate graphics | `components/graphics.tsx`: deterministic blueprint grid + connected-node network (pure SVG, aria-hidden, pulse disabled under reduced motion) on the sign-in panel and a new command-centre hero band; node-ring loading indicator |
| HSE icons | The shared 33-icon HSE line family (`packages/shared/src/hse-icons.ts`) now used in navigation, KPI cards and Health / Safety / Environment pillars |
| Interactive analytics | Weekly chart: animated entry, series toggles, hover/keyboard tooltip, select a week → its records. New risk-score histogram (bands from the tenant matrix) → records with that score. Hazard bars, site rows and overdue owners link to filtered registers. Filter chips on the register show and clear each drill-down |
| API | `GET /api/observations` accepts `riskScore`, `hazardCategory`, `assigneeId` (validated, scope-filtered; cannot widen access) |

Tests executed: shared 26/26 · web unit 7/7 · API 70/70 (one new drill-down/isolation test) · mobile queue 9/9 · strict `tsc` on shared, API and web **with real @types/react** (no offline shim) · browser e2e 18/18 against the mock AI · visual check of sign-in, light/dark dashboard, tooltip and drill-downs.

Still not done: incident reporting, inspection checklists and CAPA notifications (modules not built); final logo; real Claude, Android device and penetration testing as listed above.

---

# Phase 1 — foundation (26 October 2026, branch `phase-1-foundation`)

| Area | Delivered |
|---|---|
| Database driver | In-house `pgwire.ts` replaced by node-postgres (`pg`), behind the unchanged `Db` interface; value conventions kept identical (`db/types.ts`) |
| AI without cost | Provider layer: `local` rules engine (deterministic, labelled "no AI model"), `openai_compatible` for self-hosted models (Ollama etc.), optional `anthropic`, `off`. Default `auto` = local unless a Claude key is set |
| Domain model | `packages/shared/src/domains/`: registry of 13 domains with honest status, lifecycle engine (comment / evidence / independent-verifier rules), lifecycles and validated input schemas for documents, risk assessments/JSA, permits, inspections, incidents, CAPA, gaps, contractors, training, monitoring, drills |
| Migration 0006 | 22 additive tables; database CHECKs enforce independent verification, owner+due date, authorised permits, tenant-consistent project/site keys, computed exceedances |
| Configuration | `config/env/{development,test,production}.env.example`, AI options in `.env.example`, `docs/DEVELOPMENT_READINESS.md` |

Verification executed: strict typecheck (shared/API/web) · builds · shared 33/33 · web 7/7 · API 90/90 · mobile 9/9 · browser e2e 18/18 with `AI_PROVIDER=local` and no mock server · route check (14 pages 200) · export content check (PDF/XLSX/CSV register and Studio DOCX/PDF contain the saved record text) · unauthorised-access probes · Netlify function bundle cold start on a fresh database (6 migrations, ready).

Not done in Phase 1 (by design): APIs and screens for the new domains — they are `foundation` status only.
