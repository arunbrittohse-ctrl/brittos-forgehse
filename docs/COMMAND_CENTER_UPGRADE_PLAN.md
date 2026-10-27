# BRITTO’S FORGEHSE — HSE Command Center Upgrade Plan

**Status:** Proposed implementation plan based on repository documentation review  
**Target branch:** `build/phase-1-hse-platform`  
**Decision:** Preserve the existing TypeScript monorepo. Do not begin a wholesale rewrite or claim production readiness.

## 1. Audit snapshot

The repository README and phase reports describe:
- `apps/web`: React 19 workspace/public site built with esbuild.
- `apps/api`: Node 22 HTTP API, PostgreSQL migrations/persistence, authentication, RBAC, audit trail, observations, AI Studio and exports.
- `apps/mobile`: Expo/React Native Android field app with an offline observation queue.
- `packages/shared`: shared Zod schemas, permissions, risk calculations, KPI formulas and domain contracts.
- PostgreSQL-backed tenant/project/site scoping, append-only audit history, scoped observations, and AI draft/review flows are documented.

The documentation also records significant unfinished work:
- The Phase 2 report says twelve new module destinations are placeholders rather than operational workflows.
- Incidents/investigations, permits/isolation, inspections/audits, NCR/CAPA, training/competency, man-hours, environmental/equipment monitoring and related modules need real domain-specific implementation.
- The Phase 3 report says the HSE Document Studio was implemented but acceptance was not verified by typecheck, tests, build, migration execution, browser E2E or a complete save/reopen/export round trip.
- The v0.2 implementation report says real Claude calls were not tested in that environment, the Android app was not compiled, Arabic PDF text needs Unicode font/RTL work, and a retention policy is needed for conversations and uploaded source documents.
- The architecture document says the in-house PostgreSQL wire client should be replaced with `pg` before production.
- Reports describe no verified connected sensor/CCTV/IoT pipeline and no real facility model. These must be treated as not yet available until confirmed.

**Evidence boundary:** This plan is based on the repository documents fetched for review. It is not a fresh checkout, runtime test, security assessment, database inspection, hardware test, or deployment verification. Run the documented commands in a suitable Node 22/PostgreSQL environment before accepting phases.

## 2. Guardrails

1. Preserve existing routes, authentication, observation workflows, AI Studio, exports and mobile offline queue unless a replacement is justified and regression-tested.
2. Keep live production data, seeded demo data, simulated sensor events and generated media visibly distinct.
3. Do not claim a connected sensor, live telemetry, approved permit, legal compliance, passing test, or production deployment without evidence.
4. All consequential HSE decisions remain subject to authorized human review. AI can draft and explain; it cannot approve permits, certify compliance, close hazards, or override emergency procedures.
5. Enforce organization/project/site permissions server-side. Treat client IDs and JSON payloads as untrusted.
6. Never infer a person's identity, intent, or wrongdoing from motion alone. CCTV/video analytics require lawful authorization, privacy review, and human verification.
7. Use verified facility floor plans/CAD/BIM for a real digital twin. Until supplied, mark all geometry as an illustrative demonstration.
8. Keep sound off by default, respect reduced motion, and make every alert accessible without sound or color alone.
9. Do not expose secrets or sensitive evidence in client bundles, public storage, logs, or unauthenticated downloads.
10. Do not mention project names or site-specific references in generic product content.

## 3. Four command-center design directions

These are intentionally distinct alternatives to present for selection; do not average them into a generic dashboard.

### Direction A — Industrial Operations Console (recommended starting point)
- Graphite/charcoal background, midnight-blue navigation, restrained cyan/teal active states.
- Dense but legible operational layout: left navigation, project/site switcher, critical-event strip, KPI row, event/approval queues, action aging and telemetry freshness.
- Uses color semantically: green verified-normal, amber warning, red critical, neutral unknown/stale.
- Best for daily HSE managers and control-room operators who need fast triage.
- Risk: can feel visually dense; protect whitespace and avoid too many cards.

### Direction B — Executive Safety Intelligence
- Light cool-white canvas with deep navy typography, blue/teal data marks and sparse high-value charts.
- Emphasizes trend context, exposure, leading/lagging indicators, action aging and project comparisons.
- Best for executives and corporate HSE leaders.
- Risk: less suitable for rapid incident triage if alert queues are buried.

### Direction C — Digital Twin First
- Wide facility visualization as the main workspace, with collapsible asset, sensor, zone and incident layers.
- Side inspector shows selected object identity, status, evidence and linked records; 2D list/map fallback remains available.
- Best for sites where verified spatial models and live integrations exist.
- Risk: should not be the default until real model geometry, data feeds and WebGL performance are proven.

