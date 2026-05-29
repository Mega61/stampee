# Testing guide — Stampee self-host fork

Everything you need to verify that Stampee works, top to bottom. Five layers,
each independently runnable; a clear progression from "the schema is real" up
to "a customer can sign up and stamp their card through a browser."

## Current state

| Layer | Status | Files |
|---|---|---|
| 1 — Schema | ✅ **Built** | `api/test/helpers/db.ts`, `api/test/schema.test.ts` (11 tests) |
| 2 — API integration | ✅ **Built** | `api/test/helpers/app.ts` + `auth.test.ts`, `staff.test.ts`, `cards.test.ts`, `public.test.ts`, `storage.test.ts`, `scope.test.ts` (60 tests) |
| 3 — Frontend smoke | 📝 Spec only | no `e2e/` specs, `@playwright/test` not installed |
| 4 — Manual checklist | ✅ **Runnable** | the checklist further down — needs a human + staging |
| 5 — Data parity | 📝 Spec only | no `scripts/migrate-from-supabase.ts` (only needed if porting Supabase data) |

`npm test` from `api/` → **71 passing tests across 7 files, ~65-80s** (most
of that is testcontainer cold-start; each file gets its own fresh Postgres
for isolation, so the only state leakage you can get is via the singleton
modules — which is why the rig uses dynamic imports).

Layers 3 and 5 still need to be authored. When a layer flips from 📝 to ✅,
update this table.

---

## TL;DR

```bash
# Layer 1 — schema (vitest, isolated Postgres per test file)
cd api && npm run test:schema

# Layer 2 — API integration (vitest + fastify.inject + testcontainers)
cd api && npm test

# Layer 3 — frontend smoke (Playwright, drives a real Chromium against the local stack)
npx playwright test

# Layer 4 — manual checklist
# See "Layer 4 — Manual click-through" below; ~15 minutes against staging.

# Layer 5 — data parity (only relevant if migrating live Supabase data)
node scripts/migrate-from-supabase.ts
```

---

## Test stack at a glance

| Layer                  | Tool                                                                               | Scope                                                                                               | Where it runs                   | Speed         |
| ---------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------- | ------------- |
| **1. Schema**          | vitest + `@testcontainers/postgresql`                                              | DB tables, FKs, triggers, the three DB-resident RPCs                                                | CI + local                      | ~10s per file |
| **2. API integration** | vitest + `fastify.inject()` + testcontainers Postgres + in-memory email + fake GCS | every HTTP route, role guards, full auth + card lifecycle                                           | CI + local                      | ~30-60s total |
| **3. Frontend smoke**  | Playwright                                                                         | user-visible flows through a real Chromium                                                          | CI nightly + local              | 2-5 min       |
| **4. Manual**          | a human + a browser                                                                | what automation can't catch (real email arriving, GCS console state, cookie attributes in DevTools) | pre-deploy, on staging          | ~15 min       |
| **5. Data parity**     | Node script + SQL diff                                                             | one-shot Supabase → loyalty.* port + row-count validation                                           | once, only if porting prod data | minutes       |

---

## Local prerequisites

You need:

- Docker Desktop (running)
- Node 20+
- The dev stack from `infra/docker-compose.dev.yml` (just Postgres)
- The API installed (`cd api && npm install`)
- The SPA installed (root `npm install`)

Bring up Postgres + bootstrap the dev DB:

```bash
docker compose -f infra/docker-compose.dev.yml up -d
# Apply migrations once (the runner is idempotent — safe to re-run)
MIGRATIONS_DIR=../db/migrations npm --prefix api run migrate
# Optional: load the seed (one owner, one staff, two campaigns, three customers)
docker compose -f infra/docker-compose.dev.yml exec -T postgres \
  psql -U loyalty_user -d appdb -v ON_ERROR_STOP=1 < db/seed/dev.sql
```

Connection details:

- Postgres: `postgres://loyalty_user:loyalty_pw@localhost:5433/appdb`
- API: `http://localhost:3001`
- SPA dev: `http://localhost:3000`
- Seed owner: `admin@stampee.local` / `Admin1234` (slug `demo`)
- Seed staff: `staff@stampee.local` / PIN `1234` (orgId `demo`)

---

## Layer 1 — Schema tests

