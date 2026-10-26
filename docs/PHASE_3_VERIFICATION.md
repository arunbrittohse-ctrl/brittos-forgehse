# Phase 3 — HSE Document Studio implementation and verification

**Branch:** `build/phase-1-hse-platform`  
**Status:** Implementation committed; acceptance is **not yet verified** because this environment cannot execute the repository's Node/PostgreSQL/browser test suite.

## Implemented

- Added a dedicated HSE Document Studio at `/app/studio/hse-documents` and a navigation entry.
- Added document-type choices for RA, JSA/JHA, MS, Project HSE Plan, ERP, WMP, Logistics Plan, TMP, Safe Work Procedure, HSE/QHSE policies, Environmental Management Plan, Inspection Checklist, Toolbox Talk, Training Materials, HSE Audit Report, Incident Investigation Report, and HSE Closeout/Handover Report; existing studio document types remain available.
- Added a server-side deterministic template generator. Its response is explicitly labelled as deterministic/template-generated; it does **not** claim to have called a live AI model.
- Captures project/site/client, country/emirate, supplied authority/client requirements and source references, package/activity/scope/sequence, equipment/materials/workforce, conditional hazard prompts, isolation/SIMOPS/environment, emergency arrangements, PPE and risk-matrix convention.
- Generates structured document sections, responsibility roles, assumptions/missing inputs, approval placeholders, and a structured risk table with task step, hazard, consequence, exposed people/assets, initial/residual likelihood and severity, scores/levels, controls, owner and verification requirements.
- Persists drafts in the existing tenant-scoped Studio item store and adds a revision-history table/migration.
- Added reopen/list, JSON-structured editing, schema-validated save with optimistic version check, revision history, existing DOCX/PDF exports of the saved Studio item, and browser print support.
- Expanded shared document-type and risk-row schemas.
- Added a warning that generated documents remain drafts and require qualified review; no legal citations or regulatory approvals are invented.

## Files changed/added

- `apps/api/src/routes/hse-documents.ts`
- `apps/api/src/app.ts`
- `apps/api/migrations/0007_hse_document_revisions.up.sql`
- `apps/api/migrations/0007_hse_document_revisions.down.sql`
- `packages/shared/src/studio.ts`
- `apps/web/src/pages/HseDocumentStudio.tsx`
- `apps/web/src/main.tsx`
- `apps/web/src/components/AppShell.tsx`
- `apps/web/src/styles.css`

## Verification performed

- Inspected the current branch source files and confirmed route registration, UI route, shared document type definitions, revision migration and existing Studio export endpoints are present.
- Confirmed the export implementation reuses the existing Studio item export path, which reads stored content rather than a static sample.
- No CI status checks or workflow runs have been executed/returned for this work in the available GitHub connector.

## Not verified / acceptance gaps

- `npm run typecheck`, `npm test`, `npm run build`, database migration execution, browser E2E, DOCX/PDF opening, and save/reopen/export round-trip tests were **not run**. A source inspection is not a substitute for execution.
- Therefore it is not yet verified that all 18 requested document types pass a full generate/edit/save/reopen/DOCX/PDF cycle.
- The deterministic generator currently creates a consistent generic controlled-document template with type-aware risk-table inclusion; it is not yet a fully specialised content pack for each of the 18 types.
- The current edit surface is a structured JSON editor plus rendered preview, not a full field-by-field rich document editor.
- The risk-matrix convention is captured per document and example scores are labelled illustrative. An organisation-wide configurable matrix calculator and automatic band mapping still need runtime-backed implementation and verification.
- A local model adapter and a generic provider adapter interface were not added in this phase. The deterministic template generator works without paid services; the existing AI Studio provider remains configured separately.
- The HSE Document Studio creates drafts; formal approval remains a separate controlled review step and no approval is implied.

## Phase 3 decision

**Do not mark Phase 3 acceptance complete yet.** Run the documented Node 22/PostgreSQL test commands and browser E2E in a suitable environment, fix any failures, and verify at least one full round trip for each document type before production use. No Phase 4 work has been started.
