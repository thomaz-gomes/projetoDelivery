# Seed Import — Copy & Run on VPS

This document describes how to transfer the `prisma/seed_export.json` produced by `scripts/export_sqlite_to_json.mjs` from your local machine to the VPS and run the non-destructive import into the production Postgres database.

Prerequisites
- You have already exported the seed at `delivery-saas-backend/prisma/seed_export.json`.
- You have SSH access to the VPS and appropriate privileges to run `docker compose` or `psql` on the VPS.
- `scp` and `ssh` are available locally (Windows 10/11 ships OpenSSH; or use PuTTY/pscp).
- On the VPS, the production app is deployed using `docker compose -f docker-compose.prod.yml` and the `backend` service runs the Node backend.

High-level steps
1. Copy `prisma/seed_export.json` to the VPS (into the backend service folder).
2. Backup the current Postgres database on VPS.
3. Run `prisma db push` on the VPS to ensure schema fields are present (non-destructive).
4. Run the import script inside the `backend` container to upsert exported rows.

Recommended commands (example)

# Replace the placeholders below before running.

# 1) Copy seed to VPS
scp delivery-saas-backend/prisma/seed_export.json vps_user@vps_host:/home/vps_user/seed_export.json

# 2) SSH into VPS and move file into project folder (optional)
ssh vps_user@vps_host
# on VPS shell:
mkdir -p /srv/projetodelivery/delivery-saas-backend/prisma
mv /home/vps_user/seed_export.json /srv/projetodelivery/delivery-saas-backend/prisma/seed_export.json
cd /srv/projetodelivery

# 3) Backup Postgres (change DB credentials as needed)
# This creates a gzip dump under /srv/backups
mkdir -p /srv/backups
PGPASSWORD="$POSTGRES_PASSWORD" pg_dump -h localhost -U postgres -d projetodelivery | gzip > /srv/backups/projetodelivery-$(date +%Y%m%d%H%M%S).sql.gz

# 4) Ensure schema is applied (non-destructive)
# from project root on VPS
docker compose -f docker-compose.prod.yml run --rm backend sh -c "npx prisma db push --schema=prisma/schema.postgres.prisma"

# 5) Run importer inside backend container
# This will use the container environment so DATABASE_URL is set
docker compose -f docker-compose.prod.yml run --rm backend sh -c "npx prisma generate && node scripts/import_seed_from_json.mjs prisma/seed_export.json"

Notes and troubleshooting
- If `docker compose` on your VPS uses `docker-compose` (older) replace the command accordingly.
- If `pg_dump` isn't available or you cannot perform a dump, at minimum export a copy of `delivery_db` volume (stop containers first) or snapshot the volume.
- The importer script performs upserts by primary keys where possible. It aims to be non-destructive but you should always take a backup first.
- If some models fail due to schema differences, check `prisma/schema.postgres.prisma` and adjust the exported JSON or the schema accordingly.

Alternative: run import from host machine
- If you prefer, you can run the import on your local machine after setting `DATABASE_URL` to point to the VPS Postgres and ensuring network access, but this may require opening DB access and is less recommended than running the import from inside the VPS containers.

Questions? If you want, run the included PowerShell helper script `deploy_seed_to_vps.ps1` (next) which automates steps 1–5 (requires `scp`/`ssh`).
