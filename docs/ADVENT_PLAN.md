# Plan — Advent calendar on the card

> Goal: a seasonal **advent calendar on the back of the public card**
> (`/:slug/:uniqueId`). Doors unlock on a schedule; each opened door drops a
> personal gift into a **"Mis regalos"** inventory that the studio redeems at
> checkout. First run: December 2026, 12 doors, one every 2 days.

The door contents (titles, values, validity) are **not in this repo**. They
are marketing data seeded at deploy time from a private JSON file
(`scripts/seed-advent.ts <file>`), so the surprise isn't published early and
the code stays generic. This plan only fixes the *kinds* of gift.

## Status (2026-11-15)

Planned. Branch `feat/calendario-adviento`. Depends on `feat/tarjetas-regalo`
(gift cards) for the last door only. See §7.

## 0. Foundation: one permanent link per customer

### 0.1 The problem
The public link today is `/:slug/<issued_cards.unique_id>`: **one link per
card**. Each new card means a new link that has to be sent again:
- a win-back campaign issues a second card;
- a redeemed card is followed by a fresh one;
- a new campaign issues another card.

The old link still opens, but it shows the old card. On 2026-11-15, 51 of 115
customers already hold 2 cards, so 2 links. The calendar, gifts and gift cards
belong to the **customer**, not to a campaign, so they need a link that never
changes.

### 0.2 The rule
**One customer = one permanent link: `/:slug/<customers.public_id>`.** The
link never changes, whatever campaigns or cards come and go. Every link sent
in the past keeps working and lands on the same page.

### 0.3 Data — migration `0018_customer_link.sql`
```sql
alter table loyalty.customers add column public_id uuid;
-- backfill: the link most clients already have (their first card) becomes the permanent one
update loyalty.customers c set public_id = (
  select ic.unique_id from loyalty.issued_cards ic
  where ic.customer_id = c.id order by ic.created_at asc, ic.id asc limit 1);
update loyalty.customers set public_id = gen_random_uuid() where public_id is null;
alter table loyalty.customers alter column public_id set not null,
  alter column public_id set default gen_random_uuid();
create unique index customers_public_id_idx on loyalty.customers(public_id);
alter table loyalty.card_views add column customer_id text references loyalty.customers(id) on delete cascade;
```
A `public_id` can equal one of the customer's own card `unique_id`s, by
design. It can never equal another customer's card id, because card ids are
globally unique uuids.

### 0.4 Resolving a link
`GET /public/cards/:slug/:id` (same URL shape, no new route):
1. Resolve the owner by `slug`.
2. Look for `customers.public_id = :id` (owner-scoped). If found, that's the
   customer.
3. Otherwise look for `issued_cards.unique_id = :id` (owner-scoped). If found,
   that card's `customer_id` is the customer. The response carries
   `canonicalId = customer.public_id`, and the SPA does
   `history.replaceState` to `/:slug/<canonicalId>`. The client never sees an
   error, and her bookmark converges.
4. Otherwise, 404 (same message as today).

The response is **customer-shaped**: `{ canonicalId, customer: { name },
currentCard, otherCards[], advent?, giftCards[] }`. `currentCard` keeps the
exact shape of today's card payload, so `PublicCardView` renders it unchanged.

### 0.5 Which card the page shows
`currentCard` = the newest `Active` card by `created_at`. This is the same
rule the CRM uses to decide which card gets the stamp (`planStamps`), so the
card on screen is always the card that moves. If she has no active card, it's
the newest card (a redeemed card still shows its reward state).
`otherCards` (older or redeemed) appear under "Historial" as compact rows.
Opening one shows it read-only.

### 0.6 What hangs off the customer, not the card
- The back face: the seasonal calendar (`advent_rewards.customer_id`) and
  "Mis regalos".
- Gift cards where she is buyer or recipient (`listGiftCardsForCustomer` from
  the gift-card branch).
