# Plan — API Key Authentication & Management

> Goal: let an **external system** authenticate to the Stampee HTTP API with a
> **bearer API key** (instead of browser cookies) and exercise the existing
> endpoints with **read + write** access, scoped to one business (owner). Keys
> are created, listed, and revoked from the **Settings UI** by the **owner or an
> admin**.

This document is the implementation plan. It is grounded in the current
architecture and references concrete files. Code snippets are sketches, not
final.

---

## 1. Decisions (locked)

| Decision          | Choice                                      | Implication                                                                                                                                                          |
| ----------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Access level      | **Read + write**                            | A valid key can do everything an owner can *within its own owner scope* (issue cards, add stamps, create customers/campaigns, delete, etc.).                         |
| Internal identity | **Dedicated `api` principal**, owner-scoped | Keys are *not* tied to a human's `owner`/`staff`/`admin` role. Requests carry `role: 'api'` + `ownerScopeId`. Audit rows attribute actions to the key, not a person. |
| Who manages keys  | **Owner + admin**                           | Management endpoints reuse `requireRole(req, 'owner', 'admin')`, exactly like `/staff` and `/campaigns`.                                                             |
| Forward-compat    | Capability column kept (`['read','write']`) | Lets us later ship read-only or fine-grained scopes without a schema change.                                                                                         |

---

## 2. How the current system works (context)

- **Backend**: Fastify + Kysely + Postgres (`loyalty` schema). Routes registered
  in `api/src/server.ts`. Uniform envelope `{ ok, data }` / `{ ok, error }`
  handled by `setErrorHandler`.
- **Auth today is cookie-only**:
  - `api/src/middleware/auth.ts` → `authPreHandler` reads the `access` cookie,
    verifies the JWT, and sets `req.user: AccessClaims`.
  - `AccessClaims = { sub, email, role: 'owner'|'staff'|'admin', ownerScopeId }`
    (`api/src/lib/jwt.ts`).
  - `requireUser` / `requireRole` (`api/src/middleware/`) gate each route.
- **Multi-tenancy**: every query filters by `owner_id = claims.ownerScopeId`.
  `admin`/`staff` share the primary owner's scope. **This is exactly the seam an
  API key plugs into** — a key just needs to resolve to an `ownerScopeId`.
- **Token hygiene already exists**: `api/src/lib/tokens.ts` has
  `generateToken()` (random hex) and `hashToken()` (sha256). Refresh/verify/reset
  tokens are all stored **hashed**; plaintext lives only client-side. We reuse
  this exact pattern for API keys.
- **Migrations**: `db/migrations/NNNN_*.sql`, applied in lexical order by
  `api/src/scripts/migrate.ts`; table shapes mirrored in `api/src/db/types.ts`.
- **Rate limiting**: global `@fastify/rate-limit`, 300/min (`server.ts`),
  currently keyed by IP.
- **Frontend**: `lib/api.ts` (cookie fetch wrapper), per-domain wrappers in
  `lib/db/*`, actions surfaced through `components/AuthProvider.tsx`, and
  `components/SettingsPage.tsx` already hosts the owner/admin-gated management
  sections (staff, co-admins, profile) — the natural home for key management.

---

## 3. Design overview

```
External system
   │  Authorization: Bearer stmp_xxxxxxxx...
   ▼
authPreHandler (extended)
   ├─ has Bearer header? → authenticate API key → req.user = { role:'api', ownerScopeId, apiKeyId, ... }
   └─ else → existing cookie path (unchanged)
   ▼
requireRole / requireApi  ── authorizes 'api' principal for read+write routes
   ▼
existing route handlers (unchanged queries, already scoped by ownerScopeId)
```

Two surfaces:

1. **Consumption** — authenticate *with* a key (header) to call business
   endpoints. New middleware + small authorization change.
2. **Management** — create/list/revoke keys *from the SPA* (cookie-authed,
   owner/admin). New table, route, schemas, and Settings UI.

Key string format: **`stmp_<48 hex chars>`** (prefix aids humans + log
greps). We store `sha256(fullKey)`, display only `key_prefix` (e.g.
`stmp_a1b2c3d4`) after creation, and show the full secret **exactly once**.

