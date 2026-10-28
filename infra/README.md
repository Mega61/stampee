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

## Media bucket CORS (uploads + card theming)

The browser talks to the media bucket (`GCS_BUCKET`) directly: it `PUT`s
uploads to presigned URLs, and the public card reads the uploaded background
photo's pixels (`crossOrigin="anonymous"` image → 16×16 canvas) so card
effects can adapt to how light/busy the photo is (`lib/card/imageLuma.ts`,
docs/CARD_ENGAGEMENT_PLAN.md §5.0). Both need CORS for the SPA origin. Without
`GET` the card still works, it just falls back to quieter, overlay-only effects.

`gsutil cors set` **replaces** the whole CORS config, so keep `PUT` in it:

```bash
cat > cors.json <<'EOF'
[
  {
    "origin": ["https://loyalty.goldenbeautystudio.com.co"],
    "method": ["GET", "PUT"],
    "responseHeader": ["Content-Type", "Cache-Control"],
    "maxAgeSeconds": 3600
  }
]
EOF
gsutil cors set cors.json gs://gbs-apps-media
gsutil cors get gs://gbs-apps-media   # verify
```

Use your own `SPA_ORIGIN` and bucket name (add `http://localhost:3000` to
`origin` to test sampling against the real bucket from a dev server).

## Google Wallet setup

Clients can save their card to Google Wallet, and the pass's stamp count
updates whenever the card changes (docs/CARD_ENGAGEMENT_PLAN.md §7.3). It is
off until the three `GOOGLE_WALLET_*` credentials below are set: the public
card asks `GET /public/wallet/config` and shows no button while it says
`{ google: false }`.

1. **Issuer account.** In the [Google Pay & Wallet Console](https://pay.google.com/business/console)
   create a business profile and open **Google Wallet API**. Note the
   **Issuer ID** (a long number) → `GOOGLE_WALLET_ISSUER_ID`.
2. **Service account.** In a Google Cloud project, enable the *Google Wallet
   API* (`walletobjects.googleapis.com`) and create a service account (e.g.
   `wallet-issuer@<project>.iam.gserviceaccount.com`) → `GOOGLE_WALLET_SA_EMAIL`.
   It needs no IAM role in the project.
3. **Grant it access.** Back in the Wallet console → *Users*, invite the
   service-account email with the **Developer** role, so it can create and
   update classes/objects for this issuer.
4. **Key.** Create a JSON key for that service account and copy its
   `private_key` (the `-----BEGIN PRIVATE KEY-----…` PEM) into
   `GOOGLE_WALLET_SA_KEY`. One line with `\n` escapes is fine; quote it. The
   key is needed to sign the "save" link. Production uses the service account
   `stampee-wallet@gbs-infra.iam.gserviceaccount.com` (Wallet API enabled on
   `gbs-infra`, where `iam.disableServiceAccountKeyCreation` is not enforced).
5. **Optional:** `GOOGLE_WALLET_CLASS_PREFIX` (default `stampee`) namespaces
   class/object ids — use a different one for staging if it shares the issuer.
6. Restart the API. Until Google approves the issuer for production, only
   accounts added as testers in the console can save passes ("demo mode").

What gets created: one *LoyaltyClass* per campaign (business name, campaign
name, logo from `/public/brand/<slug>/icon-512.png`, card color) and one
*LoyaltyObject* per card, created the first time the client taps the button.
Stamp changes (`PATCH /cards/:id`, transactions, gift stamps, game wins) patch
the object about a second later; failures are logged, never shown to staff.
Google must be able to fetch the logo, so `API_PUBLIC_URL` must be public.

## Apple Wallet setup

iPhone clients get an "Agregar a Apple Wallet" button instead of the Google
one; the pass updates itself (stamp count, redeemed) whenever the card
changes, with a lock-screen notice ("Ahora tienes 5/10 sellos"). It is off
until the `APPLE_*` variables below are set: `GET /public/wallet/config` says
`{ apple: false }`, the button is hidden and every Apple route 404s.

1. **Apple Developer Program.** Enroll the business at
   [developer.apple.com/programs](https://developer.apple.com/programs/)
   (USD 99/year; an organization needs a D-U-N-S number). Note the
   **Team ID** (Membership details, 10 characters) → `APPLE_TEAM_ID`.
2. **Pass Type ID.** *Certificates, Identifiers & Profiles → Identifiers → +
   → Pass Type IDs*, e.g. `pass.com.goldenbeauty.loyalty` →
   `APPLE_PASS_TYPE_ID`. It is permanent and appears inside every pass.
3. **Certificate.** On any machine, create a key + signing request:

   ```bash
   openssl req -new -newkey rsa:2048 -nodes \
     -keyout pass.key -out pass.csr -subj "/CN=Stampee Pass/O=Golden Beauty"
   ```

   In the portal open the Pass Type ID → *Create Certificate*, upload
   `pass.csr`, download `pass.cer` and convert it to PEM:

   ```bash
   openssl x509 -inform DER -in pass.cer -out pass.pem
   ```

   (If you created the CSR with Keychain Access instead, export the
   certificate + key as `pass.p12` and run
   `openssl pkcs12 -in pass.p12 -clcerts -nokeys -out pass.pem` and
   `openssl pkcs12 -in pass.p12 -nocerts -nodes -out pass.key`; add `-legacy`
   with OpenSSL 3 if it complains about RC2.)
   `pass.pem` → `APPLE_PASS_CERT`, `pass.key` → `APPLE_PASS_KEY`. If you keep
   the key encrypted, put its password in `APPLE_PASS_KEY_PASSPHRASE`. The
   certificate expires after a year: renew it before then (same Pass Type ID,
   existing passes keep working).
4. **WWDR G4.** Download *Worldwide Developer Relations - G4* from
   [apple.com/certificateauthority](https://www.apple.com/certificateauthority/)
   and convert it: `openssl x509 -inform DER -in AppleWWDRCAG4.cer -out wwdr.pem`
   → `APPLE_WWDR_CERT`.
5. **Env.** PEMs can be pasted as one line with `\n` escapes (quote them):
   `awk 'NF {printf "%s\\n", $0}' pass.pem`. Leave `APPLE_APNS_HOST` at
   `api.push.apple.com`.
6. **Public HTTPS.** Wallet talks to the PassKit web service at
   `${API_PUBLIC_URL}/wallet/apple` (registrations, updated passes, logs).
   It must be reachable over HTTPS with a valid certificate (Caddy already
   does this for `API_DOMAIN`), and outbound HTTP/2 to `api.push.apple.com:443`
   must be allowed from the API container.
7. Restart the API and add a card from Safari on an iPhone.

How it works: the first tap downloads a signed `.pkpass` (serial number = the
card's unique id) and records it in `wallet_passes` with a per-pass
`auth_token`. Wallet registers the device (`wallet_devices`). After a stamp
change, `onCardChanged` bumps the pass's `updated_at` and sends an empty APNs
push (topic = the Pass Type ID, authenticated with the same certificate) to
each registered device; Wallet then fetches the new pass. Devices APNs reports
as gone (410) are dropped. Colors come from the live campaign; the icon and
logo are the same brand mark as the home-screen icon.

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
