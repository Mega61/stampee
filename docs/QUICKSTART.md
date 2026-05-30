# Quick Start — Deploy Stampee (API + Admin UI) on the shared GCP VM

Get the full Stampee stack running on the VM so you can **manage everything from
the web Admin UI** — create loyalty cards, issue them, add stamps, redeem, manage
customers and staff. No day-to-day `curl` needed; the only command-line step is a
one-time owner account bootstrap.

The deployment is two containers behind your existing edge:

- **API** (`stampee-api`) — the Fastify backend (JSON), on port 3001
- **SPA** (`stampee-spa`) — the React Admin UI + customer card pages (nginx), on port 80

This assumes the VM already runs:

- a **Caddy** reverse proxy (with Cloudflare DNS in front), on a Docker network
- a **shared Postgres** (also used by Strapi), on another Docker network

Stampee adds only its two containers (+ a one-shot migrator). It lives in its own
`loyalty` schema inside the shared Postgres, so it never touches Strapi's `public`
schema. No app code changes are needed — the API sets `search_path = loyalty,
public` on every connection and the migrator creates the schema itself.

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
- two **hostnames**, already pointed at the VM in Cloudflare DNS:
  - `loyalty.goldenbeautystudio.com.co` — the Admin UI / customer pages (SPA)
  - `api.loyalty.goldenbeautystudio.com.co` — the API

---

## 1. Get both images (on the VM)

Pull the CI-built images (recommended) or build them on the VM.

**Option A — pull from GHCR (recommended).** GitHub Actions builds and pushes
`ghcr.io/mega61/stampee-api` and `ghcr.io/mega61/stampee-spa` (`:latest` and a
`:<sha>` tag) on push to `main` (see `.github/workflows/build-api.yml` and
`build-spa.yml`). On the VM:

```bash
# PAT with read:packages scope (skip the login if you make the packages public).
echo "$GHCR_TOKEN" | docker login ghcr.io -u <github-user> --password-stdin
docker pull ghcr.io/mega61/stampee-api:latest
docker pull ghcr.io/mega61/stampee-spa:latest
```