**Why**: The DB schema is the source of truth. Tables, FKs, triggers, and the
three RPCs that stayed in Postgres (`prevent_issuing_disabled_campaign_card`,
`register_public_campaign_signup`, `delete_campaign_preserve_cards`) must
behave the same regardless of which app calls them.

**Where**: `api/test/schema.test.ts`. Uses `@testcontainers/postgresql` to spin
a fresh Postgres container per test file — guarantees a clean slate.

### Setup

Already wired — `vitest` and `@testcontainers/postgresql` are in
`api/devDependencies`, and `api/vitest.config.ts` sets the timeouts
testcontainers needs (`testTimeout: 30s`, `hookTimeout: 60s`). Just write
the test file.

`api/test/helpers/db.ts`:

```ts
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';

export const MIGRATIONS_DIR = new URL('../../../db/migrations', import.meta.url).pathname;
export const SEED_FILE = new URL('../../../db/seed/dev.sql', import.meta.url).pathname;

export interface TestDb {
  container: StartedPostgreSqlContainer;
  pool: pg.Pool;
  reset(): Promise<void>;
  stop(): Promise<void>;
}

export const setupTestDb = async (): Promise<TestDb> => {
  const container = await new PostgreSqlContainer('postgres:16')
    .withDatabase('appdb')
    .withUsername('loyalty_user')
    .withPassword('loyalty_pw')
    .start();

  const pool = new pg.Pool({ connectionString: container.getConnectionUri() });
  pool.on('connect', (c) => c.query('set search_path = loyalty, public'));

  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) {
    await pool.query(readFileSync(join(MIGRATIONS_DIR, f), 'utf-8'));
  }

  return {
    container,
    pool,
    async reset() {
      await pool.query('truncate loyalty.transactions, loyalty.issued_cards, loyalty.customers, loyalty.campaigns, loyalty.profiles, loyalty.users restart identity cascade');
    },
    async stop() {
      await pool.end();
      await container.stop();
    },
  };
};
```

### What to assert (`api/test/schema.test.ts`)

- Every expected table exists in the `loyalty` schema (query
  `information_schema.tables`).
- Every column has the expected type and nullability
  (`information_schema.columns`).
- Foreign keys are present with the right `ON DELETE` action
  (`information_schema.referential_constraints`).
- The `issued_cards_block_disabled_campaign` BEFORE-INSERT trigger exists
  (`pg_trigger`).
- The seed loads cleanly; row counts match: 2 users, 2 profiles, 2 campaigns,
  3 customers, 3 issued cards, 7 transactions.
- `loyalty.register_public_campaign_signup(...)` happy-path returns
  `outcome='issued'`; same email a second time returns `outcome='redirect_existing'`.
- `loyalty.delete_campaign_preserve_cards(campaign_id, caller_user_id)`
  snapshots `template_snapshot` and nullifies `campaign_id` atomically;
  wrong `caller_user_id` raises an exception.
- Direct `INSERT INTO loyalty.issued_cards` referencing a disabled campaign
  raises `CAMPAIGN_DISABLED`.

### What passing looks like

```
 ✓ schema > tables exist in loyalty schema
 ✓ schema > foreign keys have correct ON DELETE rules
 ✓ schema > register_public_campaign_signup handles happy path + dedup
 ✓ schema > delete_campaign_preserve_cards is atomic + ownership-checked
 ✓ schema > prevent_issuing_disabled_campaign_card trigger fires
Test Files  1 passed (1)
     Tests  8 passed (8)
```

### Reference: what's already smoke-verified manually

Phase 1 of the migration plan ran the equivalent assertions live via psql
(T1-T8 in the plan execution log). Re-running those scripts is a fallback if
the vitest layer is not yet in place:

```bash
bash docs/scripts/phase1-smoke.sh  # not committed — rebuild from the plan if needed
```

---

## Layer 2 — API integration tests

**Why**: Every HTTP endpoint, every role guard, the full auth lifecycle, the
public signup matrix, the storage validation paths, and the authZ negatives
(no existence leaks across tenants).

**Where**: `api/test/{auth,staff,cards,public,storage,scope}.test.ts`. Uses
`fastify.inject()` so there's no real HTTP socket — sub-millisecond per call.
Postgres comes from the same testcontainer helper from layer 1. Email is an
in-memory collector; GCS is a fake that records calls without contacting GCP.

