# Advent calendar: API contract

The shapes every branch builds against. The backend (`feat/calendario-adviento`), the
card UI (`feat/adviento-ui`) and the studio panel (landing `feat/adviento-panel`)
must match this file. Change it here first, then tell the other branches.

All envelopes are the usual `{ ok: true, data }` / `{ ok: false, error: { code, message } }`.
Dates: `validFrom`/`validTo` are `YYYY-MM-DD` (Bogota calendar days). Instants are ISO strings.

## Public link (permanent customer link, `feat/link-permanente`)

`GET /public/cards/:slug/:id`, where `:id` = customer `publicId` **or** any card `unique_id` of that customer.

```ts
data: {
  canonicalId: string;            // customer publicId; the SPA replaceState()s /:slug/<canonicalId>
  card: PublicCard;               // unchanged shape: the customer's current card (newest Active, else newest)
  customer: { id: string; name: string };
  campaign: CampaignDto | null;   // of `card`
  game: GameState | null;         // of `card`
  otherCards: Array<{
    uniqueId: string; campaignName: string; stamps: number; totalStamps: number | null;
    status: 'Active' | 'Redeemed'; completedDate: string | null; createdAt: string;
  }>;
}
```
Every per-card sub-route (game, views, wallet, scan) keeps using `card.uniqueId`,
never the URL id.

## Advent, public

### `GET /public/cards/:slug/:id/advent`  (rate limit 60/min)
404 `ADVENT_OFF` when there is no enabled calendar for the owner, or after
`opensUntil` when the customer has no rewards still valid.

```ts
type AdventDoorState = 'locked' | 'ready' | 'opened' | 'missed';
type AdventRewardKind = 'coupon' | 'bonus_stamps' | 'double_stamps' | 'link' | 'gift_card';
type AdventRewardStatus = 'available' | 'redeemed' | 'expired' | 'transferred';

interface AdventReward {
  id: string;
  doorNo: number;
  dayLabel: number;              // 2, 4 … 24
  kind: AdventRewardKind;
  title: string;
  subtitle: string;
  terms: string[];               // the gift's own lines (gift_card: the gift card's own `terms`)
  code: string | null;           // 'GB-XXXX' for coupons; null otherwise
  status: AdventRewardStatus;    // 'expired' is computed on read
  validFrom: string | null;
  validTo: string | null;
  openedAt: string;
  url: string | null;            // kind 'link'
  stamps: number | null;         // bonus_stamps: stamps given (0 if the NEARLY_FULL guard stopped it)
  giftCardId: string | null;     // kind 'gift_card': match it in `giftCards`
}

interface AdventDoor {
  no: number;
  dayLabel: number;
  unlockAt: string;
  flashUntil: string | null;
  state: AdventDoorState;
  reward: AdventReward | null;   // only when state === 'opened' (never leaks before)
}

interface AdventState {
  serverNow: string;             // client keeps an offset; never trusts its own clock
  year: number;
  eligible: boolean;             // false → the board renders locked ("Tu calendario te espera")
  opensUntil: string;
  commonTerms: string[];
  doors: AdventDoor[];           // sorted by `no`
  nextUnlockAt: string | null;
  readyCount: number;            // doors the customer can open right now (front badge)
  rewards: AdventReward[];       // opened, newest first ("Mis regalos")
  giftCards: CustomerGiftCard[]; // listGiftCardsForCustomer(): includes `locked` items without code/publicUrl
}
```

### `POST /public/cards/:slug/:id/advent/doors/:no/open`  (rate limit 10/min)
Idempotent: a replay returns the same reward.
```ts
data: { reward: AdventReward; state: AdventState; card: { uniqueId: string; stamps: number } | null }
```
`card` is set when stamps changed (bonus_stamps), so the front updates without a refetch.
Errors: 409 `NOT_YET` · 409 `CLOSED` (flash over or past `opensUntil`) · 403 `NOT_ELIGIBLE` · 404 `NOT_FOUND`.

## Advent, studio (API key or owner session)

### `GET /advent/rewards?customerId=<id>&status=available|all`
`customerId` is optional; without it, all of the owner's rewards (the panel's lists).
```ts
data: { rewards: Array<AdventReward & { customerId: string; customerName: string; redeemedAt: string | null; redeemedBy: string | null }> }
```
Only kinds `coupon` are redeemable; others are listed for context.

### `POST /advent/rewards/:code/redeem`  body `{ actorName: string; ticketRef?: string }`
```ts
data: { reward: AdventReward & { customerId: string; customerName: string }; alreadyRedeemed: boolean }
```
409 codes: `EXPIRED` · `NOT_YET_VALID` · `NOT_REDEEMABLE` (not a coupon). A second redeem
returns 200 with `alreadyRedeemed: true` (same convention as gift cards).

### `POST /advent/rewards/:code/unredeem`  body `{ actorName: string }`
Undo a mistaken redeem. 200 if it was already available.

### `GET /advent/summary`  (owner)
Opens and redemptions per door, plus eligible customers.

## 3D assets (static, `public/advent/`)
Alpha WebP. The UI must work with any of them missing (CSS/SVG fallback from the prototype).
- `advent-box-open.webp` (one shot, ≈1.2 s) + `advent-box-open-poster.webp`
- `advent-baubles.webp` (loop) + `advent-baubles-poster.webp`
- `advent-star.webp` (loop) + `advent-star-poster.webp`
- `snowman.webp`, `presents.webp`, `tree.webp` (stills, from the landing's `public/navidad/`)