---

## 4. Database

### 4.1 Migration — `db/migrations/0009_api_keys.sql`

```sql
-- ============================================================
-- 0009_api_keys.sql
-- Bearer API keys for external/system integrations.
--   * Owner-scoped: a key authenticates as the owner's data scope.
--   * Secret stored hashed (sha256); plaintext shown once on create.
--   * Soft revocation via revoked_at; optional expiry.
-- ============================================================

set search_path = loyalty, public;

create table if not exists loyalty.api_keys (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null references loyalty.profiles(id) on delete cascade,
  created_by   uuid references loyalty.profiles(id) on delete set null,
  name         text not null,
  key_prefix   text not null,                 -- e.g. 'stmp_a1b2c3d4' (display only)
  token_hash   text not null unique,          -- sha256 of the full key
  capabilities text[] not null default '{read,write}',
  last_used_at timestamptz,
  expires_at   timestamptz,                    -- null = no expiry
  revoked_at   timestamptz,
  created_at   timestamptz not null default now()
);

create index if not exists api_keys_owner_id_idx on loyalty.api_keys(owner_id);
create index if not exists api_keys_token_hash_idx on loyalty.api_keys(token_hash);
```

> `owner_id` references `profiles(id)` to match how `ownerScopeId` is used
> elsewhere (it is a profile id). `created_by` records which owner/admin minted
> the key for audit.

### 4.2 `api/src/db/types.ts`

Add the table interface and register it in `Database`:

```ts
export interface ApiKeysTable {
  id: Generated<string>;
  owner_id: string;
  created_by: string | null;
  name: string;
  key_prefix: string;
  token_hash: string;
  capabilities: ColumnType<string[], string[] | undefined, string[]>;
  last_used_at: ColumnType<Date | null, Date | null | undefined, Date | null>;
  expires_at: ColumnType<Date | null, Date | null | undefined, Date | null>;
  revoked_at: ColumnType<Date | null, Date | null | undefined, Date | null>;
  created_at: Generated<Date>;
}

export interface Database {
  // ...existing...
  api_keys: ApiKeysTable;
}
```

---

## 5. Backend — consumption (authenticating with a key)

### 5.1 Extend `AccessClaims` — `api/src/lib/jwt.ts`

Widen the role union so an authenticated key can flow through `req.user`:

```ts
export interface AccessClaims {
  sub: string;                 // for api keys: the api_keys.id
  email: string;               // for api keys: the key name/label
  role: 'owner' | 'staff' | 'admin' | 'api';
  ownerScopeId: string;
  apiKeyId?: string;           // present only for api principals
}
```

> No JWT is *issued* for `'api'`; the union just lets the same `req.user` shape
> carry an API principal. `verifyAccessToken` still only accepts the three human
> roles (keys never arrive as cookies).

### 5.2 New helper — `api/src/lib/apiKeys.ts`

```ts
import { randomBytes } from 'node:crypto';
import { hashToken } from './tokens.js';

const PREFIX = 'stmp_';

export const generateApiKey = () => {
  const secret = randomBytes(24).toString('hex');   // 48 hex chars
  const full = `${PREFIX}${secret}`;
  return {
    full,                                            // shown once
    prefix: full.slice(0, PREFIX.length + 8),        // e.g. stmp_a1b2c3d4
    hash: hashToken(full),                           // sha256, stored
  };
};
```

### 5.3 New middleware — `api/src/middleware/apiKeyAuth.ts`

Resolve a Bearer key to an `AccessClaims` (role `'api'`). Returns `undefined`
when there is no usable key so the cookie path can take over.