### Setup

Already wired (see Layer 1 setup). The same vitest config covers integration
tests. Add adapter override hooks to `src/email/index.ts` and
`src/storage/gcs.ts` so the test rig can swap them out — see the test rig
sketch below.

`api/test/helpers/app.ts`:

```ts
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/server.js';
import type { TestDb } from './db.js';

export interface TestRig {
  app: FastifyInstance;
  emails: Array<{ to: string; subject: string; text: string; html: string }>;
  presignedCalls: Array<{ path: string; contentType: string }>;
  // override the singleton GCS / email modules at test boot via env or via
  // a small ports adapter you wire into src/email/index.ts + src/storage/gcs.ts
}

export const buildTestRig = async (db: TestDb): Promise<TestRig> => {
  process.env.DATABASE_URL = db.container.getConnectionUri();
  process.env.EMAIL_ADAPTER = 'test';
  // ... set the other required env vars (JWT_*, SPA_ORIGIN, etc.)
  const app = await buildApp();
  return { app, emails: [], presignedCalls: [] };
};
```

> Implementation note: to swap email + storage adapters cleanly for tests, the
> simplest pattern is to expose `setEmailAdapter()` / `setStorageAdapter()`
> from their respective `src/email/index.ts` and `src/storage/gcs.ts` and
> call them from the test rig. Avoids monkeypatching imports.

### Test inventory

**Auth lifecycle** (`auth.test.ts`):
- signup → assert `emails[0]` contains a `/auth/verify-email?token=...` URL
- GET that URL → 302 to `/login?verified=1`; profile now `status='verified'`
- login → assert `set-cookie` for both `access` and `refresh` (HttpOnly, SameSite=Lax)
- `GET /auth/me` → returns user + owner + staffAccounts
- `POST /auth/refresh` → rotates; old refresh token is now revoked
- `POST /auth/logout` → cookies cleared

**Password reset** (`auth.test.ts`):
- `POST /auth/forgot-password` → email captured with reset URL
- `POST /auth/reset-password` → 200; old password rejected; new password works

**Staff** (`staff.test.ts`):
- Owner `POST /staff` → welcome email contains PIN
- Staff logs in via `POST /auth/staff-login` (email + PIN + orgId/slug)
- `PATCH /staff/:id/pin` → old PIN fails, new PIN succeeds, old refresh tokens revoked
- `PATCH /staff/:id/access` disabled → next staff login → `ACCOUNT_DISABLED`
- `DELETE /staff/:id` → cascades to user + profile + refresh_tokens

**Card lifecycle** (`cards.test.ts`):
- Owner creates campaign → creates customer → issues card
- POST stamp transactions (server overrides `actor_*` from JWT — assert)
- POST redeem; PATCH `status='Redeemed'`; final state matches

**Public signup matrix** (`public.test.ts`) — must cover ALL five outcomes:
- new customer + enabled campaign → `outcome='issued'`
- same email second time → `outcome='redirect_existing'` (same uniqueId)
- same mobile second time → `outcome='redirect_existing'`
- disabled campaign + no existing card → `outcome='campaign_disabled_no_existing'`
- disabled campaign + existing card → `outcome='redirect_existing'`

**Public card view** (`public.test.ts`):
- `GET /public/cards/:slug/:uniqueId` returns full nested camelCase shape
- Wrong slug → 404 (not 403; no existence leak)

**Storage** (`storage.test.ts`):
- Presign valid request → URL + path with correct `{ownerId}/{kind}/{uuid}.{ext}` prefix
- Bad mime → 400
- Oversize → 400
- DELETE path under another owner → 403
- DELETE path with `..` traversal → 400

**AuthZ negatives** (`scope.test.ts` — the most security-critical tier):
- Staff hits `DELETE /campaigns/:id` → 403
- Owner A mutates owner B's card → 404 (not 403, to avoid existence leak)
- Anonymous on any non-public route → 401
- Expired access cookie + valid refresh → `/auth/refresh` succeeds
- Expired access cookie + missing refresh → 401
- Tampered access cookie (signature break) → 401

### Run

