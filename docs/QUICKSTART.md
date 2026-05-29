# Quick Start — Deploy the Stampee API to the shared GCP VM

Fastest path to a running backend so you can create a business loyalty card.
Backend only: no SPA, no signup UI. You create the business → campaign →
customer → card with a few `curl` calls.

This assumes the VM already runs:

- a **Caddy** reverse proxy (with Cloudflare DNS in front), on a Docker network
- a **shared Postgres** (also used by Strapi), on another Docker network

Stampee adds only its **API container** (+ a one-shot migrator). It lives in its
own `loyalty` schema inside the shared Postgres, so it never touches Strapi's
`public` schema. No app code changes are needed — the API sets
`search_path = loyalty, public` on every connection and the migrator creates the
schema itself.

> For purely local dev with a self-contained Postgres + Caddy, use
> `infra/docker-compose.yml` instead. This guide uses `infra/docker-compose.prod.yml`.

---

## 0. Discover your VM specifics

SSH into the VM and grab the real values you'll plug into the env files:

```bash
# The two external Docker networks — note the Caddy one (web) and Postgres one (data):
docker network ls

# Confirm the Postgres container's data network + the name/alias to use as DB host:
docker inspect <postgres-container> --format '{{json .NetworkSettings.Networks}}'
```

You also need:

- the **existing database name** that will host the `loyalty` schema
- a Postgres **superuser/owner login** (to create the dedicated Stampee role)
- the **API hostname** to expose (e.g. `api.lealtad.<your-domain>`), already
  pointed at the VM in Cloudflare DNS

---

## 1. Get the API image (on the VM)

You can either pull the image built by CI (recommended) or build it on the VM.

**Option A — pull from GHCR (recommended).** GitHub Actions builds and pushes
`ghcr.io/mega61/stampee-api:latest` (and a `:<sha>` tag) on every push to `main`
that touches `api/`, `db/migrations/`, or the Dockerfile
(see `.github/workflows/build-api.yml`). On the VM, log in once and pull:

```bash
# A GitHub Personal Access Token with read:packages scope (only needed if the
# package is private; make it public in the repo's Packages settings to skip).
echo "$GHCR_TOKEN" | docker login ghcr.io -u <github-user> --password-stdin
docker pull ghcr.io/mega61/stampee-api:latest
```
Then set `API_IMAGE=ghcr.io/mega61/stampee-api:latest` in `infra/.env.prod`
(pin a `:<sha>` tag for reproducible deploys).

**Option B — build on the VM.** The build context **must be the repo root**
(the image copies both `api/` and `db/migrations/`):

```bash
git clone https://github.com/Mega61/stampee.git /opt/stampee
cd /opt/stampee
docker build -f infra/Dockerfile.api -t stampee-api:0.1.0 .
```
Then set `API_IMAGE=stampee-api:0.1.0` in `infra/.env.prod`.

---

## 2. Create the dedicated Postgres role

Connect to the shared Postgres as the superuser and create a login role for
Stampee. It only needs to create + use its own `loyalty` schema in the existing
database:

```sql
CREATE ROLE loyalty_user LOGIN PASSWORD '<a-strong-password>';
GRANT CONNECT, CREATE ON DATABASE <existing-db> TO loyalty_user;
```

The migrator (run in the next step) creates the `loyalty` schema and all its
tables/functions as this role.

---

## 3. Fill the env files (in `infra/`)

```bash
cd /opt/stampee/infra
cp .env.prod.example .env.prod
cp .env.api.example  .env.api
```

**`infra/.env.prod`** — compose substitution:

```ini
API_IMAGE=ghcr.io/mega61/stampee-api:latest   # or stampee-api:0.1.0 if built locally
WEB_NETWORK=<caddy-network-from-step-0>
DATA_NETWORK=<postgres-network-from-step-0>
```

**`infra/.env.api`** — API config. Set at minimum:

