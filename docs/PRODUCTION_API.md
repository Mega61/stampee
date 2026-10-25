# Stampee API — Integration Guide

> Scope: how an **external system** integrates with the Stampee HTTP API using an
> **API key** — authentication, the response envelope, every endpoint you can
> call, and copy-paste `curl` examples. Production base URL:
>
> ```
> https://api.loyalty.goldenbeautystudio.com.co
> ```
>
> For local dev the base URL is `http://localhost:3001`.
>
> **Authentication is API-key only.** Every authenticated call sends an
> `Authorization: Bearer stmp_…` header. There is no login, cookie, or token
> exchange to perform from an integration.

---

## TL;DR — "get all cards right now"

There is **no `GET /cards` list endpoint.** Issued cards are returned **nested
under customers** via `GET /customers?include=cards,transactions`:

```bash
BASE=https://api.loyalty.goldenbeautystudio.com.co
KEY=stmp_xxxxxxxxxxxxxxxxxxxxxxxx     # your API key (see §1)

curl -sS "$BASE/customers?include=cards,transactions" \
  -H "Authorization: Bearer $KEY"
```

That returns `{ ok, data: [ { ...customer, cards: [ { ...card, history: [...] } ] } ] }`.

To get a **flat array of just the cards** (requires `jq`):

```bash
curl -sS "$BASE/customers?include=cards" \
  -H "Authorization: Bearer $KEY" \
  | jq '[.data[].cards[]]'
```

---

## 1. Authentication — API key

Every authenticated request carries a bearer API key in the `Authorization`
header. No cookies, no session, no refresh step.

```bash
curl -sS "$BASE/customers" -H "Authorization: Bearer $KEY"
```

### 1a. Getting a key

API keys are created from the Stampee web app by the business **owner or an
admin**, under **Settings → API e integraciones**:

1. Enter a name (e.g. `Billing system`) and an optional expiry.
2. The full secret — `stmp_…` — is shown **exactly once**. Copy it
   immediately and store it somewhere safe (a secret manager / env var). It is
   stored **hashed**, so it can never be retrieved again.
3. Only an 8-character prefix (e.g. `stmp_a1b2c3d4`) is shown afterwards, to
   help you identify the key in the list.

> Treat the key like a password. Anyone holding it has full read + write access
> to this business's data. Put it in an environment variable; never commit it.

### 1b. What a key can and can't do

- **Can:** read and write all of **one business's** data — customers, cards,
  stamps/transactions, campaigns, storage assets, profile. A key acts with
  owner-level scope, limited to the business it was created in. It can never see
  or touch another business's data.
