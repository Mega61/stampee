# Manual walkthrough — Stampee, end to end

A hands-on tour. You'll spin up the full stack locally, drive every feature
through a browser, and watch what each click does on the server and in the
database. Treat this as the "Layer 3 Playwright spec written for a human" —
slower than automation, but you'll come out knowing how the system works.

Expect to spend ~30-45 min the first time.

---

## What you'll see

Each step has three parts:

- **Click** — what to do
- **Expect** — what should happen (your check)
- **Under the hood** — what just happened in the API + DB + GCS, with where
  to peek if you want to see for yourself

The system is small enough that you can have the API log tail open in one
terminal, the SPA dev log in another, and `psql` connected to the dev DB in
a third. With all three open at once, the whole flow becomes visible.

---

## Before you start

### 1. Bring up Postgres

```powershell
cd C:\Users\Juanes\Documents\Personal\GoldenBeautyStudio\stampee
docker compose -f infra/docker-compose.dev.yml up -d
```

If you want a clean slate, run `docker compose -f infra/docker-compose.dev.yml down -v` first.

### 2. Apply migrations + seed

```powershell
# Apply schema (idempotent — safe to re-run)
$env:MIGRATIONS_DIR="../db/migrations"; npm --prefix api run migrate; Remove-Item env:MIGRATIONS_DIR

# Apply the seed (gives you one owner + one staff + two campaigns + three customers)
docker compose -f infra/docker-compose.dev.yml exec -T postgres `
  psql -U loyalty_user -d appdb -v ON_ERROR_STOP=1 < db/seed/dev.sql
```

### 3. Start the API

```powershell
cd api
npm run dev
```

Leave this running. You'll watch its log for emails and request traces. The
API serves on `http://localhost:3001`.

### 4. Start the SPA (new terminal)

```powershell
cd C:\Users\Juanes\Documents\Personal\GoldenBeautyStudio\stampee
npm run dev
```

SPA on `http://localhost:3000`. Open it in your browser.

### 5. Open a `psql` shell (new terminal, optional but recommended)

```powershell
docker compose -f infra/docker-compose.dev.yml exec postgres psql -U loyalty_user -d appdb
```

You'll use this to look at `loyalty.*` tables when the walkthrough tells
you to peek under the hood. Useful first command: `\dt loyalty.*`.

---

## The cast (so you can navigate the codebase later)

| Surface | URL | Source |
|---|---|---|
| SPA dev server | `http://localhost:3000` | repo root — Vite |
| API | `http://localhost:3001` | `api/src/server.ts` → `routes/*` |
| Postgres | `localhost:5433` (host) / `postgres:5432` (containers) | `loyalty` schema in `appdb` |
| Email adapter | console (logs to API stdout) | `api/src/email/console.ts` |
| GCS bucket | `gbs-apps-media` (real, private) | `api/src/storage/gcs.ts` |

**Seeded accounts** (from `db/seed/dev.sql`):

| Account | Email | Password / PIN | Slug |
|---|---|---|---|
| Owner | `admin@stampee.local` | `Admin1234` | `demo` |
| Staff (works under owner) | `staff@stampee.local` | PIN `1234` | n/a |

---

## Phase A — Drive the seeded owner

You log in as the existing demo owner, explore every page, then create new
data and watch it flow.

### A1. Visit the SPA

**Click**: open `http://localhost:3000`.