- The "unopened gift" badge, and view beacons (`card_views.customer_id`).
- **These stay per card:** stamps, rewards, the weekly scratch game (its rules
  read the card's campaign), and staff scan `/:slug/scan/:uniqueId`. A QR built
  from a `public_id` resolves to `currentCard`.
- **Wallet passes** stay per card for December (Apple serial = card
  `unique_id`). Follow-up: one pass per customer that follows `currentCard`, so
  a new card updates the same pass.

### 0.7 API, CRM and panel
- API-key `GET /customers` and `GET /customers/:id` return `publicId`.
  `POST /cards` returns the customer's `publicId` as well, so the CRM never
  needs a second call.
- CRM: store `stampee_public_id` on the client, next to
  `stampee_card_unique_id`.
- Panel: `cardUrl()` (`lib/stampee/card-share.ts`) builds the link from
  `publicId`. `stampee_card_share` is still keyed by card, but "pending to send"
  becomes "this **customer** has never been sent her link". A second card no
  longer asks to be re-sent.

### 0.8 Rollout and edge cases
1. **Duplicates first:** list customers that share a normalized `mobile`
   (prod has 118 customers but 115 with a card). Merge them before the backfill
   (move cards to the oldest customer row) or the same person keeps two
   permanent links. A one-off script prints the candidates; the user approves
   the merges.
2. Run 0018 and deploy the API (both id kinds resolve), then the SPA
   (`replaceState`), then the CRM/panel (`publicId`). Each step is
   backward-compatible.
3. A customer deleted in Stampee: her link 404s, same as today.
4. Testing: an old card link and the permanent link render the same page;
   redeem → a new card keeps the same URL; a win-back card becomes `currentCard`;
   the other customer's ids never resolve across owners.

## 1. Decisions

| # | Decision |
|---|---|
| 1 | One calendar per **customer**, not per card (a customer can hold cards in several campaigns). Shown on every active card of that customer. |
| 2 | Doors unlock at **07:00 America/Bogota** on their date. The server decides; the client clock is never trusted. |
| 3 | A door's contents never leave the API before that customer has opened it. |
| 4 | **Eligible** = the customer has at least one real visit (`stamp_add`) on any card. Others see the calendar locked: "Visítanos para activar tu calendario". |
| 5 | Late opening is allowed: an unlocked door stays openable until the calendar's `opens_until` (Dec 31). **Flash** doors close at `flash_until` (48 h). |
| 6 | Opening is idempotent: one row per (door, customer), and replays return the same gift. |
| 7 | Gifts are redeemed in the studio's panel, never self-served. Each gift has its own `valid_from`/`valid_to`. |
| 10 | **Every gift carries its terms and conditions** (`terms`: a list of short lines), plus the calendar's common terms. They are shown in the opening reveal ("Términos y condiciones"), in every "Mis regalos" item (expandable) and on the "Mostrar en caja" screen, so the front desk reads the same rules the client read. For the gift_card door, the gift card's own `terms` (built by `giftCardTerms(row)` on the gift-card branch, and identical to its `/regalo` page) win over the door's `terms`, so there is a single source. |
| 8 | Bonus-stamp gifts follow the existing rule: **a gift never completes a card** (same guard as `POST /cards/gift-stamps`). |
| 9 | The back face is a horizontal **flip** (physical card). The existing vertical swipe to "Historial" stays on the front. |

## 2. Gift kinds

| `kind` | On open | Redeemed |
|---|---|---|
| `coupon` | Creates an `advent_rewards` row with a `GB-XXXX` code. | In the panel at checkout ("Marcar usado"). The discount is entered at close as a promo; it never stacks with other promos, and the bigger one wins. |
| `bonus_stamps` | Adds N `'bonus'` stamps to the customer's newest active card (decision 8) and creates a reward that is already `redeemed`, so it still appears in the inventory. | Instantly. |
| `double_stamps` | Creates a reward valid in a date window. | Automatically: while it's valid, each `stamp_add` on that customer's cards also writes one `'bonus'` stamp (a stamp earned on a real visit is allowed to complete the card). |
| `link` | Creates a reward that holds a URL (e.g. `/regalar?ref=adviento`). | Not redeemed; it's a call to action. |
| `gift_card` | Calls `issueGiftCard(trx, …)` (gift-card branch) and stores the result in `external_ref`. | By the gift-card flow (its own code `TR-…`, transfer, panel). |

## 3. Data — migration `0020_advent.sql`

```sql
set search_path = loyalty, public;

create table loyalty.advent_calendars (
  id text primary key default gen_random_uuid()::text,
  owner_id uuid not null references loyalty.profiles(id) on delete cascade,
  year int not null,
  enabled boolean not null default false,
  opens_until timestamptz not null,           -- last moment any door can be opened
  common_terms jsonb not null default '[]',   -- shown under every gift's own terms
  unique (owner_id, year)
);

create table loyalty.advent_doors (
  id text primary key default gen_random_uuid()::text,
  calendar_id text not null references loyalty.advent_calendars(id) on delete cascade,
  door_no int not null check (door_no between 1 and 31),
  day_label int not null,                     -- the number painted on the door (2, 4 … 24)
  unlock_at timestamptz not null,             -- 07:00 Bogota on its date
  flash_until timestamptz,                    -- null = open until opens_until
  kind text not null check (kind in ('coupon','bonus_stamps','double_stamps','link','gift_card')),
  title text not null,
  subtitle text not null default '',
  terms jsonb not null default '[]',          -- list of short lines shown under "Términos y condiciones"
  value_cop int,
  stamps int,                                 -- bonus_stamps
  url text,                                   -- link
  valid_from date, valid_to date,             -- coupon / double_stamps
  config jsonb not null default '{}',         -- gift_card tiers etc.
  unique (calendar_id, door_no)
);

create table loyalty.advent_rewards (
  id text primary key default gen_random_uuid()::text,
  door_id text not null references loyalty.advent_doors(id) on delete cascade,
  customer_id text not null references loyalty.customers(id) on delete cascade,
  card_id text references loyalty.issued_cards(id) on delete set null, -- card it was opened from
  opened_at timestamptz not null default now(),
  code text unique,                           -- GB-XXXX (coupons)
  status text not null default 'available'
    check (status in ('available','redeemed','expired','transferred')),
  valid_from date, valid_to date,             -- copied from the door at open time
  redeemed_at timestamptz, redeemed_by text,
  external_ref text,                          -- gift card id/code (no FK, decision §7)
  unique (door_id, customer_id)               -- the "opening" and the gift are one row
);
create index advent_rewards_customer_idx on loyalty.advent_rewards(customer_id);
```

`expired` is computed on read (`valid_to < today Bogota`), never written by a
job. The transaction-type check doesn't change: gifts reuse `'bonus'`.

## 4. API

New: `api/src/lib/advent.ts` (pure state + open logic) and
`api/src/routes/publicAdvent.ts`, `api/src/routes/advent.ts`.

| Route | Auth | Notes |
|---|---|---|
| `GET /public/cards/:slug/:id/advent` (`:id` = customer `publicId` or any of its card ids) | public, 60/min | `{ serverNow, calendar: { year, eligible }, doors: [{ no, dayLabel, unlockAt, flashUntil, state: locked\|ready\|opened\|missed, reward? }], rewards: [...] }`. A locked or ready door carries no title or value. 404 if no calendar is enabled. |
| `POST /public/cards/:slug/:id/advent/doors/:no/open` | public, 10/min | One transaction: lock the customer's card row `FOR UPDATE`, check decisions 2/4/5, insert the reward (`on conflict do nothing` + reselect), apply the kind side effect. `409 { reason: NOT_YET \| CLOSED \| NOT_ELIGIBLE }`. |
| `GET /customers/:id/advent/rewards` | API key / owner | For the panel: the customer's rewards with door title, value, code, status and validity. |
| `POST /advent/rewards/:code/redeem` | API key / owner | `available` → `redeemed`, with `redeemedBy` and an optional `ticketRef`. Idempotent; 409 if expired, already redeemed, or not a coupon. |
| `GET /advent/summary` | owner | Opens per door, redemptions per door, eligible customers. |

`double_stamps` hook: in the stamp-add path (`routes/cards.ts` / transactions),
after a `stamp_add` commits, add one `'bonus'` transaction titled
"Sello doble de Adviento" if the customer has a valid `double_stamps` reward.
Both writes go in the same transaction.

Tests (`api/test/advent.test.ts`, with a fake clock): unlocks at 06:59 vs 07:00
Bogota; no content leaks before opening; idempotent double POST; flash closes;
`opens_until`; an ineligible customer; the gift-stamp guard (`NEARLY_FULL`);
the double-stamp hook; redeem idempotency and expiry; the gift_card door with a
fake issuer.

## 5. Frontend

New folder `components/card/advent/` plus `components/card/CardFlip.tsx`.
Touches `PublicCardView.tsx` (mount the flip) and `LoyaltyCard.tsx` (only if a
seam is missing). Data hook: `lib/card/useAdvent.ts`, refetched on focus and
whenever the countdown hits zero.

### 5.1 `CardFlip`
- Two faces, `preserve-3d`, `backface-visibility: hidden`, perspective
  ~1200px. It wraps the card inside `TiltSurface`; tilt pauses while dragging.
- Horizontal drag: rotation = dx / width × 180°. On release, velocity or the
  35% threshold decides the spring to 0° or 180° (motion `animate`).
- `touch-action: pan-y`; axis lock after 8 px. Vertical keeps the existing
  front → Historial slide. Pointer-downs on stamps, QR, the scratch ticket and
  doors never start a flip.
- Affordances:
  - a "Voltea tu tarjeta ↻" chip on the front;
  - a one-time 25° peek animation the first time a calendar exists (seen-flag in
    `localStorage`, try/catch);
  - a corner button (accessible name "Ver calendario de Adviento");
  - with `prefers-reduced-motion`, a crossfade instead.
- No calendar (404, or no rewards still valid) means no back face and no chip.

### 5.2 Back face: `AdventBoard`
- Brand Pan de oro: moka `#4a3426`, gold `#ac8231`, ivory `#f8f4ee`, numbers
  in Gilda Display. It does **not** follow the campaign `FxTheme`; it's the
  studio's seasonal skin.
- 3×4 grid. The last door spans 2 cells and has its own foil.
- **Door states:**
  - locked: embossed date;
  - next locked: a live countdown "abre en 1 d 4 h", using the server offset;
  - ready: warm glow plus the `WrappedGift` idle wiggle;
  - opened: a small icon and "En tu bolsa";
  - missed (flash closed): dimmed.
- Front badge: a gold dot plus "1 regalo sin abrir" whenever any door is `ready`.
- A tab or segmented control switches between "Calendario" and "Mis regalos".

### 5.3 Opening: `DoorOpening`
1. Tap → the POST fires right away. The result is known before the animation
   ends; if it fails, the door snaps shut with a gentle error message.
2. The door zooms to the center, and its two leaves swing open on their hinges
   (rotateY ±110°) with a gold light leak.
3. Particles fall, reusing `ParticleLayer`/`flakes`. The title appears with
   `SplitFlap`.
4. The gift shrinks into the "Mis regalos" counter, which bumps.
- The last door gets a longer sequence: `canvas-confetti` and the gift card as a
  mini card, with a "Regálala" button linking to the gift card's `publicUrl`.
- Reduced motion: the door fades open and the reward card appears.
- Develop the animation in a `/dev/advent` dev page with mock doors, like
  `/dev/ticket`.

### 5.4 "Mis regalos"
- A list, newest first. Each item shows title, terms and a status chip:
  Disponible / Usado / Vence en N días / Vencido.
- "Mostrar en caja" opens a full-screen sheet with the code in large type plus
  a QR code (`react-qr-code`, value = code) for the front desk.

## 6. Panel (golden-beauty-studio-landing, `admin/`)

MVP, ready before the first coupon door (the first door is a stamp):
- `lib/stampee/client.ts`: add `listAdventRewards(customerId)` and
  `redeemAdventReward(code, actor)` as **new exports at the end of the file**.
  The gift-card branch edits the same file.
- The client profile (`/clientes/[clave]`) and `/fidelidad` show the available
  gifts. A "Marcar usado" server action follows the `aplicarPremio` pattern
  (capability `fidelidad:canjear`, audit log `adviento.canjear`).
- The discount is entered at close with reason `promo` and note
  "Adviento día N". The técnica's 40% applies to the charged price (also for
  free add-ons).