```bash
cd api
npm test                       # one-shot — all test files
npm run test:watch             # rerun on save
npm run test:schema            # only schema.test.ts (or any file matching "schema")
npm run test:integration       # everything except schema.test.ts
npx vitest run public          # ad-hoc filter to public*.test.ts
```

### What passing looks like

```
 Test Files  6 passed (6)
      Tests  ~50 passed (~50)
   Start at  10:24:11
   Duration  42.3s
```

### Already smoke-verified manually

Phase 3-7 covered these flows live via curl. Re-running the curl smoke scripts
(in the plan execution log) verifies the same code paths. Phase 7's live GCS
roundtrip is the one piece **deferred to the VM** because local dev has no
ADC for the `media-writer` SA — see "Layer 4" for the manual GCS check.

---

## Layer 3 — Frontend smoke (Playwright)

**Why**: vitest verifies the server contract; Playwright verifies the contract
holds in a real browser — cookies, CORS, redirects, image loading, the SPA
router. Catches things server tests can't: forgotten `credentials: 'include'`,
a button that scrolls offscreen, a redirect that loops.

**Where**: `e2e/*.spec.ts`. `e2e/playwright.config.ts` brings up the full
stack via compose before tests run.

### Setup

```bash
npm install --save-dev @playwright/test
npx playwright install chromium
```

`e2e/playwright.config.ts`:

```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  use: { baseURL: 'http://localhost:3000', trace: 'on-first-retry' },
  webServer: [
    {
      command: 'docker compose -f ../infra/docker-compose.dev.yml up -d',
      reuseExistingServer: true,
    },
    {
      command: 'cd ../api && npm run dev',
      url: 'http://localhost:3001/health',
      reuseExistingServer: true,
      env: { EMAIL_ADAPTER: 'console' },
    },
    {
      command: 'cd .. && npm run dev',
      url: 'http://localhost:3000',
      reuseExistingServer: true,
    },
  ],
});
```

### Flows to cover (`e2e/*.spec.ts`)

| File                     | Flow                                                                                                                                               |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth.spec.ts`           | Signup → grab verify token from API log via test-only `GET /__test/last-email` → click verify → land on `/login?verified=1` → log in.              |
| `auth.spec.ts`           | Forgot-password → grab reset URL → set new password → log in.                                                                                      |
| `owner-flow.spec.ts`     | Owner creates a campaign, uploads a 1 MB PNG logo (or stubs the upload if GCS isn't reachable), saves, reloads, image renders from the signed URL. |
| `card-lifecycle.spec.ts` | Owner issues a card → adds stamps via the UI → redeems → status flips to Redeemed.                                                                 |
| `staff.spec.ts`          | Staff logs in via `/<slug>/staff` with email + PIN → adds a stamp → confirms `DELETE` UI is hidden on campaigns.                                   |
| `public.spec.ts`         | Open `/<slug>/<uniqueId>` in a fresh context (no cookies) → card renders with logo + stamps + customer name.                                       |
| `public.spec.ts`         | Public campaign signup form submits → user lands on the issued-card view.                                                                          |

### Test-only API helper

Playwright needs to pull verify/reset URLs out of the email stream without a
real inbox. Add this to the API only when `NODE_ENV=test`:

```ts
if (env.NODE_ENV === 'test') {
  app.get('/__test/last-email', async () => ({ ok: true, data: lastEmail }));
}
```

The email-test adapter pushes each send into a single `lastEmail` slot the
helper returns.

### Run

```bash
npx playwright test                      # headless
npx playwright test --ui                 # interactive runner
npx playwright test owner-flow.spec.ts   # one file
npx playwright show-report               # last run's HTML report
```

### What passing looks like

```
Running 7 tests using 1 worker
  ✓  1 [chromium] › auth.spec.ts:3:1 › signup → verify → login (4.2s)
  ✓  2 [chromium] › card-lifecycle.spec.ts:5:1 › issue → stamp → redeem (3.8s)
  ...
  7 passed (28s)