**Expect**: lands on `/login` (the SPA's default route when not signed in).

**Under the hood**: `App.tsx` defines `Route path="/"` → `<Navigate to="/login">`. `AuthProvider` mounts at boot, calls `GET /auth/me` → 401 → `currentUser` stays null → router shows the login page.

In the API terminal, watch for one `incoming request` for `GET /auth/me` returning 401.

### A2. Sign in

**Click**: enter `admin@stampee.local` / `Admin1234`. Submit.

**Expect**: redirect to `/dashboard`. Header shows "Demo Business" + sidebar with `Dashboard`, `Campaigns`, `Templates`, `Customers`, `Issued Cards`, `Transactions`, `Analytics`, `Settings`.

**Under the hood**: SPA `POST /auth/login`. API verifies the bcrypt hash from `loyalty.users.password_hash`, loads the profile, signs a JWT for the access cookie, generates a 32-byte random hex for the refresh cookie (stored hashed in `loyalty.refresh_tokens`), and returns both as HttpOnly cookies. The SPA's `AuthProvider` calls `GET /auth/me` to load `{ user, owner, staffAccounts }`.

**Peek**:
- DevTools → Application → Cookies for `localhost:3001`: `access` (15 min) and `refresh` (30 days), both HttpOnly + SameSite=Lax.
- `psql`: `select id, token_hash, expires_at from loyalty.refresh_tokens;` — one row.
- API log: two requests (`POST /auth/login` 200, `GET /auth/me` 200).

### A3. Look around the dashboard

**Click**: stay on `/dashboard`.

**Expect**: stat tiles, recent activity. Real seed data: 2 campaigns, 3 customers, 3 issued cards, 7 transactions. The "Coffee Loyalty" card and "Old Promo" (disabled) campaigns should be listed.

**Under the hood**: `App.tsx` (top-level) calls `fetchCampaigns(ownerId)` → `GET /campaigns`, `fetchCustomersWithCards(ownerId)` → `GET /customers?include=cards,transactions`. The signed-GET image URLs for logos/backgrounds come back in the campaign payload — but the seed has no images, so all those fields are null.

### A4. View the Campaigns list

**Click**: sidebar → `Campaigns`.

**Expect**: two cards listed — "Coffee Loyalty" (enabled, 10 stamps), "Old Promo" (disabled, 8 stamps).

**Under the hood**: same `GET /campaigns` data, just rendered differently.

### A5. Edit a campaign (without uploading an image)

**Click**: edit "Coffee Loyalty". Change the **Reward Name** field to "Free Iced Coffee". Click save.

**Expect**: success toast. List shows the new reward name.

**Under the hood**: `PUT /campaigns/campaign-coffee` with the full template payload. API replaces the row (owner-scoped), returns the updated campaign with signed image URLs (null here). The SPA refetches the campaigns list.

**Peek** in `psql`:

```sql
select id, reward_name from loyalty.campaigns where id = 'campaign-coffee';
```

### A6. Try to upload a logo (this will fail locally — that's expected)

**Click**: edit "Coffee Loyalty" → "Upload Logo" → pick any small PNG.

**Expect**: upload fails with a generic error.

**Under the hood**: SPA called `POST /storage/campaign-assets/presign`. The API tried to sign a GCS V4 URL using Application Default Credentials… and on this Windows box there's no `media-writer` identity available, so `@google-cloud/storage` raises `SigningError: Cannot sign data without 'client_email'`. The API returns 500 INTERNAL_ERROR.

**Why this is fine**: image uploads only need to work on the VM (where `media-writer` is attached to the GCE instance). Locally you can either skip image testing or run

```powershell
gcloud auth application-default login --impersonate-service-account=media-writer@gbs-infra.iam.gserviceaccount.com
```

and the upload will start working in this dev environment too.

**Peek**: API log shows `SigningError`. The campaign row in DB is unchanged — the API didn't even reach DB code, it errored before.

### A7. View customers

**Click**: sidebar → `Customers`.

**Expect**: Alice, Bob, Carol, each with 1 issued card. Statuses: Alice = Active (3/10 stamps), Bob = Active (10/10 — fully stamped, not yet redeemed), Carol = Redeemed.

**Under the hood**: `GET /customers?include=cards,transactions`. The API runs a 3-query fanout (customers → cards `IN (...)` → transactions `IN (...)`) and stitches them. All in `lib/db/customers.ts` → `routes/customers.ts`.

### A8. View the issued cards / kiosk view

**Click**: sidebar → `Issued Cards`.

**Expect**: list of all issued cards across customers. Each row has the customer name, campaign name, stamp count, and a "Scan" button.

**Under the hood**: Same data source as A7. This page is what staff lives in.

### A9. Inspect the database state so far

In `psql`:

```sql
select id, customer_id, campaign_id, stamps, status from loyalty.issued_cards;
select id, type, amount, title from loyalty.transactions order by "timestamp";
```

You'll see the three seeded cards and seven seeded transactions. Note that `transactions.timestamp` is `bigint` (epoch ms), not a `timestamptz` — UI consumes the raw number, and the display string lives in `transactions.date`.

### A10. Public customer view — anonymous

**Copy** a card's `unique_id` from `psql`:

```sql
select unique_id from loyalty.issued_cards where id = 'card-alice';
-- prints 11111111-1111-1111-1111-111111111111
```

**Click**: open `http://localhost:3000/demo/11111111-1111-1111-1111-111111111111` in **a fresh incognito window** (no cookies).

**Expect**: full loyalty card view rendered with Alice's name, 3 of 10 stamps filled, and the redeem-reward badge.

**Under the hood**: SPA calls `GET /public/cards/demo/11111111-...` — no auth needed. API runs four sequential queries (profile by slug, card by uniqueId+ownerId, customer, optional live campaign) and returns one stitched payload. If the card had a logo image, the API would `presignRead(path)` to generate a 1-hour signed GET URL on the fly; the SPA renders that URL as the `<img src>`.

**Wrong slug → 404 (no existence leak)**:
Try `http://localhost:3000/wrong-business/11111111-1111-1111-1111-111111111111`. The API returns 404, not "owner not found" + "card found" — both wrong slug and wrong uniqueId return identical 404s.

### A11. Add a stamp from the owner dashboard

**Click**: back in the logged-in tab, go to `Issued Cards`, find Alice's card, click "Add Stamp".

**Expect**: stamps go from 3 to 4. The customer's card view (refresh A10's incognito tab) shows 4 stamps.