```ini
NODE_ENV=production
PORT=3001

# Reaches the shared Postgres over the data network. Host = the Postgres
# container name/alias on that network. Same DB as Strapi; Stampee uses the
# loyalty schema (handled automatically).
DATABASE_URL=postgres://loyalty_user:<password>@<postgres-host>:5432/<existing-db>
PG_POOL_SIZE=10

# Both must be >=32 chars. Use fresh random values.
JWT_ACCESS_SECRET=<32+ random chars>
JWT_REFRESH_SECRET=<32+ random chars>
JWT_ACCESS_TTL=15m
JWT_REFRESH_TTL=30d

# Behind Caddy/Cloudflare (HTTPS). Host-only cookie is fine.
COOKIE_SECURE=true
COOKIE_DOMAIN=

BCRYPT_COST=12
PIN_BCRYPT_COST=10

# Public URLs (must be valid URLs). API_PUBLIC_URL is the one that matters for
# API-only; SPA_ORIGIN/APP_PUBLIC_URL can point at the future SPA host.
API_PUBLIC_URL=https://api.lealtad.<your-domain>
SPA_ORIGIN=https://lealtad.<your-domain>
APP_PUBLIC_URL=https://lealtad.<your-domain>

# Email: 'console' just logs (fine for the curl flow). Switch to 'resend' +
# a real key when you want signup verification emails to actually send.
EMAIL_ADAPTER=console
RESEND_API_KEY=
EMAIL_FROM=Stampee <no-reply@lealtad.<your-domain>>

# GCS image uploads. Leave GCS_BUCKET blank to disable uploads for now, or set
# it up via section 7 below. The VM's attached service account supplies
# credentials (ADC), so leave GOOGLE_APPLICATION_CREDENTIALS empty.
GCS_BUCKET=
GCS_PROJECT_ID=
GOOGLE_APPLICATION_CREDENTIALS=
GCS_PUBLIC_HOST=https://storage.googleapis.com

LOG_LEVEL=info
```

---

## 4. Bring it up

```bash
cd /opt/stampee/infra
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d
```

The `migrate` service runs first, applies the migrations, and exits; then `api`
starts. Confirm migrations applied:

```bash
docker logs stampee-migrate      # should list "apply 0001_..." etc.
docker logs -f stampee-api       # "listening" with no Postgres errors
```

---

## 5. Route it through Caddy

Add a site block to your **central Caddyfile** and reload Caddy. This works
because `stampee-api` shares the `web` network with Caddy:

```caddy
api.lealtad.<your-domain> {
    reverse_proxy stampee-api:3001
}
```

Reload Caddy (adjust to your setup):

```bash
docker exec <caddy-container> caddy reload --config /etc/caddy/Caddyfile
```

Verify end to end (TLS terminated by Cloudflare/Caddy):

```bash
curl https://api.lealtad.<your-domain>/health      # -> {"ok":true,...} 200
```

---

## 6. Create the business + first card (curl)

Auth is cookie-based, so use a cookie jar. Set your base URL once:

```bash
BASE=https://api.lealtad.<your-domain>
```

**1) Sign up the owner.** (slug = 3–30 lowercase letters/numbers/hyphens.)
The API lets an unverified owner log in immediately, so no email step is needed
for this flow.

```bash
curl -s -X POST $BASE/auth/signup -H "Content-Type: application/json" -d '{
  "email": "you@yourbiz.com",
  "password": "ChangeMe123",
  "businessName": "Your Business",
  "slug": "your-biz"
}'
```

**2) Log in** — stores auth cookies in `jar.txt`:

```bash
curl -s -c jar.txt -X POST $BASE/auth/login -H "Content-Type: application/json" -d '{
  "email": "you@yourbiz.com",
  "password": "ChangeMe123"
}'
```

**3) Create the campaign** (the loyalty-card template). Note the returned `id`:

```bash
curl -s -b jar.txt -X POST $BASE/campaigns -H "Content-Type: application/json" -d '{
  "name": "Coffee Loyalty",
  "description": "Buy 10 coffees, get the 11th free.",
  "rewardName": "Free Coffee",
  "tagline": "Stamp & sip.",
  "totalStamps": 10,
  "iconKey": "Coffee",
  "colors": {"primary":"#7c5e3c","secondary":"#f5e6d3","text":"#2b1d0e","accent":"#c79b6b"},
  "isEnabled": true
}'
```

**4) Create a customer.** Note the returned `id`:

```bash
curl -s -b jar.txt -X POST $BASE/customers -H "Content-Type: application/json" -d '{
  "name": "Walk In Customer",
  "email": "customer@example.com",
  "status": "Active"
}'
```

**5) Issue the card** using the two ids from above:

```bash
curl -s -b jar.txt -X POST $BASE/cards -H "Content-Type: application/json" -d '{
  "customerId": "<CUSTOMER_ID>",
  "campaignId": "<CAMPAIGN_ID>"
}'
```

The response includes the card's public `uniqueId`. Card created. ✅