> **The SPA bakes its API URL at build time.** Vite inlines `VITE_API_URL` into
> the JS bundle when the image is built (like Strapi's `STRAPI_ADMIN_BACKEND_URL`).
> The build workflow is already set to `https://api.loyalty.goldenbeautystudio.com.co`
> / `https://loyalty.goldenbeautystudio.com.co` in `.github/workflows/build-spa.yml`.
> Changing the API domain later means rebuilding the SPA image.

**Option B — build on the VM.** Build context **must be the repo root**:

```bash
git clone https://github.com/Mega61/stampee.git /opt/stampee
cd /opt/stampee
docker build -f infra/Dockerfile.api -t stampee-api:0.1.0 .
docker build -f infra/Dockerfile.spa -t stampee-spa:0.1.0 \
  --build-arg VITE_API_URL=https://api.loyalty.goldenbeautystudio.com.co \
  --build-arg VITE_APP_URL=https://loyalty.goldenbeautystudio.com.co .
```
Then set `API_IMAGE`/`SPA_IMAGE` accordingly in `infra/.env.prod`.

---

## 2. Create the dedicated Postgres role

Connect to the shared Postgres as the superuser and create a login role for
Stampee. It only needs to create + use its own `loyalty` schema in the existing
database:

```sql
CREATE ROLE loyalty_user LOGIN PASSWORD '<a-strong-password>';
GRANT CONNECT, CREATE ON DATABASE <existing-db> TO loyalty_user;
```

The migrator (next step) creates the `loyalty` schema and all its tables/functions
as this role.

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
SPA_IMAGE=ghcr.io/mega61/stampee-spa:latest   # or stampee-spa:0.1.0 if built locally
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

# Public URLs (must be valid URLs). SPA_ORIGIN MUST equal the Admin UI's URL —
# the API only accepts browser requests (CORS) from this origin.
API_PUBLIC_URL=https://api.loyalty.goldenbeautystudio.com.co
SPA_ORIGIN=https://loyalty.goldenbeautystudio.com.co
APP_PUBLIC_URL=https://loyalty.goldenbeautystudio.com.co

# Email: 'console' just logs the message (incl. the owner verify link) to the
# API logs — fine to start. Switch to 'resend' + a real key for real emails.
EMAIL_ADAPTER=console
RESEND_API_KEY=
EMAIL_FROM=Stampee <no-reply@loyalty.goldenbeautystudio.com.co>

# GCS image uploads. Leave GCS_BUCKET blank to start (solid-color cards work
# without it); set it up via section 8 when you want logo/background uploads.
GCS_BUCKET=
GCS_PROJECT_ID=
GOOGLE_APPLICATION_CREDENTIALS=
GCS_PUBLIC_HOST=https://storage.googleapis.com

LOG_LEVEL=info
```

---

## 4. Bring up the stack

```bash
cd /opt/stampee/infra
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d
```

This starts `migrate` (applies migrations, then exits), `api`, and `spa`. Confirm:

```bash
docker logs stampee-migrate      # should list "apply 0001_..." etc.
docker logs -f stampee-api       # "listening" with no Postgres errors
docker ps                        # stampee-api and stampee-spa running
```

---

## 5. Route both hostnames through Caddy

Add two site blocks to your **central Caddyfile** and reload. This works because
`stampee-api` and `stampee-spa` share the `web` network with Caddy:

```caddy
loyalty.goldenbeautystudio.com.co {
    reverse_proxy stampee-spa:80
}

api.loyalty.goldenbeautystudio.com.co {
    reverse_proxy stampee-api:3001
}
```

Reload Caddy (adjust to your setup):

```bash
docker exec <caddy-container> caddy reload --config /etc/caddy/Caddyfile
```

Verify (TLS terminated by Cloudflare/Caddy):

```bash
curl https://api.loyalty.goldenbeautystudio.com.co/health   # -> {"ok":true,...} 200
curl -I https://loyalty.goldenbeautystudio.com.co/          # -> 200, serves the SPA
```

---

## 6. Bootstrap your owner account (one-time)

Stampee is single-business by design — the Admin UI has **no public sign-up**
(the login page is "owner access only"). So create the one owner account with a
single API call, then never touch the API again:

```bash
BASE=https://api.loyalty.goldenbeautystudio.com.co
curl -s -X POST $BASE/auth/signup -H "Content-Type: application/json" -d '{
  "email": "you@goldenbeautystudio.com.co",
  "password": "<a-strong-password>",
  "businessName": "Golden Beauty Studio",
  "slug": "golden-beauty"
}'
```

- `slug` = 3–30 lowercase letters/numbers/hyphens. It's your business's public
  path (e.g. `loyalty.goldenbeautystudio.com.co/golden-beauty/<card-id>`).
- You can log in immediately — email verification is **not** required to use the
  dashboard (you'll just see a "verify" banner).
- **Optional — clear the verify banner:** with `EMAIL_ADAPTER=console`, the
  verification link is printed to `docker logs stampee-api`. Open it once to mark
  the owner verified. (Or set `EMAIL_ADAPTER=resend` + a key to email it for real.)

---

## 7. Manage everything in the Admin UI

Open **`https://loyalty.goldenbeautystudio.com.co/login`** and sign in with the
owner email + password from step 6. You land on the dashboard. From the sidebar:

| Do this | Where |
|---|---|
| **Create a loyalty card** | **Gallery** → pick a template → **Card Editor**: set name, reward, number of stamps, colors, icon, (logo/background if GCS is set up) → **Save** |
| Enable/disable or delete a card | **Campaigns** |
| **Issue a card** to a customer, **add stamps**, **redeem** | **Issued Cards** (this is the day-to-day counter screen) |
| Add / edit customers | **Customers** |
| Create **staff** logins (name + PIN) | **Settings** |
| See activity & stats | **Analytics** / **Transactions** |
| Change business name, slug, password | **Settings** |

Customer- and staff-facing pages (no login needed for customers):

- **Customer card**: `loyalty.goldenbeautystudio.com.co/<slug>/<uniqueId>` — the
  digital stamp card a customer opens (QR-friendly).
- **Public self-signup** (optional): `…/<slug>/join/<campaignId>` — customers
  enroll themselves and get a card.
- **Staff portal**: `…/<slug>/staff` — staff sign in with email + PIN to add
  stamps; `…/<slug>/scan/<uniqueId>` is the QR-scan entry point.

That's the whole management workflow — all in the browser.

> Prefer automation? The same actions are plain REST endpoints
> (`POST /campaigns`, `POST /customers`, `POST /cards`,
> `POST /cards/:id/transactions`, …) under `api.loyalty.goldenbeautystudio.com.co`,
> using the cookie set by `POST /auth/login`. Not needed for normal use.

