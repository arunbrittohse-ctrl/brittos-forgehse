# BRITTO'S FORGEHSE — Repository audit and implementation plan

Date: 2026-10-28 · Repository `arunbrittohse-ctrl/brittos-forgehse`, branch `main` at `b8132b4`.
This answers Phase A–C of the master application brief and the visual-audit step of the
master design brief. Everything below was read from the repository; nothing is assumed.

## 1. What exists today (verified)

**Stack.** TypeScript monorepo: `packages/shared` (schemas, lifecycles, risk engine),
`apps/api` (Node HTTP + PostgreSQL via node-postgres, 9 migrations with down files),
`apps/web` (React 19), `apps/mobile` (Expo Android). Tests on the last CI run: shared 83,
web 7, API 108, all passing; e2e (Playwright) 15 passing at Phase 3.

**Auth and governance — live.** Email/password sessions (secure cookie), forced first
password change, 10 roles scoped to organisation/project/site, server-side permission
checks, append-only `audit_log`, rate limiting, CSP and security headers.

| Module | State | Evidence |
|---|---|---|
| Organisations, projects, sites, users, roles | Live | `/api/admin/*`, AdminProjects, AdminUsers |
| Observations / unsafe acts & conditions | Live (web + Android, camera, offline queue) | `/api/observations*`, `apps/mobile/src/offline/queue.ts` (tested) |
| HSE Document Studio (18 types, revisions, approval, DOCX/PDF) | Live | `/api/documents*`, migration 0008 |
| Hazard register, risk engine, insights, review/approval | Live | `/api/hazards*`, migration 0009 |
| AI Studio + assistant (free local provider; optional model) | Live, drafts only | `/api/studio*`, `/api/ai*` |
| Audit trail viewer, dashboard | Live | `/api/audit`, `/api/dashboard` |
| Risk assessments / JSA | Foundation (tables + lifecycle, no API/UI) | 0007 |
| Permit to Work | Foundation | `permits`, `permit_approvals` |
| Inspections & audits | Foundation | `inspection_templates`, `inspections`, `inspection_responses` |
| Incidents & investigations | Foundation | `incidents` |
| CAPA and HSE gaps | Foundation | `corrective_actions`, `hse_gaps` |
| Training & competency | Foundation | `training_courses`, `training_records` |
| Contractors & workforce | Foundation | `contractors`, `workers` |
| Environment monitoring | Foundation | `environmental_monitoring` |
| Emergency drills | Foundation | `emergency_drills` |
| Man-hours / HSE statistics | Not started | KPI helpers only (`shared/kpi.ts`) |
| Meetings, management review | Not started | — |

## 2. Gaps against the application brief

1. **Not live.** The deploy pipeline (Prisma Compute, free tier) is built and passes locally,
   but Prisma refuses to deploy until the repository is connected to the Prisma project in the
   Prisma Console. That needs the account owner; it cannot be done from here.
2. **Document and evidence library.** Uploads exist only for observations
   (`attachments.entity_type CHECK IN ('observation')`) with sha256, MIME sniffing and a
   15 MB limit. Missing: one library for all records, document metadata (number, revision,
   expiry, confidentiality, retention), file version chains, link table, folder/category
   views, short-lived download links, upload audit for every module.
   Storage drivers today are `disk` and `postgres` (base64 rows). There is no S3-compatible driver.
3. **Global search and saved views.** Only per-register filters.
4. **Notifications and reminders.** No job scheduler or notification table exists.
5. **Eight foundation modules** have data models but no API, screens or tests at API level.
6. **Reports.** Observation register (PDF/XLSX/CSV) and document exports exist. Missing:
   periodic HSE reports, man-hour/manday statistics with published formulas, registers for
   the other modules.
7. **Mobile.** Observations only; other field workflows (inspections, permits) not yet.

## 3. Plan (small, reviewable changes, each tested before the next)

| Step | Work | Done when |
|---|---|---|
| 0 | Go live on Prisma Compute; point the APK at the live URL | Live URL answers `/api/health`; sign-in works on web and APK |
| 1 | **Document & evidence library**: `files` + `file_versions` + `record_files` (migration 0010); metadata per §3 of the brief; generalise uploads to every module; signed, expiring download tokens; S3-compatible driver beside the Postgres driver | Upload/preview/download/version/audit tests; cross-organisation access test returns 403/404 |
| 2 | **Permit to Work** (hot work, cold work, confined space, excavation, lifting, LOTO, height): API, screens, isolation and gas-test fields, independent issuer/acceptor, expiry, suspension, close-out | Lifecycle and segregation-of-duties tests; expired permits cannot be extended without re-approval |
| 3 | **Inspections, incidents, CAPA** with cross-links to hazards, permits and files | Workflow tests; CAPA closure needs verifier ≠ owner plus evidence |
| 4 | **Global search + saved views** (PostgreSQL full-text, scope-filtered) | Search never returns records outside the user's scope (tested) |
| 5 | **Notifications & reminders** (DB-backed job table run by the server, dedupe key per alert, in-app inbox; email optional later) | No duplicate alert tests; event history |
| 6 | Training, contractors, environment, emergency | API + UI + tests per module |
| 7 | **Reports**: daily/weekly/monthly HSE report, man-hours/LTIFR/TRIR with formula definitions, registers | Formula unit tests with worked examples |
| 8 | Mobile: inspections and permit views, attachment capture for all modules | Tested on the APK build; offline only where tested |

## 4. Visual audit (design brief)

Already in place: `DESIGN.md` (colour roles, type scale, spacing, components, motion),
tokens in `apps/web/src/styles.css` and `apps/mobile/src/theme.ts`, the BRITTO monogram
(`components/brand.tsx` `Mark`), Manrope self-hosted, axe-core 0 violations on 6 pages.

Differences from the new palette, and the proposed resolution:

| Brief | Current | Proposal |
|---|---|---|
| Charcoal #111827 text | Navy #0B1F3B text | Adopt #111827 for body text, keep navy for headings and dark surfaces |
| Slate #475569 secondary text | #334155 / #5B6B82 | Adopt #475569 (7.6:1 on white) |
| Success #16A34A, Warning #F59E0B | Used as fills; darker text variants #166534 / #92400E | Keep: #16A34A is 3.3:1 and #F59E0B 2.1:1 on white, so they are fills/icons only, never text |
| Electric Blue #3B82F6 | Buttons use #2563EB | Keep #2563EB for buttons (white text 5.2:1); #3B82F6 for focus/charts |

Not yet made: logo usage sheet (clear space, minimum size, mono/reversed, favicon, app icon),
document cover and report templates as a design set, the poster/campaign series, motion
presets and video storyboards. These follow after step 1 so templates can be stored in the
new document library.