**Sanity check** — list customers with their cards + history:

```bash
curl -s -b jar.txt "$BASE/customers?include=cards,transactions"
```

---

## 7. (Optional) Enable image uploads — GCS bucket

Campaign **logos/backgrounds** are stored in a **private** GCS bucket and served
through short-lived **V4 signed URLs** (no public objects). Uploads are also
presigned: the SPA `PUT`s the file straight to GCS using a signed URL from
`POST /storage/campaign-assets/presign`. Signing is done server-side with the
VM's service account via the IAM `signBlob` API — **no JSON keys** (the org has
`iam.disableServiceAccountKeyCreation`).

Skip this for the curl-only card flow; do it when you bring up the SPA or want
logos. Set names first:

```bash
PROJECT=<your-gcp-project>
BUCKET=<your-bucket-name>          # globally unique
REGION=us-east1                    # pick one close to your users
SA=media-writer@$PROJECT.iam.gserviceaccount.com   # the VM's attached service account
```

1. **Create a private, uniform-access bucket:**
   ```bash
   gcloud storage buckets create gs://$BUCKET \
     --project=$PROJECT --location=$REGION \
     --uniform-bucket-level-access --public-access-prevention
   ```
2. **Let the service account read/write objects:**
   ```bash
   gcloud storage buckets add-iam-policy-binding gs://$BUCKET \
     --member="serviceAccount:$SA" --role="roles/storage.objectAdmin"
   ```
3. **Let it sign URLs without a key** (impersonate itself for `signBlob`):
   ```bash
   gcloud iam service-accounts add-iam-policy-binding $SA \
     --member="serviceAccount:$SA" \
     --role="roles/iam.serviceAccountTokenCreator"
   ```
   Make sure the VM actually runs as (or can impersonate) this SA — simplest is
   to attach `media-writer` as the VM's service account.
4. **CORS** so the browser can `PUT` uploads and `GET` signed reads. Save as
   `cors.json` (the API requires `Content-Type` + `Cache-Control` on uploads):
   ```json
   [
     {
       "origin": ["https://lealtad.<your-domain>"],
       "method": ["GET", "PUT"],
       "responseHeader": ["Content-Type", "Cache-Control"],
       "maxAgeSeconds": 3600
     }
   ]
   ```
   ```bash
   gcloud storage buckets update gs://$BUCKET --cors-file=cors.json
   ```
5. **Wire it in `infra/.env.api`** and restart the API:
   ```ini
   GCS_BUCKET=<your-bucket-name>
   GCS_PROJECT_ID=<your-gcp-project>
   GOOGLE_APPLICATION_CREDENTIALS=        # blank — uses the VM service account (ADC)
   GCS_PUBLIC_HOST=https://storage.googleapis.com
   ```
   ```bash
   docker compose --env-file .env.prod -f docker-compose.prod.yml up -d
   ```

Quick check (API-only, no SPA): request a signed upload URL —
```bash
curl -s -b jar.txt -X POST $BASE/storage/campaign-assets/presign \
  -H "Content-Type: application/json" \
  -d '{"kind":"logo","contentType":"image/png","sizeBytes":12345}'
```
A 200 with an `uploadUrl` means signing works. (Limits: logo ≤ 2 MB jpg/png/webp/svg,
background ≤ 6 MB jpg/png/webp.)

> **Local dev note:** signing needs a real identity. Run
> `gcloud auth application-default login` and either impersonate
> (`--impersonate-service-account=$SA`) or grant your own user
> `roles/iam.serviceAccountTokenCreator` on the SA.

---

## Ops & next steps

- **Logs**: `docker logs -f stampee-api`
- **Re-run migrations** (idempotent): from `infra/`
  `docker compose --env-file .env.prod -f docker-compose.prod.yml run --rm migrate`
- **Deploy a new build**: rebuild the image with a new tag, bump `API_IMAGE`
  in `.env.prod`, then `docker compose --env-file .env.prod -f docker-compose.prod.yml up -d`
- **Add the web UI later**: build the SPA (`npm run build` at repo root) and add
  a static `file_server` site for `lealtad.<domain>` in the central Caddyfile.
  Switch `EMAIL_ADAPTER=resend` (+ a real `RESEND_API_KEY`) so signup
  verification emails send; the verify-email link flips the owner's `status` to
  `verified`.
- **Enable logo/image uploads**: follow section 7 (GCS bucket).
