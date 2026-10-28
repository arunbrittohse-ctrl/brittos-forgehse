# Phase 3 — HSE Document Studio and exports: implementation and verification report

Date: 28 October 2026. Branch: `phase-3-document-studio`, merged into `main`.

## Reconciliation done first

`main` had a parallel Phase 1 (generic `hse_records` envelope, migration 0006) that did not include the
free AI provider layer, the node-postgres driver or the normalised domain tables. They were ported
onto `main` without changing what `main` already had:

- the normalised tables are now migration **0007** (main keeps its 0006);
- `hse_record_events` in the port was renamed `domain_record_events` to avoid a clash;
- the shared registry export is now `HSE_MODULES`, because `HSE_DOMAINS` already existed;
- two defects on `main` were fixed. An unescaped apostrophe in `ModuleWorkspace.tsx` broke the web
  typecheck and build, and the migration test hard-coded an old migration list.

The unexecuted Phase 3 attempt on `build/phase-1-hse-platform` was not merged. Its own report says
nothing in it was run. This implementation replaces it.

## What was built

| Area | Implementation |
|---|---|
| Document types | 18: RA, JSA/JHA, MS, Project HSE Plan, ERP, WMP, Logistics Plan, TMP, Safe Work Procedure, HSE Policy, QHSE Policy, EMP, Inspection Checklist, Toolbox Talk, Training Material, HSE Audit Report, Incident Investigation Report, HSE Closeout & Handover Report (`packages/shared/src/documents/catalog.ts`). |
| Conditional form | 90+ fields. Each declares the document types and families it applies to, the activity hazards that reveal it (lifting → lift category, crane, lift plan; electrical → voltage, LOTO, live work → justification; confined space → gas testing, rescue …) and whether it is required to generate or to submit. |
| Generator | Deterministic template generator (`generate.ts`). Same inputs give the same document. It uses the curated topic library, now in `packages/shared/src/knowledge`. |
| Risk register | Task step, hazard, consequence, exposed people/assets, existing controls, initial L/S/score/band, additional controls, owner, residual L/S/score/band, verification. Ratings are **left blank** for the assessor. |
| Risk matrix | Stored with each document (snapshot of the organisation's configurable matrix). It is printed with its bands and labels, plus a statement that conventions are not universal. Ratings outside the matrix are rejected, not clamped. |
| Method statements | Scope, responsibilities, prerequisites, resources, permits (from the selected hazards), isolation, conditions, sequence with hold points, hold-point table, safety and environmental controls, emergency, inspections and acceptance criteria, matrix, risk register, PPE, references, review. |
| Policies and plans | Controlled-document metadata, scope, responsibilities, procedures, records, review frequency, signatory and approval fields. |
| AI | Provider-independent `SuggestionProvider` interface (`apps/api/src/services/document-generator.ts`). The template always runs. Model suggestions are offered only when a real language model is configured (for example Ollama via `AI_PROVIDER=openai_compatible`). The local rules engine is never presented as a model. `generator.modelCalled` is true only after a model answered. |
| Editing | Editable preview of every section (heading, paragraphs, bullets, table cells), risk-row editor with L/S pickers and live score/band, accept or delete for model suggestions, an Inputs tab and "Rebuild from saved inputs". |
| Persistence | `hse_documents` and append-only `hse_document_revisions` (migration 0008; a trigger blocks UPDATE and DELETE). Optimistic versioning. Every change writes a snapshot and an audit-log row. |
| Workflow | draft → in review → approved, or returned with a comment. An approved document changes only through a new revision (Rev 00 → Rev 01); the approved revision stays exportable from History. Withdraw needs a reason. The approver cannot be the preparer or the submitter, enforced in the API and by a database CHECK. |
| Readiness | Submission is blocked until required inputs are present, `[Confirm: …]` placeholders are resolved, every risk row is rated and owned, residual reductions have additional controls and verification, and model suggestions have been accepted or removed. High or critical residual risk is flagged for authorised approval. |
| Export | DOCX (`docx`) and PDF (`pdf-lib`) built from the saved record or a stored snapshot. Includes header and footer with document number, revision and status, page X of Y, a document-control table, a status banner ("DRAFT — NOT APPROVED" until approved), the risk register on landscape pages, a matrix grid, assumptions, missing inputs, qualified-review requirements, an approval table and revision history. |
| Print | Print button with print stylesheet (hides navigation and controls). |
| RBAC | New permissions `document.view`, `document.create` and `document.approve`. Viewers and field roles see approved documents only. Access is scoped by project and tenant. |

## Compliance safeguards (tested)

- No legal citations, authority names, clause numbers, phone numbers or approval/compliance claims are
  generated. A test scans every type for them.
- References are printed only as the author entered them, with their source.
- Assumptions and missing inputs are listed in every document.
- Each type states why qualified review is needed. Confined space, live electrical work,
  complex or critical lifts and unsurveyed services add specific review requirements.
- Incident reports list possible contributing factors as "not findings". Causes stay
  `[Confirm …]` until the investigation team enters verified answers.
- Training material states that attendance is not competence and that no accredited certification is conferred.

## Tests actually executed (28 Oct 2026, this environment)

| Command | Result |
|---|---|
| `npm run typecheck` (shared, api, web) | Pass |
| `npm test -w @forgehse/shared` | 70/70 pass (32 new Document Studio tests) |
| `npm test -w @forgehse/web` | 7/7 pass |
| `npm test -w @forgehse/api` (PostgreSQL 16) | 96/96 pass (6 new Document Studio suites) |
| `npm run build` | Pass |
| Migration 0001–0008 up/down round trip | Pass (part of API tests) |
| Existing browser e2e (`apps/web/e2e/run.mjs`, demo seed) | 15/15 pass |
| New browser walk-through (Chromium): choose type → conditional question appears → generate → edit → rate → save → reload → PDF and DOCX download → history | Pass. The PDF was checked with `pdftotext` and contains the edit, the number, Rev 00 and the draft banner. |

The API round-trip test generates, edits, saves, reopens and exports **all 18 types** in both formats.
It checks the edit marker, title, document number, revision and draft status inside the DOCX XML
and in the decoded PDF text.

## Limitations

- PDF uses the standard Helvetica font, so Arabic and other non-Latin text prints as `?`. DOCX is unaffected.
- While a new revision is in draft, viewers cannot see the previous approved revision in the
  register (it remains exportable from History by preparers).
- Model suggestions were tested with an in-test stub backend (labelled as such), not a running Ollama server.
- The register table scrolls horizontally on phones. A card layout for mobile belongs to Phase 9.
- The template content is general good practice. It is a drafting aid, not a substitute for a
  competent author, and it does not establish compliance.

## Readiness

Phase 3 acceptance criteria are met by executed tests. This is not a claim of production readiness:
hosting, backups, Arabic PDF fonts and a security review remain open (Phase 10).
