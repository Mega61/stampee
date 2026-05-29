# infra/

Production deploy for the self-hosted Stampee stack. One GCE VM, Caddy as the
TLS edge, Postgres + the Fastify API in containers, SPA dist served as static
files from a host-mounted volume.

## What's in here

| File | Purpose |
|---|---|
| `Dockerfile.api` | Multi-stage build for the Fastify API. Bakes `db/migrations/*.sql` into the image so the one-shot `migrate` service has them. |
| `docker-compose.yml` | Production stack: `postgres`, `migrate` (one-shot), `api`, `caddy`. |
| `Caddyfile` | Auto-HTTPS reverse proxy. Three sites (SPA static, API, Strapi — Strapi commented out for now). |
| `docker-compose.dev.yml` | Local dev: only Postgres. Used by the API test suite and `npm run dev`. |
| `.env.example`, `.env.api.example`, `.env.postgres.example` | Templates. Copy to gitignored siblings before bringing the stack up. |
| `deploy.sh` | Pull → migrate → restart api. Idempotent. |
| `backup.sh` | `pg_dump -Fc` of the `loyalty` schema, ship to GCS. Cron this. |

## First-time VM setup

1. **Provision a GCE VM** with the `media-writer` service account attached. The
   SA needs `roles/storage.objectAdmin` on `gbs-apps-media` and
   `roles/iam.serviceAccountTokenCreator` on itself (so it can sign GCS URLs
   via the IAM `signBlob` API). No JSON key is created — see
   `.claude/stampeeMigration.md` for the no-key rationale.

2. **Install Docker + Compose plugin**:
   ```bash
   sudo apt-get update && sudo apt-get install -y docker.io docker-compose-plugin
   sudo usermod -aG docker "$USER"
   ```
   Log out and back in.

3. **Open firewall** on TCP 80 + 443 only. Postgres and the API stay inside
   the bridge network and are never exposed to the public internet.

4. **Point DNS** for the three subdomains at the VM's external IP:
   ```
   lealtad.example.com.     A  <VM_IP>
   api.lealtad.example.com. A  <VM_IP>
   cms.example.com.         A  <VM_IP>
   ```

5. **Clone the repo to `/opt/stampee`** (or wherever you want it):
   ```bash
   git clone https://github.com/<you>/stampee.git /opt/stampee
   cd /opt/stampee/infra
   ```

6. **Populate env files** from the templates:
   ```bash
   cp .env.example          .env
   cp .env.api.example      .env.api
   cp .env.postgres.example .env.postgres
   # Edit each — at minimum: API_IMAGE, *_DOMAIN, ACME_EMAIL,
   # POSTGRES_PASSWORD, DATABASE_URL, JWT_*, RESEND_API_KEY, COOKIE_DOMAIN.
   ```

7. **Build the SPA and place it at `/srv/spa/current`**. Two flows:

   a. *Build on the VM* (simplest):
   ```bash
   cd /opt/stampee
   npm ci
   npm run build
   sudo mkdir -p /srv/spa-releases/$(git rev-parse --short HEAD)
   sudo cp -r dist/* /srv/spa-releases/$(git rev-parse --short HEAD)/
   sudo ln -sfn /srv/spa-releases/$(git rev-parse --short HEAD) /srv/spa
   ```

   b. *Build on CI* and copy the tarball over:
   ```bash
   # On CI:  npm ci && npm run build && tar czf dist.tgz -C dist .
   # On VM:  mkdir /srv/spa-releases/$SHA && tar xzf dist.tgz -C /srv/spa-releases/$SHA
   #         ln -sfn /srv/spa-releases/$SHA /srv/spa
   ```

   Caddy's mount is `${SPA_DIST_DIR:-/srv/spa}:/srv/spa:ro`, so any symlink
   swap at `/srv/spa` takes effect on the next request without restarting
   Caddy.

8. **Build (or pull) the API image**:
   ```bash
   # Build locally on the VM:
   cd /opt/stampee
   docker build -f infra/Dockerfile.api -t stampee-api:0.1.0 .
   # Then set API_IMAGE=stampee-api:0.1.0 in infra/.env

   # OR pull from a registry (recommended once CI is wired):
   docker pull ghcr.io/<you>/stampee-api:0.1.0
   # Then set API_IMAGE=ghcr.io/<you>/stampee-api:0.1.0
   ```

9. **First deploy**:
   ```bash
   cd /opt/stampee/infra
   ./deploy.sh --no-pull   # since we just built locally
   ```

10. **Verify**:
   ```bash
   curl -I https://lealtad.example.com/        # 200
   curl -I https://api.lealtad.example.com/health  # 200 + cert valid
   ```

## Day-2 ops

- **Deploy a new API release**: bump `API_IMAGE=` in `.env`, then `./deploy.sh`.
- **Deploy a new SPA build**: rebuild dist, point the `/srv/spa` symlink at the new release dir. No restart needed.
- **Run migrations manually**: `docker compose --env-file .env run --rm migrate`. The runner is idempotent.
- **Tail logs**: `docker compose --env-file .env logs -f api`.
- **psql shell**: `docker compose --env-file .env exec postgres psql -U loyalty_user -d appdb`.
- **Reset to a clean DB** (destructive): `docker compose --env-file .env down -v && docker compose --env-file .env up -d` — then re-run `./deploy.sh`.

## Backups

`backup.sh` runs a `pg_dump -Fc` against the `loyalty` schema, writes it to
`/var/backups/stampee/`, and ships to a GCS bucket via `gsutil cp`. Cron it:

```cron
0 3 * * * /opt/stampee/infra/backup.sh >> /var/log/stampee-backup.log 2>&1
```

Bucket lifecycle (apply once via gcloud):
```bash
gcloud storage buckets update gs://stampee-backups --lifecycle-file=- <<'EOF'
{"lifecycle":{"rule":[{"action":{"type":"Delete"},"condition":{"age":90}}]}}
EOF
```

## Adding Strapi later

Strapi is intentionally not in `docker-compose.yml`. When you wire it in:

1. Add a `strapi` service that points at the same Postgres instance with a
   dedicated role (`strapi_user`) granted on `public` only — NOT on `loyalty`.
2. Uncomment the `{$CMS_DOMAIN}` block in `Caddyfile`.
3. Put both `api` and `strapi` on the same `app` network so Caddy can reach them.

The DB role isolation matters: a Strapi RCE shouldn't be able to read or
mutate loyalty data, and vice versa.

## What is NOT here

- CI workflow (deploy.yml) — wire up GitHub Actions to push images to GHCR and
  trigger `deploy.sh` via SSH when you're ready.
- Strapi service config.
- Observability stack (Prometheus, Grafana, Loki). The plan calls these out
  as future work.
- GCS signed-URL bucket lifecycle (handled by `media-writer` permissions, not
  by this stack).
