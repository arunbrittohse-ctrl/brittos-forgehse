# Deploying FORGEHSE

## 1. Prerequisites

- A Linux host with Docker, or a container platform.
- PostgreSQL 14+; managed is recommended, or use the `db` service in `docker-compose.yml`.
- A domain and TLS certificate. Production **requires HTTPS**: the server will not start with `COOKIE_SECURE=false` when `NODE_ENV=production`.
- Optionally, an Anthropic API key for the assistant.

## 2. First deployment

```bash
cp .env.example .env            # fill in POSTGRES_PASSWORD, CORS_ORIGINS, ANTHROPIC_API_KEY …
docker compose build
docker compose up -d db
docker compose run --rm migrate
docker compose run --rm -e SEED_ORG_NAME="Your Co LLC" -e SEED_ORG_SLUG=your-co \
  -e SEED_ADMIN_EMAIL=you@yourco.com -e SEED_ADMIN_PASSWORD='<12+ chars, letter+digit>' \
  app node dist/cli/seed.js      # bootstrap org + Super Administrator (no demo data)
docker compose up -d app
curl -fsS http://127.0.0.1:4000/api/ready
```

Put a reverse proxy in front of port 4000 to terminate TLS and forward `X-Forwarded-For`. When `NODE_ENV=production`, the API uses the first `X-Forwarded-For` address for rate limiting and audit, so **only expose the app through the proxy**.

The administrator must change their password at first sign-in. They then create projects, sites and users from the web app.

### Without Docker

```bash
npm ci && npm run build
MIGRATIONS_DIR=apps/api/migrations node apps/api/dist/cli/migrate.js up
WEB_DIST_DIR=apps/web/dist MIGRATIONS_DIR=apps/api/migrations node apps/api/dist/server.js
```

Run it under systemd or a process manager, with the environment taken from a secrets store.

## 3. Configuration and secrets

All configuration comes from environment variables (see `.env.example`). Keep `.env` out of version control, or inject the variables from your platform's secret manager. Never place `ANTHROPIC_API_KEY` in client builds. To make AI cost estimates trustworthy, copy `config/ai-pricing.example.json`, verify every price against Anthropic's official pricing page, set `"verified": true`, mount the file and set `AI_PRICING_FILE`.

## 4. Upgrades and migrations

1. Take a backup (section 5).
2. `docker compose build && docker compose run --rm migrate`. Each migration file is applied atomically. A migration that was edited after being applied is refused.
3. `docker compose up -d app`.

## 5. Backups and restore

`scripts/backup.sh` writes a `pg_dump` custom-format dump and a tarball of uploaded files, keeping 30 days locally. Schedule it nightly, for example with cron:

```
15 1 * * * DATABASE_URL=… STORAGE_DIR=/var/lib/docker/volumes/forgehse_storage/_data BACKUP_DIR=/backups /opt/forgehse/scripts/backup.sh
```

Copy backups off the host (object storage with versioning and encryption). **Test a restore at least quarterly:**

```bash
createdb forgehse_restore_test
DATABASE_URL=…/forgehse_restore_test ./scripts/restore.sh /backups/forgehse-db-<stamp>.dump /backups/forgehse-files-<stamp>.tar.gz /tmp/restore-files
```

The restore path was exercised during the build: database and files were restored into a fresh database, and the row counts matched.

## 6. Monitoring

- **Liveness:** `GET /api/health`. **Readiness:** `GET /api/ready`, which checks database connectivity and the number of applied migrations. The Dockerfile HEALTHCHECK uses `/api/ready`.
- **Logs:** one JSON line per request on stdout, with request id, method, path, status, latency and IP. Bodies, tokens and prompts are never logged. Unhandled errors are logged with a reference id that the user also sees. Ship stdout to your log platform and alert on `level=error` and on 5xx rates.
- **AI:** the *AI usage* page (admins) shows errors, latency and cache hit rate, and failed calls are recorded with their error code.
- **Security events to alert on:** bursts of `auth.login_failed` in `audit_log`, and any `user.permissions_changed`.

## 7. Rollback

- **Application:** redeploy the previous image tag (`FORGEHSE_VERSION=<previous> docker compose up -d app`). Migrations are additive, so the previous version runs on the newer schema unless the release notes say otherwise.
- **Schema:** to undo the most recent migration, run `docker compose run --rm migrate node dist/cli/migrate.js down`. Down migrations **drop data** in the affected tables, so restore from backup instead if those tables already hold production records.
- **Full rollback:** stop the app, restore the pre-upgrade backup into a fresh database, point `DATABASE_URL` at it, and start the previous image.

## 8. Scaling notes

The API is stateless apart from two things:

1. Uploaded files use local disk. Implement the `ObjectStorage` interface for S3 or MinIO before running more than one instance.
2. Rate limiters are in-memory. Move them to Redis before running more than one instance.

Database connections are pooled (`DB_POOL_MAX`).

## 9. Android app

```bash
cd apps/mobile
npm install && npx expo install --fix        # aligns native module versions with the Expo SDK
# set "extra.apiUrl" in app.json to your HTTPS API origin
npx expo run:android                          # dev build on a device/emulator
npx eas build --platform android --profile preview   # installable APK via EAS
```

Android blocks cleartext HTTP by default, so the API must be served over HTTPS. Sign release builds with your own keystore (EAS manages it by default).