- Phase 2 (after December): offer the gift as a candidate in `lib/promos.ts`.
  The gift-card branch already adds the gift card as a "bigger wins"
  candidate there, so phase 2 rebases on it.

## 7. Coordination with `feat/tarjetas-regalo`

- Migrations: `0018_customer_link.sql` and `0020_advent.sql` are this branch's;
  `0019_gift_cards.sql` belongs to gift cards. The runner tracks files by name, so merge order doesn't
  matter. Panel migration 033 is theirs; 034 is ours if needed.
- The gift_card door calls
  `issueGiftCard(trx, { ownerId, buyerCustomerId: <holder>, amountCop, source: 'advent', funded: false, validFrom, validTo, minTicketCop, transferable: true, rules: { recipient: 'new_or_dormant', giverStampOnRedeem: true }, externalRef: 'advent-<year>:door-<no>:<customerId>' })`.
  The function is idempotent on `(owner_id, external_ref)`. No FK to
  `gift_cards`.
- The tier and amounts come from `door.config` (for example,
  `{ tiers: [{ amountCop, minTicketCop, when: 'default' }, { amountCop, minTicketCop, when: 'visit_between', from, to }] }`).
  The `visit_between` tier is resolved in Stampee from `stamp_add` dates.
- Until the gift-card branch merges, `advent.ts` depends on a
  `GiftCardIssuer` interface that is injected (tests use a fake), and then gets
  wired to the real function. Gift cards must be merged and deployed before the
  last door unlocks.