- **Can't:** manage API keys, staff, co-admins, or account/auth settings. Those
  endpoints are reserved for humans signed into the web app and return **`403`**
  for a key. (They're intentionally omitted from the reference in §4.)

Activity performed with a key is recorded in card history as
`actorRole: "api"` with the key's name, so key-driven changes are auditable.

### 1c. Expiry, revocation, and limits

- **Expiry** is optional and set at creation. After it passes, the key stops
  working (`401`).
- **Revocation** is instant: revoke a key from the same Settings screen and the
  very next request with it returns `401`.
- **Rate limit:** 300 requests / minute **per key**.
- A business may have up to **10 active keys** at once (creating an 11th returns
  `409 API_KEY_LIMIT` — revoke one first).

A missing, unknown, revoked, or expired key returns `401 UNAUTHENTICATED`.

### Windows note

The examples use bash line-continuations (`\`). They work as-is in **Git Bash**
or WSL (use `curl.exe` if PowerShell shadows curl with an alias). For a one-line
PowerShell version, drop the `\`, put the whole command on one line, and use
`curl.exe` explicitly so you get real curl rather than `Invoke-WebRequest`.

---

## 2. Response envelope

Every response is JSON with a uniform shape.

**Success**
```json
{ "ok": true, "data": { } }
```

**Error**
```json
{ "ok": false, "error": { "code": "VALIDATION", "message": "email: Invalid email" } }
```

Always branch on `ok`, not on HTTP status alone. Common errors:

| HTTP | `code`                                             | Meaning                                                         |
| ---- | -------------------------------------------------- | --------------------------------------------------------------- |
| 400  | `VALIDATION`                                       | Body/query failed validation (message includes the field path)  |
| 401  | `UNAUTHENTICATED`                                  | Missing / unknown / revoked / expired API key                   |
| 403  | `FORBIDDEN`                                        | Valid key, but the endpoint is human-only (keys can't use it)   |
| 404  | `NOT_FOUND`                                        | Not found **or** not in your business scope (no existence leak) |
| 409  | `EMAIL_TAKEN` / `SLUG_TAKEN` / `CAMPAIGN_DISABLED` | Conflict                                                        |
| 429  | —                                                  | Rate limit exceeded (300/min per key)                           |
| 500  | `INTERNAL_ERROR`                                   | Server error (details are logged, not returned)                 |

---

## 3. Getting cards — the details

Cards live under their customer. The `include` query param controls nesting:

| Request                                     | Returns                                         |
| ------------------------------------------- | ----------------------------------------------- |
| `GET /customers`                            | customers only                                  |
| `GET /customers?include=cards`              | customers, each with a `cards[]` array          |
| `GET /customers?include=cards,transactions` | customers → `cards[]` → each card's `history[]` |

```bash
# All customers with their cards and each card's transaction history
curl -sS "$BASE/customers?include=cards,transactions" \
  -H "Authorization: Bearer $KEY"
```

**Card shape** (`data[].cards[]`):
```json
{
  "id": "uuid",
  "uniqueId": "uuid",
  "customerId": "uuid",
  "campaignId": "uuid | null",
  "campaignName": "Coffee Club",
  "stamps": 3,
  "lastVisit": "2026-06-16",
  "status": "Active | Redeemed",
  "completedDate": "2026-06-10 | undefined",
  "templateSnapshot": { },
  "history": [ /* transactions, only if include=transactions */ ]
}
```

Useful related calls:
```bash
# Just the total number of issued cards
curl -sS "$BASE/cards/count" -H "Authorization: Bearer $KEY"

# Is a scanned card mine? -> { status: "missing" | "foreign" | "owned" }
curl -sS "$BASE/scan/inspect/THE_UNIQUE_ID" -H "Authorization: Bearer $KEY"
```

---

## 3b. Look up one client's loyalty (for admin panels)

Use these instead of downloading every customer. They find a client and return
each card **already summarized**: stamps, stamps to go, reward, gifts, dates
and the card's public link. Read-only.

```bash
# By phone — any format: 3001234567, +57 300 123 4567, 573001234567
curl -sS "$BASE/customers/lookup?phone=3001234567" -H "Authorization: Bearer $KEY"

# By email (case-insensitive), by Stampee customer id, or free text (name/email/phone)
curl -sS "$BASE/customers/lookup?email=laura@example.com" -H "Authorization: Bearer $KEY"
curl -sS "$BASE/customers/lookup?id=CUSTOMER_ID"          -H "Authorization: Bearer $KEY"
curl -sS "$BASE/customers/lookup?q=laura"                 -H "Authorization: Bearer $KEY"

# One client by id (404 if not yours)
curl -sS "$BASE/customers/CUSTOMER_ID/loyalty" -H "Authorization: Bearer $KEY"
```

| Query param       | Notes                                                                 |
| ----------------- | --------------------------------------------------------------------- |
| `phone`           | Matched on the last 10 digits; needs ≥ 7 digits                       |
| `email`           | Exact match, case-insensitive                                         |
| `id`              | Stampee customer id                                                   |
| `q`               | Partial match on name, email or phone (≥ 2 chars)                     |
| `includeRedeemed` | `true` to also return redeemed cards (default: active cards only)     |
| `limit`           | Max clients returned, 1–50 (default 10). Lookup only.                 |

At least one of `phone`, `email`, `id`, `q` is required (`400` otherwise).
Params combine with AND. `/customers/lookup` returns an **array** (empty when
nothing matches — not a 404); `/customers/:id/loyalty` returns one object.

**Response** (`data[]` for lookup, `data` for `/loyalty`):
```json
{
  "id": "cust-…",
  "name": "Laura Gómez",
  "email": "laura@example.com",
  "mobile": "3001234567",
  "status": "Active",
  "totals": { "activeCards": 1, "readyToRedeem": 0, "activeStamps": 5 },
  "cards": [
    {
      "id": "card-…",
      "uniqueId": "8fa58a85-…",
      "campaignId": "custom-…",
      "campaignName": "Manicure Club",
      "campaignEnabled": true,
      "rewardName": "15% off next service",
      "status": "Active",
      "stamps": 5,
      "totalStamps": 10,
      "stampsRemaining": 5,
      "readyToRedeem": false,
      "giftedStamps": { "welcome": 2, "winBack": 2 },
      "stampsFromVisits": 1,
      "issuedAt": "2026-10-01T15:04:05.000Z",
      "lastVisitAt": "2026-10-12T16:20:00.000Z",
      "lastActivityAt": "2026-10-20T14:00:00.000Z",
      "redeemedAt": null,
      "publicUrl": "https://loyalty.goldenbeautystudio.com.co/<your-slug>/8fa58a85-…"
    }
  ]
}
```

- `stamps` / `totalStamps` are exactly what the client sees on their card.
- `giftedStamps.welcome` = pre-stamped at issue by the campaign;
  `giftedStamps.winBack` = added later as a win-back gift. Neither is a visit;
  `stampsFromVisits` is the part earned by coming in.
- `lastVisitAt` = last real stamp (visit); `lastActivityAt` includes gifts,
  redemptions and issuing.
- `readyToRedeem` = all stamps collected, reward not yet claimed.
- For the business's campaigns themselves (names, sizes, enabled), use
  `GET /campaigns`.

> **Call this from your panel's backend, not the browser.** The API's CORS only
> allows the Stampee web app's origin, and an API key in browser code would be
> visible to anyone. Keep the key in a server-side env var and proxy the call.

---

## 4. Endpoint reference

Every endpoint in §4.1–§4.5 requires your API key (the `Authorization: Bearer`
header). The public endpoints in §4.6 need no authentication at all.

### 4.1 Customers (and cards-by-include) — `/customers`
| Method | Path                                    | Body / notes                       |
| ------ | --------------------------------------- | ---------------------------------- |
| GET    | `/customers?include=cards,transactions` | **list customers + nested cards**  |
| GET    | `/customers/lookup?phone=…`             | find a client + summarized cards (§3b) |
| GET    | `/customers/:id/loyalty`                | one client's summarized cards (§3b) |
| POST   | `/customers`                            | `{ name, email, mobile?, status }` |
| PATCH  | `/customers/:id`                        | partial update                     |

### 4.2 Cards & scanning — `/cards`, `/scan`
| Method | Path                      | Body / notes                                                             |
| ------ | ------------------------- | ------------------------------------------------------------------------ |
| GET    | `/cards/count`            | `{ count }`                                                              |
| POST   | `/cards`                  | `{ customerId, campaignId, ... }` issue a card; 409 if campaign disabled |
| PATCH  | `/cards/:id`              | `{ stamps?, status?, completedDate?, lastVisit? }`                       |
| DELETE | `/cards/:id`              | delete a card                                                            |
| POST   | `/cards/:id/transactions` | `{ type, amount, date, timestamp, title, remarks? }` (actor = your key)  |
| GET    | `/scan/inspect/:uniqueId` | `{ status: "missing" \| "foreign" \| "owned" }`                          |

### 4.3 Campaigns — `/campaigns`
| Method | Path                     | Body / notes                    |
| ------ | ------------------------ | ------------------------------- |
| GET    | `/campaigns`             | list (images as signed URLs)    |
| GET    | `/campaigns/count`       | `{ count }`                     |
| POST   | `/campaigns`             | create                          |
| PUT    | `/campaigns/:id`         | upsert                          |
| PATCH  | `/campaigns/:id/enabled` | `{ isEnabled }`                 |
| DELETE | `/campaigns/:id`         | delete (issued cards preserved) |

### 4.4 Profile — `/profile`, `/slug`
| Method | Path                    | Body / notes                       |
| ------ | ----------------------- | ---------------------------------- |
| GET    | `/profile`              | current business profile           |
| PATCH  | `/profile`              | `{ businessName?, email?, slug? }` |
| GET    | `/slug/available?slug=` | `{ available, reason? }`           |

### 4.5 Storage — `/storage`
| Method | Path                               | Body / notes                                        |
| ------ | ---------------------------------- | --------------------------------------------------- |
| POST   | `/storage/campaign-assets/presign` | `{ kind, contentType, sizeBytes }` → signed PUT URL |
| DELETE | `/storage/campaign-assets`         | `{ path }`                                          |

### 4.6 Public — no authentication
| Method | Path                               | Body / notes                                    |
| ------ | ---------------------------------- | ----------------------------------------------- |
| GET    | `/health`                          | `{ status: "healthy" }`                         |
| GET    | `/profile/by-slug?slug=`           | `{ id, slug, businessName }`                    |
| GET    | `/public/cards/:slug/:uniqueId`    | cardholder view of a card                       |
| GET    | `/public/scan/:slug/:uniqueId`     | scan→login context                              |
| GET    | `/public/signup/:slug/:campaignId` | signup page context                             |
| POST   | `/public/signup/:slug/:campaignId` | `{ name, email?, mobile? }` self-enroll (5/min) |

> Endpoints **not** listed here — `/auth/*`, `/api-keys`, `/staff`, `/admins` —
> are human-only (web-app account management) and return `403` for an API key.

---

## 5. Worked example — issue a card and add a stamp

```bash
BASE=https://api.loyalty.goldenbeautystudio.com.co
KEY=stmp_xxxxxxxxxxxxxxxxxxxxxxxx

# Create a customer (capture the returned id)
curl -sS -X POST "$BASE/customers" \
  -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
  -d '{"name":"Jane Doe","email":"jane@example.com","status":"Active"}'

# Issue a card for that customer on a campaign
curl -sS -X POST "$BASE/cards" \
  -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
  -d '{"customerId":"CUSTOMER_UUID","campaignId":"CAMPAIGN_UUID"}'

# Add a stamp (set the card's stamp count)
curl -sS -X PATCH "$BASE/cards/CARD_UUID" \
  -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
  -d '{"stamps":1,"lastVisit":"2026-06-16"}'

# Record the activity in the card's history
curl -sS -X POST "$BASE/cards/CARD_UUID/transactions" \
  -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
  -d '{"type":"stamp_add","amount":1,"date":"2026-06-16","timestamp":1750000000,"title":"Stamp added"}'
```