```ts
import type { FastifyRequest } from 'fastify';
import { db } from '../db/kysely.js';
import { hashToken } from '../lib/tokens.js';
import type { AccessClaims } from '../lib/jwt.js';

const BEARER = /^Bearer\s+(stmp_[a-f0-9]+)$/i;

export const authenticateApiKey = async (
  req: FastifyRequest,
): Promise<AccessClaims | undefined> => {
  const header = req.headers['authorization'];
  if (!header) return undefined;
  const m = BEARER.exec(header);
  if (!m) return undefined;

  const row = await db
    .selectFrom('api_keys')
    .selectAll()
    .where('token_hash', '=', hashToken(m[1]!))
    .executeTakeFirst();

  if (!row) return undefined;                       // unknown key → fall through to 401
  if (row.revoked_at) return undefined;
  if (row.expires_at && row.expires_at.getTime() < Date.now()) return undefined;

  // Best-effort last-used stamp (don't block the request).
  void db.updateTable('api_keys').set({ last_used_at: new Date() })
    .where('id', '=', row.id).execute().catch(() => {});

  return {
    sub: row.id,
    email: row.name,
    role: 'api',
    ownerScopeId: row.owner_id,
    apiKeyId: row.id,
  };
};
```

### 5.4 Wire it into `authPreHandler` — `api/src/middleware/auth.ts`

Header takes precedence over cookie; both remain optional (routes enforce).

```ts
export const authPreHandler = async (req: FastifyRequest) => {
  const apiClaims = await authenticateApiKey(req);
  if (apiClaims) { req.user = apiClaims; return; }

  const token = req.cookies['access'];
  if (!token) return;
  try { req.user = await verifyAccessToken(token); } catch { /* ignore */ }
};
```

### 5.5 Authorization for the `api` principal

Business routes call `requireRole(req, 'owner', 'staff', 'admin')` etc. An `api`
principal must pass these for **read + write**. Recommended minimal, explicit
change in `api/src/middleware/requireRole.ts`:

```ts
export const requireRole = async (req, ...roles) => {
  const claims = await requireUser(req);

  // 'api' principals have read+write within their owner scope. Treat them as
  // authorized for any owner-scoped business route. (When we later add
  // read-only keys, gate writes here on claims.capabilities.)
  if (claims.role === 'api') return claims;

  if (!roles.includes(claims.role)) {
    throw new AppError(403, 'FORBIDDEN', 'You do not have permission for this action.');
  }
  return claims;
};
```

> Safety net: every business handler already filters by
> `owner_id = claims.ownerScopeId`, so an `api` key cannot read or mutate another
> tenant's data even though it passes the role gate.

**Endpoints that must reject API keys** (management/auth surfaces): the API-key
CRUD routes (§6), `/auth/*`, `/admins`, `/staff`. For these, add a one-line
guard so a key can't manage keys or humans:

```ts
// in handlers that must stay human-only:
if (claims.role === 'api') throw new AppError(403, 'FORBIDDEN', 'API keys cannot manage this resource.');
```

A tiny helper `requireHuman(req)` (owner|staff|admin only) can encapsulate this.

### 5.6 Transaction attribution — `api/src/routes/cards.ts`

`POST /cards/:id/transactions` currently looks up the actor's name from
`profiles` by `claims.sub`. For an `api` principal `claims.sub` is the key id, so:

```ts
const actorName = claims.role === 'api'
  ? `API: ${claims.email}`                 // the key's label
  : (await db.selectFrom('profiles').select('business_name')
       .where('id','=',claims.sub).executeTakeFirst())?.business_name ?? null;

// actor_id: claims.role === 'api' ? null : claims.sub
// actor_role: claims.role   // already 'api' for keys → visible in history
```

This makes key-driven activity clearly auditable in card history.

### 5.7 Per-key rate limiting (recommended)

Give keys their own bucket instead of sharing the IP limit. In `server.ts`
rate-limit config:

```ts
await app.register(rateLimit, {
  max: 300,
  timeWindow: '1 minute',
  keyGenerator: (req) => req.user?.apiKeyId ?? req.ip,
});
```

> `req.user` is populated by the `preHandler` hook; confirm hook ordering so the
> key is resolved before the limiter reads it (register order / `onRequest` vs
> `preHandler`). If ordering is awkward, key off the raw Bearer token hash in the
> `keyGenerator` directly. Document the chosen limit.

---

## 6. Backend — management (CRUD from the SPA)

### 6.1 Schemas — `api/src/schemas/apiKeys.ts`