**Under the hood**: SPA calls `POST /cards/<id>/transactions` with `type: 'stamp_add'` and the optimistic stamp count. **Important detail**: the SPA tells the API the `type/amount/title/date/timestamp`, but the API *overrides* `actor_id`, `actor_role`, and `actor_name` from the JWT — the client cannot spoof who added a stamp. (Verified by `cards.test.ts:24`.)

**Peek** in `psql`:

```sql
select type, amount, actor_role, actor_name, title from loyalty.transactions
where card_id = 'card-alice' order by "timestamp" desc limit 3;
```

You'll see the new `stamp_add` row with `actor_role='owner'`, `actor_name='Demo Business'`.

### A12. Redeem a complete card

**Click**: open Bob's card. He's at 10/10 stamps. Hit "Redeem".

**Expect**: card moves to Redeemed status; the redeem button is disabled.

**Under the hood**: SPA `PATCH /cards/<id>` with `{ status: 'Redeemed', completedDate: <today> }`, plus a `POST /cards/<id>/transactions` of type `redeem`. Two separate calls — could be one but this matches the original Supabase implementation.

### A13. Settings → staff list

**Click**: sidebar → `Settings`.

**Expect**: tabs for Account, Staff, etc. The Staff tab lists the seeded `staff@stampee.local`.

**Under the hood**: same `staffAccounts` data the AuthProvider already loaded from `GET /auth/me`. Loaded once at session start, refreshed after staff mutations.

### A14. Create a new staff member

**Click**: Settings → Staff → "Add staff". Name: `Maria`. Email: `maria@example.com`. PIN: `4321`. Submit.

**Expect**: Maria appears in the staff list. The API log shows an `EMAIL ▶▶▶` block with subject "You've been added as staff at Demo Business" — body contains the PIN `4321` plain-text (one-shot, for onboarding only).

**Under the hood**: `POST /staff` runs a transaction: creates `loyalty.users` (with bcrypt-hashed PIN as `password_hash`), creates `loyalty.profiles` with `role='staff', owner_id=<demo-owner-id>, status='verified', access='active'`. Email send is best-effort — failure logs a warning but doesn't roll back the account.

**Peek**:

```sql
select p.business_name, p.role, p.access, u.email
from loyalty.profiles p join loyalty.users u on u.id = p.id
where p.role = 'staff';
```

### A15. Update Maria's PIN

**Click**: Settings → Staff → click Maria → "Update PIN" → `9999`.

**Expect**: success. Try staff-logging-in with `4321` in a moment (next section) — it'll fail.

**Under the hood**: `PATCH /staff/<id>/pin` re-bcrypts and updates `password_hash`, then revokes every refresh_token row belonging to that staff user (any active staff session is logged out).

### A16. Disable Maria

**Click**: same Maria detail → toggle "Disabled".

**Expect**: row marked disabled in the list.

**Under the hood**: `PATCH /staff/<id>/access` sets `profiles.access='disabled'` AND revokes her refresh tokens (same as PIN rotation). On her next API call after a stale access cookie, she'll get `403 ACCOUNT_DISABLED`. We'll watch that next.

### A17. Re-enable Maria so we can use her below