- Shared files: `api/src/server.ts` and `api/src/db/types.ts` (both branches
  append), `App.tsx` (one dev route). Expect small rebases.

## 8. Execution

Today 2026-11-15. The first door unlocks Wed 2026-12-02 07:00.

| Wave | Dates | Work | Done when |
|---|---|---|---|
| D | Nov 16–17 | **Visual design first.** Interactive prototype of every screen and state: front with "voltea" chip and unopened badge, flip, door board (all door states + countdown), opening sequence, last door with gift card, "Mis regalos", "Mostrar en caja", locked calendar, reduced motion. Built at 390 px with the brand kit. | **The user and the owner approve the look.** No frontend wave (1b, 2a) starts before this; backend (0, 1a) may run in parallel. |
| L | Nov 16–18 | **Permanent customer link** (§0): migration 0018 + backfill, link resolution, current-card rule, CRM + panel use `publicId`. Ships on its own PR before the calendar. | Every old link opens the same page; a redeemed → new card keeps the URL |
| 0 | Nov 18 | Migration 0020, `db/types.ts`, shared types in `types.ts`, `GiftCardIssuer` interface, API contract (zod schemas), `/dev/advent` mock data | Typecheck green; this doc updated with anything that changed |
| 1a | Nov 16–19 | **Backend:** `lib/advent.ts`, routes, double-stamp hook, seed script, tests | `api npm test` green |
| 1b | Nov 16–20 | **Flip:** `CardFlip` + gesture arbitration + affordances, on mock data | Works on a real iPhone + Android; vertical Historial swipe and stamp taps unaffected |
| 2a | Nov 20–25 | **Board + opening animation + Mis regalos** | Reviewed on `/dev/advent` at 390 px; reduced-motion path; `card-visual-qa.mjs` |
| 2b | Nov 20–23 | **Panel MVP** (landing repo) | "Marcar usado" works against a local API; production build passes |
| 3 | Nov 26–27 | Integration: real API + SPA, staging seed, end-to-end on a phone (open → inventory → panel redeem); `/code-review` | PRs open (never merged by the agent) |
| — | Nov 28–30 | **The user:** merge + deploy, run `seed-advent.ts` with the real door file, enable the calendar, brief the front desk and the técnica, WhatsApp launch message Dec 1 | |
| — | by Dec 20 | Gift cards merged + deployed; wire the real issuer | Last door tested on staging |

The approved prototype is the reference for 1b/2a (motion timings, sizes, copy); deviations go back to the user. Waves 1a/1b and 2a/2b can run in parallel worktrees: each wave owns
different files.

## 9. Not in scope (2026)

- An owner UI for editing doors. Doors are seeded from JSON; the summary is
  read-only.
- Automatic notifications. WhatsApp stays manual. Optional: a Google Wallet
  `addMessage(TEXT_AND_NOTIFY)` "Tu regalo del día N está listo" when a door
  unlocks, if wallet passes are live; that needs a small 07:00 job.
- Auto-applying gifts at checkout (phase 2, §6).