```ts
import { z } from 'zod';

export const CreateApiKeyBody = z.object({
  name: z.string().trim().min(1).max(80),
  expiresInDays: z.number().int().positive().max(3650).optional(),
});
export type CreateApiKeyBody = z.infer<typeof CreateApiKeyBody>;
```

### 6.2 Route — `api/src/routes/apiKeys.ts`

All endpoints `requireRole(req, 'owner', 'admin')` **and** reject `api`
principals (§5.5). DTO never includes `token_hash`.

| Method | Path            | Notes                                                                                                                  |
| ------ | --------------- | ---------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api-keys`     | List the owner's keys (id, name, prefix, capabilities, lastUsedAt, expiresAt, revokedAt, createdAt). Never the secret. |
| POST   | `/api-keys`     | `{ name, expiresInDays? }` → creates key; returns DTO **plus `key` (plaintext)** — the only time it is ever returned.  |
| DELETE | `/api-keys/:id` | Soft-revoke: set `revoked_at = now()`. 404 if not in owner scope (no existence leak, matches `requireOwnedStaff`).     |

Optional niceties: `PATCH /api-keys/:id` to rename; reject creating beyond a max
count per owner.

Sketch of POST:

```ts
app.post('/api-keys', async (req) => {
  const claims = await requireRole(req, 'owner', 'admin');
  if (claims.role === 'api') throw new AppError(403, 'FORBIDDEN', 'API keys cannot manage keys.');
  const body = parseBody(CreateApiKeyBody, req.body);
  const { full, prefix, hash } = generateApiKey();
  const expiresAt = body.expiresInDays
    ? new Date(Date.now() + body.expiresInDays * 86400_000) : null;

  const row = await db.insertInto('api_keys').values({
    owner_id: claims.ownerScopeId,
    created_by: claims.sub,
    name: body.name,
    key_prefix: prefix,
    token_hash: hash,
    expires_at: expiresAt,
  }).returningAll().executeTakeFirstOrThrow();

  return { ok: true, data: { ...toApiKeyDto(row), key: full } }; // `key` shown once
});
```

Add `toApiKeyDto` next to the other DTOs in `api/src/lib/dto.ts` (or local to the
route, matching `staff.ts`'s `toUserDto`).

### 6.3 Register the route — `api/src/server.ts`

```ts
import { apiKeyRoutes } from './routes/apiKeys.js';
// ...
await app.register(apiKeyRoutes);
```

---

## 7. Frontend — key management UI

### 7.1 Data layer — `lib/db/apiKeys.ts`

Mirror `lib/db/admins.ts`. Functions: `listApiKeys()`, `createApiKey({ name,
expiresInDays? })` → returns `{ ...key, key }`, `revokeApiKey(id)`. All via the
existing `api` wrapper in `lib/api.ts` (cookie-authed).

### 7.2 Actions — `components/AuthProvider.tsx`

Expose `apiKeys`, `createApiKey`, `revokeApiKey` (same shape as
`createStaff`/`deleteStaff`), gated to owner+admin. Load the list when the
Settings page mounts (or lazily).

### 7.3 UI — new section in `components/SettingsPage.tsx`

Add an **"API / Integraciones"** section (only rendered for owner+admin, like the
co-admins section), mirroring the staff section's structure:

- **List**: name, `key_prefix` (masked, e.g. `stmp_a1b2c3d4••••`), created
  date, last used, status badge (Active / Revoked / Expired). Revoke button with
  a confirm dialog (reuse the staff delete-confirm pattern).
- **Create dialog**: name input + optional expiry select →
  on success show the **full secret once** in a read-only field with a **Copy**
  button and a clear warning: *"Copy this now — it won't be shown again."*
- Empty state + inline error handling consistent with existing sections.

Components available: `Dialog`, `Input`, `Label`, `Button`, `Badge` (already
imported in `SettingsPage.tsx`).

### 7.4 Types — `types.ts`

Add an `ApiKey` type (and `ApiKeyWithSecret` for the create response).

---

## 8. Documentation

Update `docs/PRODUCTION_API.md`:

- §2 Authentication: add a **"Option B — API key (server-to-server)"** subsection.
  Cookies stay for the SPA; keys are for external systems.

  ```bash
  BASE=https://api.loyalty.goldenbeautystudio.com.co
  curl -sS "$BASE/customers?include=cards" \
    -H "Authorization: Bearer stmp_xxxxxxxxxxxxxxxx"
  ```

- Update the TL;DR note ("there is no bearer token or API key") — there is now.
- §4 endpoint reference: add the `/api-keys` table; mark it **owner/admin,
  cookie-auth only (not callable with an API key)**.
- Note 401 `UNAUTHENTICATED` for missing/invalid/revoked/expired keys, and the
  per-key rate limit.

---

## 9. Testing — `api/test/apiKeys.test.ts`

Follow `api/test/staff.test.ts` / `scope.test.ts` patterns:

- **Management**: owner creates a key → plaintext returned once; list shows
  prefix but never the secret; admin can manage; staff cannot (403); revoke works.
- **Consumption**: a valid key authenticates `GET /customers` and a write
  (`POST /cards`, `PATCH /cards/:id`); response envelope unchanged.
- **Revocation/expiry**: revoked key → 401; expired key → 401.
- **Scope isolation**: key from owner A cannot read/mutate owner B's data (404),
  reusing the cross-tenant assertions from `scope.test.ts`.
- **Management lockout**: an API key cannot call `/api-keys`, `/staff`,
  `/admins`, or `/auth/*` (403).
- **Audit**: a transaction created via a key records `actor_role = 'api'` and the
  key's name.

---

## 10. Security checklist

- [x] Secret stored **hashed** (sha256), shown in plaintext **once**.
- [x] Display only `key_prefix`; never return the hash or full key on list.
- [x] **Soft revoke** (instant, auditable) + optional **expiry**.
- [x] **Owner-scoped** — keys inherit the existing per-query `owner_id` filter;
      no cross-tenant access even with the relaxed role gate.
- [x] **Keys can't manage keys/humans** (explicit `role === 'api'` rejection on
      management + auth routes).
- [x] **Per-key rate limit** + `last_used_at` for monitoring.
- [x] `actor_role = 'api'` in transaction history for traceability.
- [ ] Consider an **audit log** of key create/revoke events (future).
- [ ] Consider **scoped/read-only keys** via the `capabilities` column (future —
      schema already supports it).

---

## 11. Implementation sequence

1. **DB**: write `0009_api_keys.sql`; add `ApiKeysTable` to `db/types.ts`; run
   `npm --prefix api run migrate`.
2. **Backend consumption**: `lib/apiKeys.ts`, `middleware/apiKeyAuth.ts`, extend
   `AccessClaims`, wire `authPreHandler`, relax `requireRole` for `api`, add
   `requireHuman` guard, fix transaction attribution, per-key rate limit.
3. **Backend management**: `schemas/apiKeys.ts`, `routes/apiKeys.ts`, DTO,
   register in `server.ts`.
4. **Tests**: `api/test/apiKeys.test.ts` (+ extend `scope.test.ts` if useful).
5. **Frontend**: `lib/db/apiKeys.ts`, AuthProvider actions, SettingsPage section,
   `types.ts`.
6. **Docs**: update `docs/PRODUCTION_API.md`.
7. **Manual verification**: create a key in the UI, copy it, hit a read and a
   write endpoint with `Authorization: Bearer …`, then revoke and confirm 401.

### Effort estimate

| Area                                         | Rough size |
| -------------------------------------------- | ---------- |
| DB + types                                   | XS         |
| Backend consumption (middleware + authz)     | S          |
| Backend management (route/schema/DTO)        | S          |
| Tests                                        | M          |
| Frontend (data + AuthProvider + Settings UI) | M          |
| Docs                                         | XS         |

---

## 12. Open questions / future

- **Key listing pagination / max count** per owner — likely unnecessary at
  current scale; cap at e.g. 10 to start.
- **Rotation UX** — "regenerate" = create new + revoke old; can add later.
- **Read-only & granular scopes** — the `capabilities` column is in place; ship
  when a consumer needs least-privilege.
- **Webhooks / outbound events** — out of scope here, but a natural next step for
  a true integration platform.