**Click**: toggle "Disabled" off.

---

## Phase B — Be the staff

### B1. Open the staff portal in a different browser

To avoid the existing owner cookies, use a **second browser** (Firefox if you've been in Chrome) or a fresh incognito window.

**Click**: open `http://localhost:3000/demo/staff`.

**Expect**: a staff login screen specific to the demo business — the slug from the URL is part of the auth challenge.

**Under the hood**: SPA reads the slug from the URL. The form posts to `POST /auth/staff-login` with `{ email, pin, orgId: 'demo' }`. The API:
1. Looks up the owner profile by slug.
2. Looks up the user by email.
3. Verifies the PIN against the user's `password_hash`.
4. Confirms the staff's `profiles.owner_id` matches the resolved owner's id.

Any mismatch → 401 INVALID_CREDENTIALS (no hint as to which step failed — prevents staff-email enumeration).

### B2. Try the old PIN (should fail)

**Click**: email `maria@example.com`, PIN `4321`, submit.

**Expect**: "Invalid email, PIN, or business" — generic error.

**Under the hood**: bcrypt comparison fails. API returns 401.

### B3. Sign in with the new PIN

**Click**: PIN `9999`, submit.

**Expect**: lands on `/issued-cards` (the staff default route, not `/dashboard`).

**Peek**: the sidebar is shorter — staff sees only `Customers` and `Issued Cards`. No Settings, no Campaigns editor, no Analytics. Enforced by `RequireRole` in the SPA AND by `requireRole('owner', ...)` middleware on the API. Both layers — a hidden button isn't a security boundary.

### B4. As staff, add a stamp

**Click**: find Alice's card → "Add Stamp".

**Expect**: stamp count goes up. Card view reflects it.

**Under the hood**: same `POST /cards/<id>/transactions` flow, but now `actor_role='staff'` and `actor_name='Maria'` in the new row. The owner can see who stamped what in the transaction history.

**Peek**:

```sql
select actor_role, actor_name, type, title from loyalty.transactions
order by "timestamp" desc limit 5;
```

You'll see Maria's stamp_add row interleaved with the owner's.

### B5. As staff, try to delete a campaign

You'll need DevTools for this since the UI hides the button. Open Network → manually issue:

```js
await fetch('http://localhost:3001/campaigns/campaign-coffee', {
  method: 'DELETE',
  credentials: 'include',
});
```

**Expect**: `403 FORBIDDEN`.

**Under the hood**: `routes/campaigns.ts` wraps `DELETE` in `requireRole(req, 'owner')`. Staff has `role='staff'` in their JWT → middleware rejects before the handler runs.

**Why both layers?** The SPA hides destructive UI to avoid confusion. The API enforces because the SPA is *not* a security boundary — anyone can `fetch` directly.

### B6. As staff, try to issue a card on a disabled campaign

**Click**: in the staff browser, find the "Old Promo" disabled campaign in Issued Cards → try to issue a new card from it.

**Expect**: error like "This campaign is disabled and cannot issue new cards".

**Under the hood**: SPA calls `POST /cards`. API attempts the INSERT; the `loyalty.prevent_issuing_disabled_campaign_card` BEFORE-INSERT trigger raises `CAMPAIGN_DISABLED`. The route's `try/catch` translates that to HTTP `409 { code: 'CAMPAIGN_DISABLED' }`. **The check lives in the DB on purpose**: every code path (HTTP, public RPC, future SQL maintenance) gets it for free.

---

## Phase C — Public surface (anonymous customers)

### C1. Public campaign signup

**Click**: open `http://localhost:3000/demo/join/campaign-coffee` in a fresh incognito tab.

**Expect**: a small form for Name / Email / Mobile. Fill it in with `name: Tom`, `email: tom@example.com`, submit.

**Expect after submit**: redirect to `http://localhost:3000/demo/<uniqueId>` — Tom's new loyalty card, 0/10 stamps.

**Under the hood**: SPA `POST /public/signup/demo/campaign-coffee`. The API calls the DB function `loyalty.register_public_campaign_signup(...)` in a single transaction that:
1. Looks up the owner by slug.
2. Looks up the campaign + verifies it belongs to the owner.
3. Searches for an existing customer with the same email/mobile (under that owner).
4. If found AND they already have an active card for this campaign → returns `outcome: 'redirect_existing'` with the existing uniqueId.
5. Otherwise: inserts `customers` + `issued_cards` + an `issued` `transactions` row, returns `outcome: 'issued'` with the new uniqueId.

Atomic — partial signups can't happen. The function body is in `db/migrations/0006_functions_and_triggers.sql`.

### C2. Submit the same email again

**Click**: open the same `/demo/join/campaign-coffee` URL in another fresh incognito tab. Use the same email `tom@example.com`, different name. Submit.

**Expect**: lands on the **same** card URL Tom got the first time. The card has not been duplicated.

**Under the hood**: the DB function found his existing customer and active card → returns `outcome: 'redirect_existing'` with the original uniqueId.

### C3. Submit on a disabled campaign with a NEW email

**First**, in the owner browser, disable "Coffee Loyalty" temporarily.

**Click**: open `http://localhost:3000/demo/join/campaign-coffee` (still the disabled one) in incognito. Use `eve@example.com`.

**Expect**: "This campaign is currently disabled" message.

**Under the hood**: DB function detects `campaign.is_enabled = false` AND no prior card under the email → `outcome: 'campaign_disabled_no_existing'`. The SPA renders the campaign-disabled message.

Now re-enable the campaign so the rest of the walkthrough works normally.

### C4. The same disabled campaign, but with Tom's email

**Click**: disable the campaign again. Then visit the join URL with `tom@example.com` (who already has a card).

**Expect**: redirects to Tom's existing card.

**Under the hood**: DB function found Tom's existing active card → returns `redirect_existing` even though the campaign is disabled. (Plan rationale: existing card holders shouldn't see "campaign disabled" — that breaks their app.) Re-enable when done.