```

---

## Layer 4 — Manual click-through (pre-deploy)

**Why**: Some things automation just won't catch — real Resend emails landing,
GCS console showing the right object, cookies in DevTools, cross-tab logout
propagating. Run this checklist against **staging** before flipping prod, and
once on prod after a release.

This is the canonical pre-release checklist. Print it, check off as you go.

### Pre-flight (~2 min)

- [ ] `infra/.env`, `infra/.env.api`, `infra/.env.postgres` exist on the VM
      and contain the staging values (not example placeholders).
- [ ] DNS for `lealtad.example.com` / `api.lealtad.example.com` resolves to
      the VM IP (`dig +short`).
- [ ] `docker compose ps` shows `postgres healthy`, `migrate` exited 0,
      `api` running, `caddy` running.
- [ ] `curl -I https://api.lealtad.example.com/health` → `200`, cert valid.

### Auth flows (~5 min)

- [ ] **Signup**: open `https://lealtad.example.com/signup` in a fresh
      private window. Submit with a real email you control. Confirm the
      Resend dashboard shows the verify email (or check the console log if
      EMAIL_ADAPTER=console). Click the link. Land on
      `/login?verified=1`. Log in. Dashboard renders.
- [ ] **Forgot-password**: log out. Click "Forgot password." Submit email.
      Click the reset link in email. Set a new password. Log in with the new
      password. Old password rejected.
- [ ] **Staff invite**: as the owner, create a staff member with PIN `1234`.
      Confirm staff welcome email shows the PIN. Log out. From a separate
      browser, go to `https://lealtad.example.com/<your-slug>/staff` and log
      in with email + PIN + slug. Lands on issued-cards page.
- [ ] **Disable staff**: as owner, set staff access to disabled. Staff next
      login attempt → "This account is disabled."

### Campaign + card flows (~3 min)

- [ ] **Create campaign**: edit colors, upload a 4 MB PNG background.
      DevTools Network shows `PUT https://storage.googleapis.com/...`
      returning 200. Reload — image renders.
- [ ] **GCS console**: confirm the object exists under
      `gbs-apps-media/<your-owner-id>/background/...`, with cache headers
      set to `public, max-age=31536000, immutable`.
- [ ] **Disable campaign**: toggle off. As staff or owner, try to issue a
      card from the kiosk for that campaign — UI shows "campaign disabled."
      In DevTools Network, the call returned `409 CAMPAIGN_DISABLED`.
- [ ] **Re-enable + issue**: toggle on, issue a card. Card uniqueId shows in
      the issued-cards list.
- [ ] **Stamps + redeem**: add stamps until complete, redeem. Card status
      flips to Redeemed. History shows your actor_role in each transaction.

### Public surface (~2 min)

- [ ] **Anonymous card view**: copy a card's `/:slug/:uniqueId` URL. Open in
      a fresh private window with no cookies. Card renders with the logo
      (signed URL) + stamps + customer name. View source — no Supabase URLs
      anywhere, no auth headers needed.
- [ ] **Public campaign signup**: open `/:slug/join/:campaignId`. Submit a
      new name + email. Lands on the new card view. Submit the same email
      again → lands on the same card (server returned `redirect_existing`).

### Security checks (~2 min)

- [ ] **DevTools → Application → Cookies** for `api.lealtad.example.com`:
      `access` and `refresh` both **HttpOnly + Secure + SameSite=Lax**,
      `Domain=.lealtad.example.com`.
- [ ] **Cross-tab logout**: open dashboard in two tabs. Log out in one. The
      other tab's next API call should 401 and redirect to `/login`.
- [ ] **Tamper a cookie**: in DevTools, edit the `access` cookie value
      (corrupt the signature). Next API call → 401 → refresh attempt → if
      refresh cookie is intact, succeed (cookie regenerated); if you also
      corrupted refresh, redirect to login.
- [ ] **AuthZ smoke** (in a terminal):
      ```bash
      # Login as owner; capture cookies.
      curl -c jar -H 'Content-Type: application/json' \
        -X POST https://api.lealtad.example.com/auth/staff-login \
        -d '{"email":"<staff-email>","pin":"1234","orgId":"<your-slug>"}'
      # As staff, try to delete a campaign — expect 403.
      curl -b jar -X DELETE https://api.lealtad.example.com/campaigns/<id>
      ```

### Operations sanity (~1 min)

- [ ] `docker compose --env-file .env logs --tail=200 api` shows no `FATAL`
      lines since the last deploy.
- [ ] `./infra/backup.sh` runs without error; new `.dump` appears in the
      GCS bucket.
