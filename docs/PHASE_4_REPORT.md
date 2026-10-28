# Phase 4 — Hazard register, risk engine and risk insights: report

Date: 28 October 2026. Branch `phase-4-hazard-register`, merged into `main`.

## Built

| Area | Implementation |
|---|---|
| Hazard register | `hazard_register` (migration 0009). Each entry records ID (HAZ-YYYY-NNNN), category, project, site, activity, work package, description, consequences, persons exposed, existing controls, initial risk, additional controls (owner, due date, status), residual risk with justification, review date, revision, status, links and history. |
| Categories | 18 configurable categories: electrical energy, arc flash, work at height, lifting, dropped objects, excavation, confined spaces, hazardous substances, gas exposure, fire, vehicle/plant movement, heat stress, noise, ergonomics, biological, environmental spills, SIMOPS and other. An organisation can override them in `settings.hazardRegisterCategories`. |
| Risk engine | `packages/shared/src/hazards/register.ts`. Score = L × S on the matrix stored with the entry; ratings outside the matrix are never clamped. Inherent and residual risk are evaluated separately. **A lower residual risk is accepted only when at least one control is in place (not "planned") and assessed effective or partially effective with a stated basis, and a justification is written.** Residual above initial is refused. Lowering severity with only administrative or PPE controls is flagged. Overdue planned controls are reported. |
| Approval route | Low/medium: one independent reviewer approves. High/critical: an independent review, then approval by a `risk.approve` holder who is neither the submitter nor the reviewer. A critical residual risk cannot be approved (API and DB CHECK); submitting one writes a `hazard.escalate` audit event. |
| Workflow | draft → submitted → reviewed → approved; reject (reason required) → edit → draft; approved → reassess (Rev 01, reason required); archive. Every change writes an append-only snapshot (trigger-protected) and an audit row. |
| Insights | `packages/shared/src/hazards/insights.ts`. Rules: repeated hazards at a site (≥3 in 90 days), recurring near misses (≥2), overdue high/critical observation actions, overdue planned controls, review dates passed, approved entries with high residual risk. Each alert shows why it fired, the facts, links to the underlying records, limitations and recommended human actions. It is labelled "Rule-based — not a validated prediction". There is no weather, training, inspection or incident data yet, so those sources are listed as unavailable rather than guessed. |
| Lessons | Closed observations in the same hazard family with a recorded, verified action. |
| Links | Document Studio documents and observations, validated as belonging to the same organisation and project. Permits, incidents and inspections will be linkable when those modules exist. |
| Import | A Document Studio risk register sends its rated, accepted rows to the register as drafts. Controls arrive "not assessed", so effectiveness evidence is still needed. |
| UI | Register with residual-band summary cards (clickable filters), reviews overdue and awaiting approval, insights panel with a 6-month observation trend, filters, desktop table and phone cards. Editor with clickable 5×5 matrix pickers, control rows with effectiveness, a live risk-engine panel showing the approval route, linked records, verified lessons and history. |
| Permissions | `risk.view` (all roles; viewers and field roles see approved entries only), `risk.manage` (HSE officer/engineer, project manager, HSE managers), `risk.approve` (corporate and project HSE managers). |

## Tests executed

| Command | Result |
|---|---|
| `npm run typecheck` | Pass |
| shared tests | 83/83 (13 new: matrix scoring of all 25 cells, configurable matrix, reduction rules, approval routing, review reminders, categories, each insight rule) |
| web tests | 7/7 |
| API tests (PostgreSQL 16) | 106/106 (10 new: creation and validation, unsupported reduction refused, low-risk and high-risk routes, intolerable risk, reject/rework, optimistic locking, filters and summary, insights from stored observations, links and document import, project/tenant isolation, append-only history, DB CHECKs) |
| Browser regression e2e | 15/15 |
| New browser walk-through | Engineer creates a CRITICAL→HIGH entry using the matrix picker. The engine blocks the unjustified reduction until a justification is added. The engineer submits; the project HSE manager reviews (no approve button for them); the corporate HSE manager approves. History is complete. A 390 px phone shows no horizontal overflow and no page errors. |

## Limitations

- Insights are rules over FORGEHSE records only; their quality depends on what people report.
- No notifications are sent for review reminders yet; they show as register filters, counts and insights (notifications come with Phase 6).
- The mobile app does not include the register yet (Phase 9).
- Not production-ready on its own: hosting, backups and a security review remain (Phase 10).