### Direction D — Field Operations Workflow
- Task-first, responsive interface with assigned inspections, actions, permits, expiries, quick capture and offline/sync status.
- Optimized for tablets and mobile field staff; desktop provides a broader work queue.
- Best for supervisors, HSE officers and contractors.
- Risk: weaker high-level overview if used as the only executive experience.

**Recommendation:** Use Direction A as the main desktop command center, borrowing Direction B's analytical clarity and Direction D's task-first mobile patterns. Implement Direction C as a separate Digital Twin workspace only after a representative 3D proof of concept passes performance and data-integrity checks.

## 4. Target architecture

Keep the current modular monolith/API-first approach initially:
- **Clients:** existing React web app and Expo/React Native mobile app.
- **Domain contracts:** shared Zod schemas and typed lifecycle rules in `packages/shared`.
- **API/domain services:** authentication, authorization, validation, workflow transitions, calculation services, integrations and audit events.
- **Database:** PostgreSQL with normalized domain tables where justified, tenant-aware foreign keys, migrations, transactions, optimistic concurrency and append-only event/audit history.
- **Object storage:** private evidence/media storage with server-generated keys, short-lived authorized access, metadata in PostgreSQL, validation, retention and malware scanning where available.
- **Real-time layer:** begin with the existing compatible API architecture; add SSE/WebSocket only for confirmed live needs. Sensor ingestion must be authenticated and independent of client presentation.
- **AI Gateway:** server-only provider calls, permission-filtered retrieval, citations, usage tracking, validation of structured outputs, human review and configurable retention.
- **3D rendering:** use an existing compatible engine if present; otherwise prototype a Three.js-based isolated module. Lazy-load model assets and provide a 2D fallback.
- **Observability:** structured operational logs, metrics, health checks, failed-ingestion monitoring and backup/restore verification.

Do not add microservices, Redis, Kubernetes, new storage vendors, or multiple AI providers until measurable requirements justify them. Before production, review the repository's documented in-house PostgreSQL client and replace it with a maintained driver if the audit confirms the risk described in `docs/ARCHITECTURE.md`.

## 5. Domain modules and data foundations

Implement each module with a dedicated schema, API, authorization rules, state machine, persistence, audit events, UI and tests. The generic record envelope is not a substitute for domain validation.

1. Incidents/near misses: classification, chronology, witnesses, restricted evidence, investigation, root cause, linked actions and authorized closure.
2. Risk assessments/JSA/MS review: task steps, hazards, exposed persons/assets, initial/residual likelihood and severity, controls, owners, matrix version, approval/review and evidence.
3. Permit to Work/LOTO: type, location, scope, issuer/receiver, prerequisites, isolations, tests, validity, suspension, handover, closure and explicit approval history.
4. Inspections/audits: templates, schedules, pass/fail/N/A/review outcomes, evidence, findings and action linkage.
5. NCR/CAPA/actions: owner, due date, escalation, evidence, independent verification, rejection reason and immutable history.
6. Workforce/competency/induction: role, employer, site assignment, competency, induction attendance/assessment/validity and training expiry.
7. Third-party certificates: certificate number, issuer, person/asset, issue/expiry dates, verification status, reminders and evidence.
8. Man-hours/statistics: revision-safe records by site/date/employer; explicit source and period.
9. Environmental/equipment/sensors: measurement units, thresholds, timestamps, source identity, device health, data quality, stale/disconnected state, maintenance and linked events.
10. Document control: owner, revision, review date, approval status, distribution, effective/expiry dates, superseded versions and access permissions.
11. Emergency readiness: plans, drills, muster checks, escalation, lessons learned and evidence.
12. HSE AI Studio/media: posters, checklists, toolbox talks, training packs, presentations, flowcharts, images/video/voice, document review and exports; generated media must never be mistaken for actual incident evidence.

## 6. KPI and calculation governance

- Store each calculation's definition, formula version, reporting multiplier/base, unit, time period, filters and source-record rules.
- LTIFR must be configurable as lost-time injuries × configured multiplier ÷ total hours worked. Do not hard-code a universal multiplier.
- For zero or missing denominator, return unavailable/not calculable, not zero.
- Define inclusion/exclusion rules for injury cases, revised man-hours, duplicate records and reporting periods.
- Dashboard numbers must be derived from authorized persisted records. Unsupported modules should display unavailable/no data, not fabricated zeros.
- Provide drill-down from every KPI to its contributing records and expose the calculation definition in report metadata.

## 7. Sensor-event and alert architecture