- [ ] Migrate is idempotent: `docker compose --env-file .env run --rm migrate`
      → "applied 0, skipped N".

If every box is checked, you're ready to ship.

---

## Layer 5 — Data parity (only if porting live Supabase data)

**Why**: If there's a Supabase project with real data, you need a one-shot
import + a diff to prove no rows were lost. Skip this if you're starting
fresh.

**Where**: `scripts/migrate-from-supabase.ts` (TBD — not implemented yet).

### Strategy summary

1. `pg_dump --schema=public --data-only --no-owner` from the Supabase project,
   excluding `license_keys` (dropped in this fork) and the demo seed.
2. For every row in dumped `public.profiles`:
   - Insert a `loyalty.users` row with a **sentinel password_hash** that no
     bcrypt comparison will satisfy (forces reset).
   - Issue a `loyalty.password_reset_tokens` row.
   - Insert `loyalty.profiles` with the same `id`, `status='verified'`
     (trust Supabase's verification), drop `tier` / `tier_expires_at`.
3. Insert `loyalty.campaigns`, `loyalty.customers`, `loyalty.issued_cards`,
   `loyalty.transactions` from the dumps as-is.
4. **Storage URL rewrite** (the gotcha that bites hardest):
   - Enumerate every URL referenced in:
     - `campaigns.logo_image`, `campaigns.background_image`
     - `issued_cards.template_snapshot.logoImage`
     - `issued_cards.template_snapshot.backgroundImage`
   - For each Supabase-storage URL, download the bytes → upload to GCS at
     `${ownerId}/${kind}/${uuid}.${ext}` → rewrite the column to the **path**
     (signed-GET URLs are generated on read; do not store URLs).
   - Wrap each owner's rewrites in a transaction.
5. Batch-send password-reset emails via Resend to every imported owner.

### Row-count diff

```bash
# After import, in a single psql session against both databases:
\c supabase_export
select 'profiles' t, count(*) from public.profiles
union all select 'campaigns', count(*) from public.campaigns
union all select 'customers', count(*) from public.customers
union all select 'issued_cards', count(*) from public.issued_cards
union all select 'transactions', count(*) from public.transactions;

\c stampee_loyalty
select 'profiles' t, count(*) from loyalty.profiles where role='owner'
union all select 'campaigns', count(*) from loyalty.campaigns
union all select 'customers', count(*) from loyalty.customers
union all select 'issued_cards', count(*) from loyalty.issued_cards
union all select 'transactions', count(*) from loyalty.transactions;
```

Counts must match except for the dropped tables (license_keys) and the
intentionally-skipped demo seed.

---

## Pre-merge checklist (PR author)

Before opening a PR or hitting "Squash and merge":

- [ ] `cd api && npm run typecheck`
- [ ] `cd api && npm run build`
- [ ] `cd api && npm test` (layers 1 + 2)
- [ ] `npm --prefix . run build` (SPA Vite build)
- [ ] If you touched routes or SPA pages: `npx playwright test` (layer 3)
- [ ] If you touched the schema: `MIGRATIONS_DIR=../db/migrations npm --prefix api run migrate` against a fresh `down -v` Postgres — must apply cleanly.

---

## Pre-deploy checklist (release manager)

- [ ] Tag the API image: `docker build -f infra/Dockerfile.api -t stampee-api:<version> .`
- [ ] Push to registry; bump `API_IMAGE=` in `infra/.env` on the VM.
- [ ] Build the SPA: `npm run build`; ship `dist/` to `/srv/spa-releases/<sha>/` and update the symlink.
- [ ] `cd infra && ./deploy.sh` — runs migrate one-shot first, then rolls api + caddy.
- [ ] Run **Layer 4** against staging.
- [ ] If staging passes: repeat against prod.

---

## Troubleshooting / known sharp edges

| Symptom                                                                   | Likely cause                                                                                                                                        | Fix                                                                                                            |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `SigningError: Cannot sign data without 'client_email'` on presign        | No ADC available — running locally without `gcloud auth application-default login`, or the VM SA missing `iam.serviceAccountTokenCreator` on itself | Grant the role-binding, or impersonate via gcloud locally                                                      |
| CORS preflight returns `Access-Control-Allow-Origin` for the wrong origin | `SPA_ORIGIN` in `.env.api` does not match where the SPA actually runs                                                                               | Align; restart API (`tsx watch` does NOT pick up `.env` changes)                                               |
| `409 CAMPAIGN_DISABLED` on every card issue                               | DB trigger correctly firing, but UI didn't refresh the campaign enabled state                                                                       | Reload campaigns list; expected behavior                                                                       |
| Staff PINs no longer work after migration from Supabase                   | Bcrypt one-way; PINs can't be recovered                                                                                                             | Owner must reset all staff PINs post-migration                                                                 |
| Cross-tab logout doesn't propagate                                        | `BroadcastChannel` blocked by older browser                                                                                                         | Confirm Chrome/Firefox/Safari ≥ 2022. The auth state will still reconcile on next API call when refresh fails. |
| Refresh-token race across tabs logs one tab out                           | Known — Phase 3 ships basic rotation without grace window                                                                                           | Future: add 30s grace per plan §G.13                                                                           |
| `pg@8` DeprecationWarning about `client.query()`                          | Cosmetic, from `pool.on('connect')` setting search_path                                                                                             | Fix by moving search_path into the connection string `options=-c search_path=loyalty,public`                   |
| Vite picks a port other than 3000                                         | Another process already on 3000                                                                                                                     | Either free 3000 or update `SPA_ORIGIN` + `APP_PUBLIC_URL` in API env to match                                 |
| `docker compose run --rm migrate` exits 1 with FK violation               | A migration changed an FK on a table with existing rows                                                                                             | Add a data-migration in a new numbered SQL file, not in-place edits to existing files                          |

---

## What's already covered

The migration plan execution (see
`C:\Users\Juanes\.claude\plans\read-the-claude-stampeemigration-md-and-transient-wren.md`)
ran live smoke equivalents for most of layers 1-2 during phases 1-9. Specifically:

- **Phase 1** — schema applied + 8 functional assertions (all DB-resident logic).
- **Phase 3** — full auth lifecycle, 18 curl checks.
- **Phase 4** — staff + tenant scope, 14 curl checks.
- **Phase 5** — domain routes + cross-tenant isolation, 21 checks.
- **Phase 6** — public surface + rate-limit, 12 checks.
- **Phase 7** — storage validation paths, 10 checks. (Live GCS roundtrip deferred to VM.)
- **Phase 8** — SPA → API integration via CORS + cookies, end-to-end.
- **Phase 9** — migrate runner idempotent across local + image runs.

Those scripts were ad-hoc and not committed. The vitest suites in layers 1-2
are the durable, CI-runnable replacement.

---

## Owners

- **Schema tests** — whoever touches `db/migrations/*.sql`.
- **API integration tests** — whoever touches `api/src/routes/*.ts`.
- **Playwright** — whoever touches SPA components or routes.
- **Manual checklist** — release manager.
- **Data parity** — only the person doing the one-shot Supabase port.

---

## Command map (this guide ↔ `package.json`)

Every npm/npx command this guide references and where it's defined. Run
`node -e "console.log(require('./api/package.json').scripts)"` from the
repo root to inspect anytime.

| Command in guide | Defined in | Script |
|---|---|---|
| `npm test` | `api/package.json` | `vitest run` |
| `npm run test:watch` | `api/package.json` | `vitest` |
| `npm run test:schema` | `api/package.json` | `vitest run schema` |
| `npm run test:integration` | `api/package.json` | `vitest run --exclude=**/schema.test.ts` |
| `npm run typecheck` | `api/package.json` | `tsc --noEmit` |
| `npm run build` (in api/) | `api/package.json` | `tsc -p tsconfig.json` |
| `npm run dev` (in api/) | `api/package.json` | `tsx watch src/server.ts` |
| `npm run migrate` | `api/package.json` | `tsx src/scripts/migrate.ts` |
| `npm run migrate:prod` | `api/package.json` | `node dist/scripts/migrate.js` |
| `npm run build` (in root) | `package.json` (root) | SPA Vite build |
| `npm run dev` (in root) | `package.json` (root) | SPA Vite dev server |
| `npx playwright test` | requires `npm install --save-dev @playwright/test` at repo root | — |
| `npx vitest run <pattern>` | provided by `vitest` devDep | filter ad-hoc |
