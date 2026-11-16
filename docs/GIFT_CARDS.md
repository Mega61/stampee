# Tarjetas regalo (gift cards)

Fixed-amount gift cards, used whole in one visit, delivered as a public link
(`/<slug>/regalo/<uniqueId>`). Migration `db/migrations/0019_gift_cards.sql`,
logic in `api/src/lib/giftCards.ts`, routes in `api/src/routes/giftCards.ts`
(authenticated) and `api/src/routes/publicGifts.ts` (public). Admin page:
**Tarjetas regalo** (`/gift-cards`).

## Lifecycle

```
pending_payment ──activate──▶ active ──redeem──▶ redeemed
       │                        │   ◀──unredeem──┘
       └──────── void ◀─────────┘
```

- `expired` is never stored: a card is expired when `status = 'active'` and
  `valid_to` is before today in America/Bogota.
- `funded = true`: sold; the money was booked when the payment was confirmed.
  `funded = false`: promotional (a discount when redeemed). Promotional cards
  are `active` from the moment they're issued.
- Payment confirmation (`POST /gift-cards/:id/activate`) and redemption
  (`POST /gift-cards/by-code/:code/redeem` / `unredeem`) are called by the
  studio panel with an API key. Validity starts on the paid date (Bogota) and
  lasts the tier's `validityDays` (365 by default).
- Codes are `TR-XXXX-XXXX` (Crockford base32 without I, L, O, U). Lookups by
  code ignore case, spaces and dashes, and fold O→0 and I/L→1.
- `rules.buyerStampOnPaid` / `rules.giverStampOnRedeem` add one loyalty stamp
  to the buyer's newest active card with the same guard as
  `POST /cards/gift-stamps` (`api/src/lib/giftStamps.ts`): never completes a
  card, and the giver stamp is given at most once per gift card.
- In-process callers (e.g. a promotion) use `issueGiftCard(db, {...})`, which is
  idempotent on `externalRef`, and `listGiftCardsForCustomer(db, ownerId,
  customerId)`.

## Seeding the tiers

Tiers are per business. Create them once, either from the admin page
(**Tarjetas regalo → Niveles**) or with the API as an owner/admin session or
an API key:

```bash
API=https://<api-host>
KEY=stmp_...   # Settings → API keys

for tier in \
  '{"name":"Detalle","amountCop":50000,"description":"Semipermanente en manos","sort":1}' \
  '{"name":"Consentida","amountCop":100000,"description":"Semi manos + pies, o press-on","sort":2}' \
  '{"name":"Golden","amountCop":150000,"description":"Montaje + extras, o combo overlay","sort":3}'
do
  curl -sS -X POST "$API/gift-card-tiers" \
    -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
    -d "$tier"
done
```

`validityDays` defaults to 365. Check what the landing will show with
`GET /public/gift-tiers/<slug>`. To stop selling a tier, disable it (toggle in
the admin, or `DELETE /gift-card-tiers/:id`, which is a soft delete); cards
already issued keep their name and amount.

## Public page settings

- `VITE_GIFT_BOOKING_URL` (SPA, optional): where "Reservar mi cita" points.
  Defaults to the studio's `/reservar` page.
- The business logo on the card is the logo of the newest campaign that has
  one. Without it the page shows the business name only.
