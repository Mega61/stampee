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

Stampee adds only its two containers (+ a one-shot migrator). It runs in its
**own database** inside the shared Postgres instance (separate from Strapi's), so
the two never touch. No app code changes are needed — the migrator creates a
`loyalty` schema inside that database and the API sets `search_path = loyalty,
public` per connection.

> For purely local dev with a self-contained Postgres + Caddy, use
> `infra/docker-compose.yml` instead. This guide uses `infra/docker-compose.prod.yml`.

---

## 0. Prerequisites (same shared infra as Strapi)

This stack reuses exactly what your Strapi stack already uses:

- external Docker networks **`web`** (Caddy) and **`data`** (Postgres) — confirm
  with `docker network ls`
- the shared Postgres reachable at host **`postgres-transversal`** on `data`
- a Postgres **superuser login** (to create Stampee's database + role)
- two **hostnames** already pointed at the VM in Cloudflare DNS:
  - `loyalty.goldenbeautystudio.com.co` — the Admin UI / customer pages (SPA)
  - `api.loyalty.goldenbeautystudio.com.co` — the API

If any of those names differ on your VM, adjust the compose file / env vars
accordingly (`STAMPEE_DB_HOST`, the `networks:` block).

---

## 1. Publish the images (CI) and let Portainer pull them

GitHub Actions builds and pushes both images on every push to `main`:
`ghcr.io/mega61/stampee-api` and `ghcr.io/mega61/stampee-spa` (`:latest` + a
`:<sha>` tag) — see `.github/workflows/build-api.yml` and `build-spa.yml`. The
Portainer stack pulls these by tag, exactly like the Strapi stack does.

Make sure Portainer can pull them — either:
- make the two GHCR packages **public** (repo → Packages → package → visibility), or
- add a registry in **Portainer → Registries** (`ghcr.io`, your GitHub user, a
  PAT with `read:packages`).

> **The SPA bakes its API URL at build time.** Vite inlines `VITE_API_URL` into
> the JS bundle when the image is built (like Strapi's `STRAPI_ADMIN_BACKEND_URL`).
> It's already set to `https://api.loyalty.goldenbeautystudio.com.co` /
> `https://loyalty.goldenbeautystudio.com.co` in `.github/workflows/build-spa.yml`.
> Changing the API domain later means rebuilding the SPA image.

---

## 2. Create Stampee's database + role

Stampee gets its **own database** in the shared Postgres instance (separate from
Strapi's), owned by a dedicated login role. Run the SQL as a Postgres superuser.

First find the Postgres container and open a `psql` shell inside it:

```bash
docker ps                                              # find the Postgres container name
docker exec -it <postgres-container> psql -U <superuser> -d postgres
```

`<superuser>` is the Postgres admin role — usually `postgres`, or the
`POSTGRES_USER` the container was started with. `-it` gives an interactive shell;
`-d postgres` connects to the default admin database. At the `postgres=#` prompt:

```sql
CREATE ROLE loyalty_user LOGIN PASSWORD '<a-strong-password>';
CREATE DATABASE stampee OWNER loyalty_user;
\q
```

As the **owner** of `stampee`, `loyalty_user` can create the `loyalty` schema and
the `pgcrypto`/`citext` extensions itself (both are trusted on Postgres 16), so
the migrator runs without superuser rights.

> One-shot alternative (no interactive shell — pipe the SQL in with `-i`):
> ```bash
> docker exec -i <postgres-container> psql -U <superuser> -d postgres <<'SQL'
> CREATE ROLE loyalty_user LOGIN PASSWORD '<a-strong-password>';
> CREATE DATABASE stampee OWNER loyalty_user;
> SQL
> ```

---

## 3. Deploy the stack in Portainer

In **Portainer → Stacks → Add stack**, name it `stampee`, choose the **Web editor**,
and paste the contents of [`infra/docker-compose.prod.yml`](../infra/docker-compose.prod.yml).
It mirrors your Strapi stack: hardcoded GHCR images, inline `environment:`, and the
same external `web` + `data` networks (Postgres host `postgres-transversal`).

Under **Environment variables** add the three secrets (this is why there's no
`.env` file — Portainer injects them):

| Name                  | Value                                    |
| --------------------- | ---------------------------------------- |
| `STAMPEE_DB_PASSWORD` | the `loyalty_user` password from step 2  |
| `JWT_ACCESS_SECRET`   | a fresh ≥32-char random string           |
| `JWT_REFRESH_SECRET`  | a different fresh ≥32-char random string |

Everything else (DB user/host/name, public URLs, ports) is already baked into the
compose file with sensible defaults — override only if needed
(`STAMPEE_DB_USER`, `STAMPEE_DB_NAME`, `STAMPEE_DB_HOST`, `RESEND_API_KEY`,
`GCS_BUCKET`, `GCS_PROJECT_ID`). Then click **Deploy the stack**.

The stack starts three containers:
- `stampee-migrate` — applies migrations, then **exits 0** (shows as "exited" in
  Portainer — that's expected, not a crash; check its logs show `apply 0001_…`)
- `stampee-api` — the backend (waits for migrate to finish)
- `stampee-spa` — the Admin + customer UI

> Password caveat: `DATABASE_URL` is assembled as a URL, so keep
> `STAMPEE_DB_PASSWORD` URL-safe (letters/digits/`-_`) or URL-encode special
> characters.
>
> CLI alternative (no Portainer): `cp infra/.env.prod.example infra/.env.prod`,
> fill it, then
> `docker compose --env-file infra/.env.prod -f infra/docker-compose.prod.yml up -d`.

---

## 4. Route both hostnames through Caddy

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

## 5. Bootstrap your owner account (one-time)

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

## 6. Manage everything in the Admin UI

Open **`https://loyalty.goldenbeautystudio.com.co/login`** and sign in with the
owner email + password from step 5. You land on the dashboard. From the sidebar:

| Do this                                                    | Where                                                                                                                                            |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Create a loyalty card**                                  | **Gallery** → pick a template → **Card Editor**: set name, reward, number of stamps, colors, icon, (logo/background if GCS is set up) → **Save** |
| Enable/disable or delete a card                            | **Campaigns**                                                                                                                                    |
| **Issue a card** to a customer, **add stamps**, **redeem** | **Issued Cards** (this is the day-to-day counter screen)                                                                                         |
| Add / edit customers                                       | **Customers**                                                                                                                                    |
| Create **staff** logins (name + PIN)                       | **Settings**                                                                                                                                     |
| See activity & stats                                       | **Analytics** / **Transactions**                                                                                                                 |
| Change business name, slug, password                       | **Settings**                                                                                                                                     |

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

## 7. (Optional) Enable image uploads — GCS bucket

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
5. **Wire it into the stack.** In Portainer, add two **Environment variables**
   to the `stampee` stack and redeploy:
   ```
   GCS_BUCKET=<your-bucket-name>     # the $BUCKET value above
   GCS_PROJECT_ID=<your-project-id> # the $PROJECT value above
   ```
   (`GOOGLE_APPLICATION_CREDENTIALS` stays empty — the API uses the VM's service
   account via ADC.) Redeploy the stack to pick them up.

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

## 8. (Optional) Google Workspace SSO

Add a **"Sign in with Google"** button to the owner `/login` (and staff portal)
that only accepts accounts on your Workspace domain
(`goldenbeautystudio.com.co`). It uses the Google Identity Services **ID-token**
flow — authentication only, no Google API access — so there's **no client secret
and no redirect URI** to manage.

1. **Create the OAuth client (Google Cloud Console).** Go to **APIs & Services →
   Credentials → Create credentials → OAuth client ID** and pick **Web
   application**. Under **Authorized JavaScript origins** add:
   - `https://loyalty.goldenbeautystudio.com.co`
   - `http://localhost:3000` (for local dev)

   Leave **Authorized redirect URIs** empty and ignore the client secret — the
   GIS ID-token flow needs neither. Create it and copy the **Client ID** (looks
   like `…apps.googleusercontent.com`). It's a public value, safe to commit/bake.

2. **Set the Client ID in two places** — the SPA build and the API runtime:
   - **(a) SPA build** — as `VITE_GOOGLE_CLIENT_ID`, so Vite bakes it into the
     bundle. Store it as the repo secret `VITE_GOOGLE_CLIENT_ID` (used by
     `.github/workflows/build-spa.yml`), or hardcode it there / pass it as a
     `--build-arg`. Because it's baked at build time, **changing the client ID
     requires rebuilding the SPA image** (re-push `main` so CI rebuilds).
   - **(b) API runtime** — add the `GOOGLE_CLIENT_ID` stack environment variable
     in Portainer (used to verify incoming ID tokens). Also set
     `GOOGLE_WORKSPACE_DOMAIN=goldenbeautystudio.com.co` (it defaults to that in
     the compose file). Redeploy the stack to pick them up.

3. **Who can sign in.** Only Google **Workspace** accounts on the allowed domain
   are accepted: the API verifies the token server-side and requires a verified
   email plus a matching `hd` (hosted-domain) claim — **consumer Gmail accounts
   are rejected**. The **first** Workspace user to sign in becomes the owner
   (auto-provisioned, in place of the step 5 `curl` bootstrap); after an owner
   exists, unknown accounts are rejected.

If `VITE_GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_ID` are left empty, the Google button
simply doesn't appear and email/password login is unaffected.

---

## Ops & next steps

- **Logs**: in Portainer open the `stampee-api` / `stampee-spa` container logs
  (or `docker logs -f stampee-api`).
- **Deploy a new build**: CI pushes a new `:latest` on each merge to `main`. In
  Portainer, open the stack → **Update / Re-pull image** (or **Pull and redeploy**)
  to pick it up. Pin a `:<sha>` tag in the compose file for reproducible deploys.
- **Re-run migrations** (idempotent): re-deploying the stack re-runs the
  `stampee-migrate` one-shot; or `docker compose -f docker-compose.prod.yml run --rm stampee-migrate`.
- **Real emails** (password reset, verification): set `EMAIL_ADAPTER` to `resend`
  in the compose env + add `RESEND_API_KEY` as a stack env var, then redeploy.
- **Image uploads**: section 7 (GCS bucket).