---

## Phase D — Password reset

### D1. Trigger a reset

**Click**: log out of the owner session. On the login page, click "Forgot password". Enter `admin@stampee.local`. Submit.

**Expect**: a confirmation that an email was sent. (Always says yes — no existence leak.)

**Under the hood**: `POST /auth/forgot-password`. If the email exists, the API generates a 32-byte token, stores `sha256(token)` in `loyalty.password_reset_tokens` with `expires_at = now() + 1 hour`, and sends an email with `https://localhost:3000/reset-password?token=<plaintext-hex>` in the body.

### D2. Grab the reset URL from the API log

In your API terminal, find the most recent `EMAIL ▶▶▶` block. It looks like:

```
EMAIL ▶▶▶ ────────────────────────────────────────────────────────────
to: admin@stampee.local
subject: Reset your Stampee password

Someone requested a password reset for your Stampee account.

Reset it here (link valid for 1 hour):

http://localhost:3000/reset-password?token=<long hex>
```

Copy the URL.

### D3. Open the reset page

**Click**: paste the URL into the browser (any browser; the page itself is public).

**Expect**: a form for a new password. Enter `newPassword42`. Submit.

**Expect after submit**: success message + redirect to login.

**Under the hood**: `POST /auth/reset-password { token, newPassword }`. API runs a transaction: hashes the new password, updates `users.password_hash`, marks the reset token used, and **revokes every refresh_token belonging to this user** — every other session is invalidated.

### D4. Try the old password

**Click**: login with `admin@stampee.local` / `Admin1234`.

**Expect**: "Unable to sign in" — 401.

### D5. Login with the new password

**Click**: `admin@stampee.local` / `newPassword42`.

**Expect**: dashboard.

---

## Phase E — Cross-tab logout

### E1. Open two tabs

**Click**: with the owner logged in, open `/dashboard` in **two tabs of the same browser**.

**Expect**: both show the dashboard. The owner session is shared via cookies.

### E2. Log out in tab 1

**Click**: in tab 1, hit Logout. Tab 1 redirects to `/login`.

**Expect**: switch to tab 2. Click any sidebar link → it briefly tries to load, then redirects to `/login`.

**Under the hood**: tab 1's logout posted a `BroadcastChannel('stampee-auth')` message of type `'logout'` after the API call. Tab 2's `AuthProvider` has a listener that clears `currentUser`. But there's ALSO a redundant defense: tab 2's next API request hits 401 (cookies are gone) → `lib/api.ts` tries `/auth/refresh` → 401 → emits `auth:expired` window event → `AuthProvider` clears state → router shows login.

Two layers means cross-tab logout works even in browsers without BroadcastChannel.

---

## Phase F — Delete account

