# Phase 5 report — Document & evidence library, Permit to Work, text colours

Date: 2026-10-28 · Commits `43bf0c3`, `fe21db1`, `9ad1dbf`, `24f5826` on `main`.
Follows the plan in `docs/AUDIT_AND_PLAN.md` (steps 1 and 2). The owner chose "library, then PTW"
and the new Charcoal/Slate text colours.

## What was built

### Text colours (design brief)
Body text `#111827` (Charcoal), secondary text `#475569` (Slate), headings Deep Navy `#0B1F3B`
(new `--heading` token), web and Android. `DESIGN.md` updated.

### Document & evidence library (migration 0010)
- One library for every HSE file: `library_files` (metadata), `library_versions` (immutable),
  `library_links` (to observations, hazards, HSE documents, permits), staged uploads and
  10-minute download links (only a hash of each token is stored).
- Metadata: title, document number, type (18), category, tags, description, project/site or
  organisation-wide, confidentiality, retention category, owner, issue and expiry dates.
- File checks on the server: content must match an accepted type (PDF, DOCX, XLSX, PPTX, CSV, JPG,
  PNG, WebP, HEIC, MP4, MOV, M4A) and the extension; macro-enabled Office files and ZIPs refused;
  SHA-256 stored and checked against the browser's checksum; 25 MB limit (configurable).
- Versions: never overwritten or deleted (database trigger). New version → draft → submit →
  approve/reject by an approver who did not upload or submit it (API and database check). Approving
  marks the previous approved version superseded. One open version at a time.
- Visibility: organisation → project → site scope, then confidentiality (internal / confidential /
  restricted). Readers only see files with an approved version, and only approved/superseded versions.
- Audit: upload, new version, submit/approve/reject, details changed (field diff), link/unlink,
  view, download, share link and link download.
- Web: register (expired / due in 30 days / under review tiles, filters, search), upload by drag and
  drop or phone camera, file page with preview (images, video, audio, PDF), revision history, review
  dialogs, copy 10-minute link, mark obsolete; "Files & evidence" panel on observations, hazards,
  HSE documents and permits.

### Permit to Work (migration 0011)
- Types: hot work, cold work, confined space, excavation, lifting, electrical isolation (LOTO), work
  at height, general. Each has a default checklist (critical items marked) and required details
  (e.g. fire watch, attendant and rescue plan, depth and services survey, lift plan, isolations with
  lock numbers). The checklists are generic prompts to be confirmed against the site PTW procedure.
- Flow: draft → submitted → safety review → authorised → active → (suspended → revalidated) →
  completed → closed; reject and cancel; automatic expiry when validity ends.
- Segregation of duties: the applicant cannot review, confirm review checks, authorise, revalidate
  or close; closing also needs someone other than the person who handed back (API and database).
- Authorisation needs all critical checks, complete type details, isolations with lock numbers and,
  for confined spaces or when ticked, a gas test taken after submission and within the site's limits
  (the tester confirms; no limits are invented). Revalidation after suspension needs a new gas test.
- Validity is capped per organisation (`permitMaxHours`, default 24). Expired permits are never
  extended; "Copy as new application" creates a fresh draft with checks and gas tests reset.
- Other live/pending permits in the same site and time window are shown (simultaneous operations).
- Append-only `permit_events` history; every step audited.
- Web: register (live, awaiting, ending within 2 h, suspended), application form, permit page with
  checks, gas tests, isolations, sign-offs, history and files.

## Verification (all executed)

| Check | Result |
|---|---|
| Typecheck (shared, API, web) | 0 errors |
| Unit tests — shared | 87 passed |
| Unit tests — web | 7 passed |
| API tests (real PostgreSQL) | 125 passed, incl. 9 library and 8 permit tests |
| Existing browser e2e (`e2e/run.mjs`) | 15/15 |
| Library browser walk-through (`e2e/library.mjs`) | 9/9 |
| PTW browser walk-through (`e2e/permits.mjs`) | 5/5 (confined space: apply → review → gas test → authorise → start → suspend → retest → revalidate → hand back → close) |
| Phone layout (390 px) library and PTW pages | no horizontal overflow |
| axe-core WCAG 2.1 AA, light and dark | 0 violations on library and permit pages and the 6 earlier pages |
| GitHub CI on `24f5826` | passed; Android APK build `apk-9` passed |
| Single-file hosted build (`npm run build:compute`) | built, includes migrations 0010–0011 |

One full API run out of seven had a single failing test that did not repeat in six further runs
(the same happened once on GitHub before this phase). It has not been identified yet.

## Not done / known gaps
- **Not live.** Deploying to Prisma Compute still fails because the repository is not connected
  to the Prisma project (needs the account owner in the Prisma Console).
- Android app: no library or PTW screens yet; it still points at a server address that is not live.
- No virus scanning (stated on the upload page). No S3-compatible storage driver yet; files are
  stored by the configured driver (disk, or PostgreSQL on the hosted build).
- PDF preview could not be checked in the headless test browser (it has no PDF viewer); download works.
- No notifications/reminders yet (expiry, pending approvals) — step 5 of the plan.
- Permit checklists and the 24 h default validity are product defaults, to be confirmed by the
  organisation's PTW procedure.
