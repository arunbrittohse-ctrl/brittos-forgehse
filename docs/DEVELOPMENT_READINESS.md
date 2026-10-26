# Development readiness checklist

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