### F1. Delete a test owner

This is destructive — do it as a side account, not the demo owner.

**Click**: in the owner browser, Settings → "Delete account". Confirm.

**Expect**: redirect to login, session gone.

**Under the hood**: `DELETE /auth/account`. For an owner, the API runs a transaction that deletes the owner's `loyalty.users` row AND all their staff users (`where owner_id = <self>`). FK cascades from `users` → `profiles` → `campaigns`/`customers`/`issued_cards`/`transactions`/`refresh_tokens`/etc. Everything related to that owner is gone in one shot.

**Peek**:

```sql
select count(*) from loyalty.users;
-- only the demo owner + their staff remain (you tested with a side account)
```

---

## Quick lookup — which file does what

When you want to dive deeper:

| Behavior | Frontend | API |
|---|---|---|
| Login form, session boot | `components/AuthProvider.tsx`, `components/LoginPage.tsx` | `routes/auth.ts:POST /auth/login`, `:GET /auth/me` |
| Dashboard data fetch | `App.tsx` (top-level effects) | `routes/campaigns.ts`, `routes/customers.ts` |
| Campaign edit + image upload | `components/CardEditor.tsx`, `lib/storage/campaignAssets.ts` | `routes/campaigns.ts`, `routes/storage.ts`, `storage/gcs.ts` |
| Issue / stamp / redeem | `components/IssuedCardsPage.tsx`, `lib/db/issuedCards.ts` | `routes/cards.ts` |
| Staff management | `components/SettingsPage.tsx` (Staff tab), `AuthProvider` | `routes/staff.ts` |
| Public customer view | `App.tsx:PublicCardWrapper` | `routes/public.ts:GET /public/cards/...` |
| Public campaign signup | `components/PublicCampaignSignupPage.tsx`, `lib/db/publicSignup.ts` | `routes/public.ts:POST /public/signup/...` → DB function |
| Password reset | `components/ForgotPasswordPage.tsx`, AuthProvider | `routes/auth.ts:POST /auth/forgot-password`, `:POST /auth/reset-password` |
| Cross-tab logout | `lib/api.ts` (BroadcastChannel) + `AuthProvider` (listener) | n/a |

---

## Sharp edges to know about

**Image upload fails locally without ADC**. Until you run `gcloud auth application-default login --impersonate-service-account=media-writer@gbs-infra.iam.gserviceaccount.com`, every `/storage/.../presign` call ends in `SigningError: Cannot sign data without 'client_email'`. On the VM this Just Works because `media-writer` is attached. Don't be confused if every owner shows "no logo" — that's why.

**Email goes to stdout in dev**. `EMAIL_ADAPTER=console` in `api/.env`. To get real emails, switch to `EMAIL_ADAPTER=resend` and put a key in `RESEND_API_KEY`.

**Seed bypasses signup**. The seed inserts directly into `loyalty.users` with bcrypted password — there's no verify token needed. That's why `admin@stampee.local` can log in immediately. New signups (Phase B-style) do go through verification.

**CORS is strict**. The API only allows `http://localhost:3000` as origin (set in `api/.env`'s `SPA_ORIGIN`). If you change Vite's port, you must also change that env and restart the API (`tsx watch` doesn't reload on `.env` edits).

**Refresh-token rotation** has no grace window in v1. If two tabs refresh simultaneously, one gets logged out. Plan §G.13 documents this and proposes a 30s grace fix — not implemented yet.

**Date columns come back as `YYYY-MM-DD` strings**, not Date objects. `api/src/db/pool.ts` installs a custom pg type parser for OID 1082 (DATE) so `last_visit` and `completed_date` render correctly in the SPA without time-zone reformatting.

**Transaction `timestamp` is `bigint` (epoch ms)**, parsed as a JS number (OID 20 → `parseInt`). The display `date` field is a separately-stored formatted string set when the transaction is created. Both are needed: `timestamp` for sorting, `date` for display.

---

## When you're done

Tear down:

```powershell
# Stop the API + SPA (Ctrl-C each terminal)
docker compose -f infra/docker-compose.dev.yml down
# Or to also wipe the DB volume:
docker compose -f infra/docker-compose.dev.yml down -v
```

If you log into the dev DB again with the same data, just `up -d` — the volume persists. If you want a fresh state, `down -v` first, then `up -d` and re-run migrations + seed.