---

## 8. (Optional) Enable image uploads — GCS bucket

Needed only if you want to upload **logos/backgrounds** in the Card Editor
(solid-color cards work without it). Images live in a **private** GCS bucket and
are served through short-lived **V4 signed URLs** (no public objects). Uploads are
presigned too: the browser `PUT`s straight to GCS. Signing is done server-side
with the VM's service account via the IAM `signBlob` API — **no JSON keys**.

**Run these on the VM** (where the attached service account + ADC live).

> ⚠️ **VM access scope (read this first).** Using the **default Compute Engine
> service account** only works if the VM was created with the **`cloud-platform`**
> access scope. The GCE *default* scope grants storage **read-only**, which blocks
> both uploads and URL signing. Check it:
> ```bash
> gcloud compute instances describe <vm-name> --zone <zone> \
>   --format='value(serviceAccounts.scopes)'
> ```
> If you don't see `https://www.googleapis.com/auth/cloud-platform`, set it (the
> VM must be stopped):
> ```bash
> gcloud compute instances stop <vm-name> --zone <zone>
> gcloud compute instances set-service-account <vm-name> --zone <zone> \
>   --scopes=cloud-platform
> gcloud compute instances start <vm-name> --zone <zone>
> ```

Set the two values up top; the SA is derived automatically:

```bash
PROJECT=$(gcloud config get-value project)   # or: PROJECT=<your-project-id>
BUCKET=<your-globally-unique-bucket-name>
REGION=us-central1
SPA_ORIGIN=https://loyalty.goldenbeautystudio.com.co

# The VM's default Compute Engine service account:
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')
SA="$PROJECT_NUMBER-compute@developer.gserviceaccount.com"
echo "Using service account: $SA"
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
3. **Let it sign URLs without a key** (call `signBlob` as itself):
   ```bash
   gcloud iam service-accounts add-iam-policy-binding $SA \
     --member="serviceAccount:$SA" \
     --role="roles/iam.serviceAccountTokenCreator"
   ```
4. **CORS** so the browser can `PUT` uploads and `GET` signed reads (the API
   requires `Content-Type` + `Cache-Control` on uploads):
   ```bash
   cat > cors.json <<EOF
   [
     {
       "origin": ["$SPA_ORIGIN"],
       "method": ["GET", "PUT"],
       "responseHeader": ["Content-Type", "Cache-Control"],
       "maxAgeSeconds": 3600
     }
   ]
   EOF
   gcloud storage buckets update gs://$BUCKET --cors-file=cors.json
   ```
5. **Wire it in `infra/.env.api`** and restart the API:
   ```ini
   GCS_BUCKET=<your-bucket-name>          # the $BUCKET value above
   GCS_PROJECT_ID=<your-project-id>       # the $PROJECT value above
   GOOGLE_APPLICATION_CREDENTIALS=        # blank — uses the VM service account (ADC)
   GCS_PUBLIC_HOST=https://storage.googleapis.com
   ```
   ```bash
   docker compose --env-file .env.prod -f docker-compose.prod.yml up -d
   ```

Now logo/background upload works in the Card Editor. A 403 mentioning `signBlob`
or `iam.serviceAccounts.signBlob` (visible in `docker logs stampee-api`) means the
scope/role above isn't in effect yet. (Limits: logo ≤ 2 MB jpg/png/webp/svg,
background ≤ 6 MB jpg/png/webp.)

> **Org policy note:** if your org enforces `iam.disableServiceAccountKeyCreation`
> (no JSON keys), this signBlob approach is exactly what you want — it signs with
> the live identity, no key file. If `signBlob` stays denied on the default SA,
> the fallback is a dedicated `media-writer` SA granted the same two roles and
> attached to the VM.

---

## Ops & next steps

- **Logs**: `docker logs -f stampee-api` / `docker logs -f stampee-spa`
- **Re-run migrations** (idempotent): from `infra/`
  `docker compose --env-file .env.prod -f docker-compose.prod.yml run --rm migrate`
- **Deploy a new build**: rebuild/repull the image with a new tag, bump
  `API_IMAGE`/`SPA_IMAGE` in `.env.prod`, then
  `docker compose --env-file .env.prod -f docker-compose.prod.yml up -d`
- **Real emails** (password reset, verification): set `EMAIL_ADAPTER=resend` +
  `RESEND_API_KEY` in `.env.api` and restart.
- **Image uploads**: section 8 (GCS bucket).