Use an authenticated, modular ingestion pipeline:
1. Authenticate gateway/device and validate schema.
2. Normalize timestamp, units and source identity; reject malformed payloads.
3. Deduplicate using a stable source/event key and apply configured debounce windows.
4. Persist the accepted event and its processing/audit state.
5. Apply versioned thresholds/rules and create traceable alerts.
6. Escalate according to configured rules; require authorized human acknowledgment where applicable.
7. Broadcast only to authorized users and display connection/data freshness.
8. Monitor ingestion lag, invalid payloads, device failures, retries and dead-lettered events.

Every event needs source/device health, site/zone/asset, event and ingestion timestamps, type/value/unit, confidence when produced by a model, severity, acknowledgment/escalation state, evidence reference and history. No live-device status until a real connection is verified.

## 8. HSE AI Studio expansion

Build generation on top of the governed document/media model:
- Poster generator: hazard-specific accurate visual brief, concise instructions, PPE, site branding, optional QR code and A4/A3 print layout.
- Training/TBT generator: audience, task, hazards, controls, facilitator notes, slides, quiz and attendance record.
- Checklist/RA/JSA/MS review generator: scope and sequence first, evidence citations, risk-matrix configuration, assumptions/missing-input list, owner and review fields.
- Voice command: transcribe, show interpreted command, preview changes and require confirmation before submission, approval, personnel edits or closure.
- Image/video/voice studio: licensed/original assets; metadata and versioning; generated media separated from evidence.
- Search: permission-filtered full text and metadata filters; index titles, revisions, project/site, tags and extracted text.
- Every AI artifact begins as a draft, carries source/assumption metadata, and requires authorized review where consequential.

## 9. Phased delivery and exit gates

### Phase 1 — Audit and baseline
Deliver route/module inventory, data and auth map, dependency/integration inventory, current CI/test evidence, known defects, backup/rollback approach and prioritized backlog. Exit only when existing workflows and current test status are documented.

### Phase 2 — Design selection
Present four distinct command-center alternatives, choose one with the product owner, define tokens/components/alert states and map responsive layouts. Figma design work is currently blocked by the connector's Starter-plan tool-call limit; the Figma file exists but was not populated. Do not treat that as a finished design artifact.

### Phase 3 — Foundation verification
Run typecheck, unit/integration tests, build, migration up/down, browser smoke/E2E and mobile offline tests in a suitable environment. Fix baseline failures before expanding modules.

### Phase 4 — Operational modules
Prioritize one end-to-end slice at a time: incident and corrective-action lifecycle; inspection findings to CAPA; PTW/isolations; workforce/certificates/training; man-hours and KPI calculations; environmental/equipment registers; document control and reports.

### Phase 5 — Digital twin and telemetry proof of concept
Use one verified or clearly illustrative facility zone, one selectable asset, a few clearly simulated markers and one simulated event. Validate camera controls, object selection, data labels, accessibility fallback and representative-device performance before expanding.

### Phase 6 — Motion, sound and AI/media
Add restrained state-driven motion, optional short sound cues off by default, reduced-motion handling, AI citations/permissions and media governance. Never let effects delay or obscure critical alerts.

### Phase 7 — Release readiness
Verify permissions, persistence, audit history, event delivery/reconnect, accessibility, performance, retention, backup restore, security controls, rollback and deployment. Produce a criterion-by-criterion evidence report with passed/failed/not-tested states.

## 10. Immediate backlog

**P0 — safety and truthfulness**
- Establish runnable CI or a Node 22/PostgreSQL validation environment.
- Close Phase 2/3 verification gaps and test existing observation/AI Studio regressions.
- Replace the PostgreSQL wire client with maintained `pg` if confirmed as still present and compatible.
- Define retention for conversations/uploads and add Arabic-capable PDF font/RTL support.

**P1 — core operational workflows**
- Incident investigation + corrective action.
- Inspection + finding + verification.
- PTW + isolation + approvals.
- Workforce/competency/induction/certificates.
- Man-hours, versioned KPI calculations and report drill-down.
- Document-control revisions and approvals.

**P2 — intelligence**
- Environmental/equipment registers and alert history.
- Sensor gateway adapter, data-quality/freshness indicators and rule engine.
- Permission-filtered document search and AI citations across new modules.

**P3 — advanced visual layer**
- Four approved design directions and shared tokens.
- One-area 3D proof of concept, 2D fallback and performance budget.
- State-driven motion, optional sound and governed generated media.

## 11. Definition of done

A module is complete only when its server-side schema, authorization, persistence, lifecycle, audit events, user interface, empty/error/offline states, automated tests and export/report behavior are verified. A design mockup, placeholder route, source-code inspection or mock-provider test alone does not satisfy operational acceptance.
