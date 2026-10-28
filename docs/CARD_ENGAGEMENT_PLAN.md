# Plan — Customer Card Engagement

> Goal: make the **public loyalty card** (`/:slug/:uniqueId`) something clients
> *want* to open — tactile, alive, and with a reason to come back — so they
> check it more often and stay on it longer. Measured, not guessed.

This document is the implementation plan. It is grounded in the current
architecture and references concrete files. Code snippets are sketches, not
final.

---

## 1. Decisions

| Decision            | Choice                                                     | Implication                                                                                                         |
| ------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Phase order         | 0 Measure → 1 Feel → 2 Moments → 3 Reasons to open → 4 Game | Cheapest, safest, frontend-only work ships first; the mini-game (backend + abuse surface) ships last.               |
| Scope of effects    | **Public mode only** (`mode === 'public'`)                 | Kiosk, staff, editor preview and gallery behave exactly as today. Owner preview can opt in later.                   |
| Tone                | **Derived from each campaign's design**, plus a per-campaign `fxStyle` (`elegant` · `playful` · `minimal`) | No hard-coded palette. Colors, contrast and intensity come from the template colors and the uploaded background/logo (§5.0). Owners pick the energy level in the editor. |
| Animation stack     | `motion` (Framer Motion) + `canvas-confetti`, lazy-loaded  | One new lazy chunk for the public route only; admin bundle unchanged.                                               |
| Game rewards        | **Real bonus stamps, server-decided**, owner-configured     | Needs migration, a public POST endpoint, and anti-abuse rules (§8).                                                 |
| Wallet priority     | **Google Wallet before Apple Wallet**                      | Colombian client base is Android-heavy; Apple needs a paid dev account + APNs web service. Verify with Phase 0 data. |
| WhatsApp ping       | **Staff-tap link first**, Cloud API later (optional)       | Reuses `buildWhatsAppUrl` (`lib/cardInsights.ts:155`); zero infra, zero per-message cost.                           |

Open for the owner to confirm: game defaults (§8.4).

---

## 2. How the current system works (context)

**Public card flow**

- Route `/:slug/:uniqueId` → `PublicCardWrapper` (`App.tsx:95`) fetches
  `GET /public/cards/:slug/:uniqueId` **once** (no refresh), maps it to
  `{ card, customer, template }` and renders
  `<LoyaltyCard mode="public" readOnly currentStamps=… history=… isRedeemed=… />`
  (`App.tsx:187`).
- `api/src/routes/public.ts` serves that endpoint: resolves owner by slug,
  card by `unique_id`, returns card + full `history` (asc) + signed template
  snapshot. Rate limit 60/min/IP (`PUBLIC_GET`).
- The `unique_id` UUID is the card's only secret — anyone with the link can
  view it. All new public endpoints inherit this model.

**`components/LoyaltyCard.tsx` (700 lines)** — shared by public, kiosk
(`KioskMode.tsx:239`), editor (`CardEditor.tsx:637,1219`), gallery, MyCards,
active/preview wrappers.

- Two-slide rail: front (stamps) / back (QR + history), toggled by the QR
  button, mouse wheel on desktop.
- Stamp grid: `StampSlot` buttons; in public mode the grid gets
  `pointer-events-none` (`LoyaltyCard.tsx:461`) because `readOnly` and no tap
  callbacks. **Clients currently cannot touch anything but the QR button.**
- Gift marking: `index < bonusStamps` (issue gift) or the most recent
  `winbackStamps` (sum of `gift` transactions) get a gold badge.
- Completion: Lottie gift box (`Gift Box Orange.json`, lazy) over the grid +
  `RewardModal` auto-opens in public mode. `RewardModal` shows a CSS confetti
  rain and a reward **code from `services/rewardService.ts`, which is random
  and fake** (`STAMP10`, `COOKIE30`… with English messages). Not tied to
  anything server-side.

**`components/StampSlot.tsx`** — a `<button>` with Tailwind
`hover:scale-105 active:scale-95`, icon rotates in when active, dashed border
when empty, gold gift badge.

**How stamps are added (staff side)** — `KioskMode.performAddStamp`
(`KioskMode.tsx:163`) builds a `stamp_add` transaction client-side and calls
`onUpdateCard` → `PATCH /cards/:id` + `POST /cards/:id/transactions`. Not one
atomic server call. Win-back gifts are the exception: `POST /cards/gift-stamps`
does it atomically in one DB transaction and **never completes a card**
(always leaves one stamp to earn) — the pattern the game reuses.

**Data**

- `loyalty.transactions.type` check: `stamp_add | stamp_remove | redeem | issued | gift`
  (`0011_gift_transactions.sql`). `gift` feeds win-back analytics
  (`AnalyticsPage`, `lib/cardInsights.ts`) — must not be overloaded by the game.
- Transaction `timestamp` is epoch millis (bigint); `date` a display string.
- Next migration number: **0012**.
- Customers have optional `mobile` (Colombian 10-digit; `buildWhatsAppUrl`
  normalizes).

**Frontend shell**

- Vite 6 + React 18 + Tailwind 3, no service worker, no web manifest.
  `index.html` is hard-coded to Golden Beauty (title, theme-color `#f4a624`).
- `index.css` already has a `prefers-reduced-motion` block (`index.css:110`).
- No frontend test runner. API tests: vitest + testcontainers
  (`api/test/helpers/*`), ~71 tests.
- Hosting: Caddy → nginx static SPA (`infra/nginx.spa.conf`), API on a separate
  domain; also `vercel.json` rewrites.

**Bundle baseline (public route, gzip)** — `index` 81.3 kB + `LoyaltyCard`
16.5 kB; `lottie-react` 82 kB + animation 7 kB load lazily on completion only.

**Gap that matters most:** nothing records that a client opened their card.
"Stay longer / check more" is currently unmeasurable.

---

## 3. Target architecture

```
PublicCardWrapper (App.tsx)
 ├─ usePublicCard(slug, uniqueId)          ← fetch + live refresh (Phase 2)
 ├─ useEngagementBeacon(...)               ← view/session events (Phase 0)
 └─ <LoyaltyCard mode="public" … renderStampGrid={ctx => <PublicStampGrid …/>} >
        └─ lazy chunk "card-fx"
             ├─ PublicStampGrid           ← tactile stamps, stagger, slam
             ├─ TiltSurface               ← 3D tilt + sheen
             ├─ ScratchReveal             ← reward reveal (Phase 2)
             ├─ GiftUnwrap                ← win-back gift reveal (Phase 2)
             ├─ InstallPrompt             ← add-to-home-screen (Phase 3)
             ├─ WalletButtons             ← Google/Apple Wallet (Phase 3)
             └─ WeeklyTicket              ← mini-game (Phase 4)
```

New frontend folder: `components/card/` (public-only effects) and
`lib/card/` (pure logic + hooks). `LoyaltyCard` gains a small seam — an optional
`renderStampGrid` render slot — so every other mode keeps today's grid untouched.

```ts
// LoyaltyCard.tsx — sketch of the seam
interface LoyaltyCardProps {
  …
  /** Public-mode replacement for the default StampSlot grid. */
  renderStampGrid?: (ctx: StampGridContext) => React.ReactNode;
  /** Slot for extra public chrome (install / wallet / game entry). */
  footerSlot?: React.ReactNode;
}
```

`StampGridContext` carries everything the grid already computes:
`stamps, totalStamps, bonusStamps, winbackStamps, Icon, colors (resolved),
stampSizing, isHighDensity, isCompleted`.

Step zero of Phase 1 is extracting those computations out of `LoyaltyCard` into
`lib/card/stampLayout.ts` so both the default grid and `PublicStampGrid` share
them (and the 700-line file shrinks).

---

## 4. Phase 0 — Measure (≈1 day, ships with Phase 1)

### 4.1 Migration `0012_card_views.sql`

```sql
create table if not exists loyalty.card_views (
  id text primary key default gen_random_uuid()::text,
  card_id text not null references loyalty.issued_cards(id) on delete cascade,
  owner_id uuid not null references loyalty.profiles(id) on delete cascade,
  session_id text not null,          -- random per page load, client-generated
  source text not null default 'link' check (source in ('link','pwa','wallet','whatsapp')),
  started_at timestamptz not null default now(),
  duration_ms int not null default 0,
  interactions int not null default 0,  -- stamp taps, tilts, reveals
  saw_new_stamps boolean not null default false,
  variant text not null default 'fx' check (variant in ('fx','holdout')),
  unique (card_id, session_id)
);
create index if not exists card_views_owner_started_idx on loyalty.card_views(owner_id, started_at);
create index if not exists card_views_card_idx on loyalty.card_views(card_id);
```

Mirror in `api/src/db/types.ts`.

### 4.2 Endpoint `POST /public/cards/:slug/:uniqueId/views`

- Body (zod): `{ sessionId: string(8..64), source, durationMs: int 0..3_600_000, interactions: int 0..10_000, sawNewStamps: bool }`.
- Upsert on `(card_id, session_id)`, keeping the **max** of duration/interactions
  (the client sends a start ping and a final ping).
- Rate limit 30/min/IP. Accept `text/plain` bodies too — `navigator.sendBeacon`
  can't set JSON content-type without a preflight; parse manually.
- Returns `204`. Never errors loudly to the client.
- CORS: beacons are cross-origin (SPA domain → API domain) without credentials;
  current `@fastify/cors` config with `origin: SPA_ORIGIN` is fine.

### 4.3 Client hook `lib/card/useEngagementBeacon.ts`

- `sessionId = crypto.randomUUID()` per mount.
- `source`: `?src=` query param (`whatsapp`, `wallet`) or `display-mode: standalone` → `pwa`, else `link`.
- Visible-time counter (pauses on `visibilitychange` hidden).
- Start ping on mount; final ping via `sendBeacon` on `pagehide` /
  `visibilitychange → hidden`.
- `trackInteraction()` exposed via context for the fx components.

### 4.4 Measuring comebacks (no Google Analytics)

**Decision: first-party tracking only. No GA4.**

- **GA can't see the thing that matters.** A comeback is a client **sitting in
  the salon getting a stamp**. That's a `stamp_add` row in our database, not a
  web event. To answer "did opening the card lead to a visit?" we have to join
  card opens with stamps by `card_id`, and only our own data can do that.
- **GA would add cost to the public card:** a third-party script, a
  cookie-consent banner (Colombia's personal data law, Ley 1581 de 2012), and
  data loss from ad blockers and Safari tracking protection (often 20–30 %).
  Card data would also sit in Google.
- **No cookies or logins needed.** The card link already identifies the client,
  so `card_views.card_id` + `transactions.card_id` is the whole identity model.
- If you later want traffic stats for a marketing site, use a privacy-friendly
  tool (Plausible or self-hosted Umami) there. Not on the card.

**Metric definitions** (all owner-scoped, computed in SQL, America/Bogota):

| Metric | Definition | Source |
| ------ | ---------- | ------ |
| **Visit** | A `stamp_add` transaction. `gift`, `bonus`, `issued` are **not** visits. | `transactions` |
| **Comeback rate** | % of cards with a visit in the range that had another visit within the following 45 days. | `transactions` |
| **Days between visits** | Median gap between consecutive visits per card. **This is the main business KPI.** | `transactions` |
| **Card opens** | Distinct sessions per active card per week; % of active cards opened at least once a month. | `card_views` |
| **Open → visit** | % of card-open sessions followed by a visit on the same card within 14 days. | join |
| **Time on card** | Median `duration_ms` per session. | `card_views` |
| **Source mix** | Opens by `source`: link / PWA / Wallet / WhatsApp. | `card_views` |
| **Feature exposure** | Sessions with `saw_new_stamps`, cards that installed the PWA (any `pwa` session), cards that played the game (`card_plays`). | joins |

**Proving it works: a holdout group.** Clients who open their card more are
probably the loyal ones anyway, so comparing "people who saw the animations"
against "people who didn't" mostly measures loyalty, not the animations. The
clean answer is a holdout:

- `holdout = hash(card.unique_id) % 10 === 0`, so **10 % of cards** get today's
  card (no fx, no install prompt, no game) for 6 weeks. The rule is
  deterministic: no column, no randomness, stable per card. Both the SPA and
  the API compute it.
- The beacon sends `variant: 'fx' | 'holdout'` (new column
  `card_views.variant`, in migration 0012).
- After 6 weeks, compare comeback rate and days between visits for fx vs.
  holdout cards. Then turn the holdout off (env flag `CARD_FX_HOLDOUT_PCT=0`).
- The game gets its own holdout window when it launches (§8.10).

**Owner UI** — `AnalyticsPage.tsx`, new **"Engagement"** section, data from
`GET /analytics/engagement?from&to` (owner/admin):

1. Funnel: **active cards → opened card → opened again within 30 d →
   visited within 14 d of an open**.
2. KPI tiles: comeback rate, median days between visits, opens/card/week,
   median time on card. Each with a delta vs. the previous period.
3. **Experiment card:** fx vs. holdout on comeback rate and days between visits,
   with sample sizes. Shows "aún sin datos suficientes" (not enough data yet)
   until each group has ≥ 50 cards with a visit.
4. Source mix bar (link / PWA / Wallet / WhatsApp).

Reuse the existing visit logic in `lib/cardInsights.ts` and the "Came back"
definition in the campaign comparison table so numbers match across the page.

**Exit criteria:** ship Phase 0 at least a week before Phase 1 effects go live
to collect a baseline.

---

## 5. Phase 1 — Make it feel good to touch (≈3 days, frontend only)

### 5.0 Theming: every campaign looks different, so effects adapt

Each campaign has its own palette (`ThemeColors`: `background`, `text`,
`stampActive`, `iconActive`, …), an optional uploaded **background image** with
an overlay opacity (`backgroundOpacity` 0–100), and an optional uploaded
**logo**. Presets in `data/templates.tsx` range from dark (`midnight-brew`,
`#1a1614`) to pastel (`massage-bliss`, `#F3E8FF`). No effect may assume a
palette. Everything visual goes through one derived object:

```ts
// lib/card/fxTheme.ts
export type FxStyle = 'elegant' | 'playful' | 'minimal';

export interface FxTheme {
  style: FxStyle;
  surface: 'light' | 'dark';        // effective luminance under the stamps
  accent: string;                   // stampActive
  ink: string;                      // iconActive
  particles: string[];              // 4–6 colors derived from accent/ink (tints/shades)
  giftAccent: string;               // gold by default, swapped if it clashes with accent
  sheen: { color: string; alpha: number; blend: 'soft-light' | 'overlay' };
  bubble: { bg: string; fg: string }; // tooltips/toasts, contrast-checked ≥ 4.5:1
  intensity: number;                // 0..1 multiplier: particle count, tilt range, durations
}

export function deriveFxTheme(t: Template, imageLuma?: number): FxTheme
```

**Effective surface luminance.** The stamps sit on
`mix(backgroundImage, colors.background, backgroundOpacity/100)`.

- No image, or overlay opacity ≥ 85: use `colors.background` luminance
  (`getHexLuminance` is already used in `App.tsx`).
- With an image: sample it once client-side (draw the image to a 16×16 canvas,
  average the luma) and mix with the overlay color by opacity. Logos and
  backgrounds are signed GCS URLs, so `getImageData` needs the bucket's CORS
  config to allow `GET` from `SPA_ORIGIN` (one-time infra change). If sampling
  fails (CORS, external URL), assume the overlay color alone and use
  `minimal` sheen.
- Cache the result per image URL path (without the signature) in
  `sessionStorage`.

**How each effect adapts**

| Effect           | Adapts to                                                                                                                                                   |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Particles        | `particles` palette from `accent`/`ink`. Gift particles use `giftAccent`. No rainbow confetti unless `fxStyle = playful`.                                    |
| Sheen on tilt    | Dark surface: white, alpha 0.18, soft-light. Light surface: white, alpha 0.35, overlay. Busy photo (high luma variance from the sample): alpha × 0.5.       |
| Background image | Parallax: the image layer moves ±6 px opposite to the tilt, so uploaded photos gain depth. Disabled when overlay opacity ≥ 95 (image not visible anyway).    |
| Tooltips/toasts  | Try `cardBackground`/`text`; if contrast < 4.5:1, fall back to neutral frosted glass (`white/85` on light, `black/70` on dark).                              |
| Gift badge       | Today hard-coded `bg-amber-400` (`StampSlot.tsx:64`). Keep gold as the gift signal, but if hue distance to `accent` is small, add a contrasting ring.        |
| Completion Lottie | `Gift Box Orange.json` is fixed orange. Recolor at load by walking the Lottie JSON fill colors to `accent`/`giftAccent`, or replace it with a themed SVG. |
| Logo             | Used as the stamp-slam "ink" when present (masked to a circle), so the stamp that lands carries the brand.                                                  |

**`fxStyle` per campaign** — owner control in `CardEditor.tsx` ("Animaciones":
Elegante / Divertido / Mínimo), default `elegant`.

| Style      | Intensity | Behavior                                                                                       |
| ---------- | --------- | ---------------------------------------------------------------------------------------------- |
| `elegant`  | 0.6       | Soft springs, small particle bursts, sheen, palette particles, confetti only at completion.   |
| `playful`  | 1.0       | Bouncier springs, bigger bursts, mixed-color confetti, wobble on every tap.                  |
| `minimal`  | 0.25      | No tilt or particles. Scale feedback, haptics and the stamp slam only. Good for busy photos. |

Stored as `campaigns.fx_style` (migration **0013**, see §11.2), added to
`CampaignBody`, `toCampaignDto`, `StoredTemplate`. Like the game settings, the
public card reads it from the **live campaign** (falling back to the snapshot),
so changing it applies to cards already issued.

**Visual QA matrix:** every preset in `data/templates.tsx` × 3 styles, plus 3
real uploads (dark photo, light photo, busy photo at 40 % overlay). Captured as
mobile screenshots (Playwright, 390×844) for review.

### 5.1 Dependencies

```
npm i motion canvas-confetti
npm i -D @types/canvas-confetti
```

- Use `motion/react` with `LazyMotion` + `domAnimation` features + `m.*`
  components to keep the chunk small.
- Everything under `components/card/` is imported via `React.lazy` from
  `PublicCardWrapper` only. **Budget: new `card-fx` chunk ≤ 30 kB gzip**;
  check with `vite build` output in the PR description.

### 5.2 `PublicStampGrid` (`components/card/PublicStampGrid.tsx`)

Replaces the grid in public mode via `renderStampGrid`. Uses the same
`StampSlot` visuals (extend `StampSlot` with an optional `as="motion"` path or
build `PublicStampSlot` that composes the same classes — prefer the latter to
keep `StampSlot` simple for staff).

| Interaction             | Behavior                                                                                                                                          |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tap **filled** stamp    | Spring squash (scale 1 → 0.86 → 1.06 → 1, ~350 ms), ink-ring ripple, 8–12 particles in `stampActive` color from the slot's rect, `vibrate(12)`.   |
| Tap **gifted** stamp    | Same + `giftAccent` particles + tooltip "Regalo de {business}" for 1.5 s.                                                                                 |
| Tap **empty** stamp     | Small horizontal wobble (±4°), tooltip "Te faltan N para tu {reward}".                                                                            |
| **Next** empty slot     | Soft breathing pulse (opacity/scale 1 → 1.04, 2.4 s loop). Paused when tab hidden.                                                                |
| Long-press filled stamp | Shows the date it was earned (from `history`: walk `stamp_add`/`gift`/`issued` amounts to map slot index → transaction). Nice detail, cheap. |
| Mount                   | Slots fill in sequence, 40 ms stagger, icon rotate-in; the "N/total" counter rolls up.                                                           |

- Tooltips: lightweight absolutely positioned bubble; no Radix needed.
- Haptics wrapper `lib/card/haptics.ts`: `navigator.vibrate?.(pattern)`
  guarded; iOS Safari no-ops silently (accepted).
- Particles: `canvas-confetti.create(canvas, { resize: true, useWorker: true })`
  on one overlay canvas per card, `disableForReducedMotion: true`.
- Every tap calls `trackInteraction()`.

### 5.3 `TiltSurface` (`components/card/TiltSurface.tsx`)

Wraps the front slide content.

- Pointer/touch drag: `rotateX/rotateY` up to ±8°, spring back on release.
  Must not hijack vertical scroll — only engage on horizontal-dominant moves or
  when the gesture starts on the card face, and use `touch-action: pan-y`.
- Sheen: an absolutely positioned `linear-gradient(115deg, transparent 30%, rgba(255,255,255,.35) 50%, transparent 70%)` with `mix-blend-mode: soft-light`, translated by tilt.
- Android: `deviceorientation` (no permission needed) drives a subtle idle tilt
  (±3°), throttled to rAF, only while visible.
- iOS: **no gyro** (would require `DeviceOrientationEvent.requestPermission()`
  from a user gesture → system dialog; not worth it). Drag only.
- Disabled entirely under `prefers-reduced-motion`.

### 5.4 Almost-there state

- When `totalStamps - stamps ∈ {1, 2}`: empty slots get a stronger glow,
  subtitle switches to "¡Solo te falta 1!" / "¡Te faltan 2!" (keeps owner tagline
  otherwise).

### 5.5 Accessibility & motion

- `useReducedMotion()` from motion: no tilt, no stagger, no particles, no pulse;
  taps still show the tooltip.
- Stamp buttons in public mode get `aria-label` "Sello 3 de 10, obtenido el …" /
  "Sello 7 de 10, pendiente".
- Respect `index.css` reduced-motion block.

### 5.6 Files touched

- `components/LoyaltyCard.tsx` — add `renderStampGrid` / `footerSlot`; extract layout calc.
- `lib/card/stampLayout.ts` (new), `lib/card/haptics.ts` (new), `lib/card/stampTimeline.ts` (new: slot → transaction mapping).
- `components/card/PublicStampGrid.tsx`, `PublicStampSlot.tsx`, `TiltSurface.tsx`, `ParticleLayer.tsx` (new).
- `App.tsx` — `PublicCardWrapper` passes the lazy grid.
- `package.json`.

---

## 6. Phase 2 — Make changes feel like events (≈3 days, frontend only)

### 6.1 Live refresh — `lib/card/usePublicCard.ts`

Move the fetch out of `PublicCardWrapper` into a hook that also:

- Refetches every **15 s while visible** and card is `Active`, and immediately
  on `visibilitychange → visible`. Stops on `Redeemed`.
- 4 req/min/client is well within `PUBLIC_GET` (60/min/IP) — but a salon Wi-Fi
  shares one IP. Mitigate: back off to 60 s after 5 unchanged polls; consider
  raising the public card limit to 120/min if Phase 0 shows shared-IP clusters.
- Optional optimization (later): `ETag` on the public card response so polls
  return `304`.

**Why this matters:** the client is often *in the salon* with the card open
while staff stamps it in the kiosk. They'll watch the stamp land live. That's
the best moment the product can create.

### 6.2 "Since your last visit" — `lib/card/useSeenState.ts`

- `localStorage["stampee:seen:<uniqueId>"] = { stamps, txIds: string[] (last 20), revealedReward: bool, unwrappedGiftTxIds: string[] }`.
- On load/refresh, diff current vs seen:
  - New `stamp_add` → **stamp slam**: the slot starts empty, a stamp icon drops
    from above with scale 1.6 → 1, rotation −12° → 0°, a dust-ring + heavier
    haptic `[0, 30, 40, 20]`, then a toast "+1 sello · {fecha}". Multiple new
    stamps chain with 350 ms gaps.
  - New `gift` (win-back) → **GiftUnwrap** (§6.3).
  - New `issued` with amount > 0 on first ever visit → welcome: gift stamps
    unwrap in sequence.
- Write the new seen-state only **after** the animation completes (so a
  closed-too-early tab replays it next time).
- First visit with no stored state: treat as "seen" except the issue gift
  (don't slam 6 historic stamps at a returning client on a new device).
- `try/catch` around storage (Safari private mode).
- Report `sawNewStamps: true` to the beacon.

### 6.3 `GiftUnwrap` (`components/card/GiftUnwrap.tsx`)

- New gifted slots render as a wrapped box (ribbon SVG over the slot, gold).
- Banner: "{business} te regaló N sellos 🎁 Toca para abrir".
- Tap → ribbon unties (path animation), lid pops, slot flips to stamped, gold
  particles. Then mark the gift tx id unwrapped.
- If the user never taps, the stamps are still counted (it's presentation only).

### 6.4 `ScratchReveal` — reward reveal (replaces auto `RewardModal` in public)

- On completion (`isCompleted && !isRedeemed`) and not yet `revealedReward`:
  full-card overlay with a canvas scratch layer (theme-colored foil + pattern),
  under it: reward name, "Muéstralo al personal", the card ID.
- Canvas: draw foil, `globalCompositeOperation = 'destination-out'` on
  pointermove with a 28 px brush; sample cleared % every 250 ms via a
  down-scaled `getImageData`; at ≥ 55 % fade the rest + confetti burst
  (canvas-confetti, existing `RewardModal` palette) + haptic.
- Reduced motion / tap-to-reveal button as a fallback ("Revelar").
- After reveal: today's "Felicitaciones" state + Lottie stays as-is.
- **Drop the fake code** from `rewardService.ts` in public mode — it's a random
  string staff can't verify. Show the card ID (which staff can scan) instead.
  `RewardModal` keeps working for kiosk/active modes.

### 6.5 Files touched

- `App.tsx` — `PublicCardWrapper` uses `usePublicCard`.
- `lib/card/usePublicCard.ts`, `lib/card/useSeenState.ts`, `lib/card/diffCard.ts` (pure; unit-testable).
- `components/card/StampSlam.tsx`, `GiftUnwrap.tsx`, `ScratchReveal.tsx`, `Toast.tsx`.
- `components/LoyaltyCard.tsx` — public mode: don't auto-open `RewardModal`
  when `ScratchReveal` is handling it (prop `rewardRevealMode: 'modal' | 'external'`).

---

## 7. Phase 3 — Reasons to open it (≈1–1.5 weeks, backend + infra)

Ordered by effort/value. 7.1 and 7.2 are small; 7.3 is a project of its own.

### 7.1 WhatsApp ping after stamping (≈1 day)

Today WhatsApp is **link-based** (`buildWhatsAppUrl` → `api.whatsapp.com/send`),
staff tap per client. Keep that model:

- `KioskMode` success state after `performAddStamp`: a "Avisar por WhatsApp"
  button (only if `customer.mobile`) with a prefilled message:
  "¡Sumaste un sello en {business}! Llevas {n}/{total} 💛 Mira tu tarjeta: {url}?src=whatsapp".
- Same after redeem ("¡Tu {reward} ya es tuyo!…") and in the existing win-back
  queue (append `?src=whatsapp` to its card links so Phase 0 attributes opens).
- The `?src=` param lands on the card → beacon `source: 'whatsapp'` → the slam
  animation plays because the stamp is new. Closed loop, zero infra.

**Later (optional):** WhatsApp Cloud API with an approved *utility* template,
sent server-side from the transaction route. Needs Meta Business verification,
a phone number, per-conversation fees, and opt-in capture at signup. Only worth
it if Phase 0 shows the manual pings drive opens.

### 7.2 Install as app (PWA) (≈2 days)

- **Manifest per card**, served by the API so `start_url` is *this client's
  card*: `GET /public/cards/:slug/:uniqueId/manifest.webmanifest`
  ```json
  { "name": "{business}", "short_name": "{business}", "start_url": "/{slug}/{uniqueId}?src=pwa",
    "scope": "/{slug}/{uniqueId}", "display": "standalone",
    "background_color": "<card bg>", "theme_color": "<card bg>",
    "icons": [{ "src": "<API>/public/brand/{slug}/icon-192.png", "sizes": "192x192", "type": "image/png" }, … 512, maskable] }
  ```
  `PublicCardWrapper` injects `<link rel="manifest">` and
  `<meta name="theme-color">` on mount (remove on unmount).
- **Icons:** logos live in a private bucket behind short-lived signed URLs
  (`signedReadUrl`) — unusable as long-lived icon URLs. Add
  `GET /public/brand/:slug/icon-:size.png` that streams the logo resized/padded
  (use `sharp` in the API) with `Cache-Control: public, max-age=86400`. Fallback
  to `/public/stampee.svg`-derived PNGs in `public/` when no logo.
- **iOS:** add `<link rel="apple-touch-icon">` (same endpoint, 180 px) and
  `apple-mobile-web-app-capable`. iOS uses the current URL for the home-screen
  shortcut, so it opens the right card.
- **Service worker** (`public/sw.js`, hand-written, no Workbox): cache the app
  shell + **last successful public card response** so the QR still shows at the
  counter with bad signal. Network-first for the card API, cache fallback.
  Scope `/` but only intercept public card routes and `/assets/*`.
- **`InstallPrompt`** (`components/card/InstallPrompt.tsx`):
  - Android/Chrome: capture `beforeinstallprompt`, show a small pill "Agregar a
    tu inicio" after the client's **second** open or right after a slam
    animation (high-intent moment). Dismiss → don't show for 14 days.
  - iOS Safari: instructional sheet (Share → "Agregar a inicio") with an
    illustration; same cadence.
  - Hidden when `display-mode: standalone`.

### 7.3 Google Wallet (then Apple Wallet) (≈1 week each)

**Google Wallet — Loyalty pass**

- Prereqs: Google Pay & Wallet Console issuer account, a service account with
  the Wallet Object Issuer role, key in API env (`GOOGLE_WALLET_ISSUER_ID`,
  `GOOGLE_WALLET_SA_KEY`).
- One `LoyaltyClass` per campaign (logo, colors, program name), one
  `LoyaltyObject` per issued card (`loyaltyPoints.balance = stamps`, label
  "Sellos", barcode = staff scan URL via `buildStaffScanEntryUrl`, link back to
  the card with `?src=wallet`).
- `GET /public/cards/:slug/:uniqueId/wallet/google` → creates/updates the class
  & object, returns a signed "Save to Google Wallet" JWT URL.
- **Updates:** after every stamp change, PATCH the object → Google pushes an
  update to the device. Requires stamp changes to go through a server hook.
  Today stamps change via client-composed `PATCH /cards/:id` +
  `POST /cards/:id/transactions` (`KioskMode.tsx:163`) and
  `POST /cards/gift-stamps`. Add a small `api/src/lib/cardEvents.ts`
  (`onCardChanged(cardId)`) called from `PATCH /cards/:id` and the gift route;
  it fires the wallet update out-of-band (don't block the staff response; log
  failures).
- New table `wallet_passes (card_id, provider, object_id, created_at, last_synced_at)`.

**Apple Wallet** (after Google, if Phase 0 shows iOS share justifies it)

- Apple Developer Program ($99/yr), Pass Type ID cert, `passkit-generator` lib,
  `.pkpass` download endpoint, and the PassKit **web service** endpoints
  (register device, list updated serials, fetch latest pass, log) + APNs push on
  change via the same `onCardChanged` hook. Table `wallet_devices`.

### 7.4 Files touched (Phase 3)

- API: `routes/publicPwa.ts` (manifest, brand icon), `routes/wallet.ts`, `lib/cardEvents.ts`,
  `lib/wallet/google.ts` (`lib/wallet/apple.ts` later), `routes/cards.ts`
  (call `onCardChanged`), `config.ts` (new env), migration
  `0014_wallet_passes.sql`, `infra/.env.api.example`.
- SPA: `App.tsx`, `components/KioskMode.tsx`, `components/WinBackDialog.tsx`,
  `components/card/InstallPrompt.tsx`, `components/card/WalletButtons.tsx`,
  `public/sw.js`, `index.tsx` (SW registration on public routes only).
- Infra: nginx/Caddy must serve `sw.js` with `Cache-Control: no-cache`
  (currently only `/assets/*` gets special headers — fine, but be explicit).

---

## 8. Phase 4 — Mini-game: weekly scratch ticket (≈1 week, backend + frontend)

A game with no prize gets old in about a week. This one gives **real bonus
stamps**, the **server decides** every result, and the owner sets the odds and a
monthly budget.

### 8.1 What the client experiences

1. **A ticket appears.** If the card can play this week, a small ticket shows
   under the stamps: "🎟️ Tu raspa y gana de la semana". It's styled with the
   campaign's `FxTheme` (accent foil, logo watermark).
2. **They scratch.** The ticket opens full-width. Scratching (same canvas
   component as the reward reveal, §6.4) uncovers the result. **The result was
   already fixed by the server when the ticket opened.** Scratching is
   presentation only, so closing the app mid-scratch changes nothing.
3. **Win:** "¡Ganaste 1 sello!" → the ticket flies into the next empty slot →
   stamp slam (§6.2) with a "Bonus" label. Recorded on the card history as
   "Sello de la suerte".
4. **No win:** a warm message that never mocks ("Esta semana no fue, ¡el lunes
   hay otro!") plus a **countdown to Monday**. The countdown is the
   come-back-later hook. Never show a fake "almost won", because that's
   manipulative and against the elegant tone.
5. **Already played:** the ticket collapses into a "Próximo raspa y gana en
   3 d 4 h" chip with the last result.
6. **Not eligible** (no visit in the last 60 days): a locked ticket that says
   "Visítanos para activar tu raspa y gana". This turns the game into a reason
   to book.

### 8.1a Animation spec: the ticket has to feel premium

The game lives or dies by how it feels. Everything below adapts to `FxTheme`
(colors, `fxStyle`, light/dark surface). Every beat has a reduced-motion
fallback (crossfade, no movement).

**Idle: the ticket on the card**

- A foil ticket peeks 40 % out from the bottom edge of the card, with a
  perforated edge (SVG mask) and the business logo embossed as a faint
  watermark.
- Foil material: a gradient from `accent` → `giftAccent` → `accent`, a subtle
  noise texture and diagonal brushed lines. In `playful`, holographic (hue
  shift on tilt).
- **A specular highlight follows tilt** (device orientation on Android, finger
  drag everywhere), reusing `TiltSurface`. This alone makes it look physical.
- Every 4 s a light sweep runs across the foil, and the ticket floats ±3 px.
  Paused when the tab is hidden.

**Open (0–700 ms)**

- Tap → the ticket lifts out with a shared-element transition (`motion`
  `layoutId`) to the center of the screen and grows to about 85 % width.
- Behind it the card blurs (8 px) and scales to 0.96 with a dim overlay.
- The ticket turns from tilted to flat in 3D (rotateX 25° → 0) with a soft
  overshoot spring. Haptic `vibrate(8)`.
- **The play request fires on tap.** The 700 ms open animation hides the
  network latency. If the result still isn't back, the foil shimmer speeds up.
  Never a spinner.

**Scratch**

- Canvas scratch layer at the device pixel ratio (capped at 2), with a
  soft-edged 30 px brush.
- **Foil flakes:** small metallic shavings spawn along the finger path and fall
  with gravity and spin, in the foil colors (pooled, max 60 at once). This is
  what makes it feel like real scratching.
- **Grain haptics:** a `vibrate(3)` tick every ~40 px of scratch distance
  (Android), so the foil feels textured.
- The foil highlight keeps following tilt while scratching.
- Under the foil is **one honest prize window**. The campaign's stamp icon
  means a win, a small heart in `accent` means no win this week. No fake
  "match 2 of 3" near-misses.
- A "Raspar todo" button appears after 2 s for clients who just want the
  result.

**Auto-complete (at 55 % cleared)**

- The remaining foil **shatters into flakes** that burst outward from the
  finger's last point and fall off the screen (the foil is sampled into chunks
  on a downscaled canvas). 450 ms.

**Win (≈ 2.4 s total)**

| t (ms) | Beat |
| ------ | ---- |
| 0      | Radial light bloom from the prize window. Haptic `[0, 20, 30, 40]`. |
| 150    | The stamp icon pops in (scale 0 → 1.25 → 1, spring) with an expanding `giftAccent` shockwave ring. |
| 450    | "¡Ganaste 1 sello!" springs in word by word. Particle burst in theme colors (`playful`: mixed confetti). |
| 1400   | The ticket collapses into a glowing stamp orb that **flies along a curved path** to the next empty slot. The card un-blurs underneath as it travels, leaving a sparkle trail. |
| 2000   | **Lands with the stamp slam** (§6.2): dust ring, heavy haptic, the counter rolls up. The slot gets a small "suerte" sparkle badge. |

**No win (≈ 1.6 s)**

- The heart bobs gently, then "Esta semana no fue 💛 ¡El lunes hay otro!"
  fades up. Single soft haptic.
- The ticket **folds in half** in 3D and tucks itself into a chip under the
  stamps: **"Próximo raspa y gana · 3 d 4 h"**.

**Countdown chip**

- Split-flap digits that flip when they change (hours and minutes).
- When a new week starts while the card is open (or on the next open), the chip
  **unfolds** back into a fresh ticket with a light sweep.

**Locked ticket** (no recent visit)

- Matte (un-foiled) ticket with a small lock. On tap it wobbles and shows
  "Visítanos para activar tu raspa y gana".

**Per `fxStyle`**

| | elegant | playful | minimal |
|---|---|---|---|
| Foil | Brushed gold/accent, slow sweep | Holographic, fast sweep | Flat accent, no sweep |
| Flakes | Few, slow | Many, spinning | None |
| Win burst | Theme particles | Mixed confetti + bigger shockwave | Bloom only |
| Flight to slot | Curved, sparkle trail | Curved with a bounce | Straight crossfade |

**Performance budget:** 60 fps on a mid-range Android. Only `transform`/`opacity`
on DOM layers; canvas work stays in rAF; flake pool capped; `OffscreenCanvas`
when available.

**Tuning before building:** agent H's first deliverable is a dev-only
playground route (`/dev/ticket`, excluded from production builds) with
controls for every timing, spring and particle value, a "force win/lose"
toggle, and all presets × `fxStyle`. You approve the feel on a real phone
there, then H wires it to the API.

### 8.2 The rules (all enforced in the database, never in the browser)

| # | Rule | Why |
|---|------|-----|
| 1 | Card is `Active` and its campaign has `game_enabled = true`. | Owner on/off switch. Read from the **live campaign**, so turning it off stops all existing cards. |
| 2 | **One play per card per week** (ISO week, America/Bogota timezone; resets Monday 00:00). Enforced by `unique (card_id, period_key)`. | Weekly rhythm. The unique key makes double-taps and replays impossible. |
| 3 | **Eligible only if the card had a real visit (`stamp_add`) in the last 60 days.** | Public signup is open to anyone. Without this, people could create cards and collect stamps without ever visiting. It also rewards active clients. |
| 4 | **A win never completes a card.** If the card is 1 stamp from the reward, the play still happens but always loses. | Same rule as win-back gifts (`POST /cards/gift-stamps`): the reward always needs a real visit. |
| 5 | **Monthly budget per business** (`game_monthly_cap` bonus stamps). When it's used up, plays still happen but always lose. | The owner controls the cost exactly. |
| 6 | Only 1 stamp per win. | Keeps the value predictable. |

### 8.3 How a play works, step by step

`POST /public/cards/:slug/:uniqueId/game/play`, all in one database
transaction:

1. Resolve the owner by slug and the card by `unique_id`. Lock the card row
   (`FOR UPDATE`).
2. Compute `period_key` (for example `2026-W44`) in America/Bogota.
3. If a `card_plays` row already exists for that card and week, **return it**.
   Replaying, refreshing or calling twice gives the same answer.
4. Check rules 1 and 3. If they fail, respond `409 { reason }` and save no
   play.
5. Decide whether this play *can* win: the card isn't 1 stamp away (rule 4) and
   the business's bonus stamps this month are below the cap (rule 5).
6. If it can win, roll `crypto.randomInt(100) < game_win_pct`.
7. Insert the `card_plays` row. On a win, also `stamps + 1` on the card and a
   `bonus` transaction (`title: 'Bonus Stamp'`, `actor_role: 'system'`).
8. Return `{ won, stampsAwarded, stamps, nextPlayAt }`.

The ticket UI calls this when the client **opens** the ticket, then animates
the scratch over the known result.

### 8.4 The economics: what it costs the owner

Variables: `A` = eligible cards (visited in the last 60 days), `p` = share of
them that play in a given week, `w` = win %. Expected bonus stamps per month ≈
`A × p × 4.3 × w`. The cap is a hard ceiling on top of that.

Example: 200 eligible cards, 40 % play weekly, 15 % odds →
200 × 0.4 × 4.3 × 0.15 ≈ **52 stamps/month**. A cap of 30 stops it there.
With 10-stamp cards, 30 bonus stamps ≈ **3 free rewards/month**, spread over
clients who visited recently. That's comparable to one win-back campaign, and
the editor shows this estimate live before the owner saves.

Suggested defaults: **15 % odds, cap 30 stamps/month, game off until the owner
turns it on.** The analytics page shows whether it pays off (§8.8).

### 8.5 Data — migration `0015_card_game.sql`

```sql
alter table loyalty.campaigns
  add column if not exists game_enabled boolean not null default false,
  add column if not exists game_win_pct int not null default 15 check (game_win_pct between 0 and 100),
  add column if not exists game_monthly_cap int not null default 30 check (game_monthly_cap >= 0);

create table if not exists loyalty.card_plays (
  id text primary key default gen_random_uuid()::text,
  card_id text not null references loyalty.issued_cards(id) on delete cascade,
  owner_id uuid not null references loyalty.profiles(id) on delete cascade,
  period_key text not null,              -- e.g. '2026-W44' (America/Bogota)
  played_at timestamptz not null default now(),
  won boolean not null,
  stamps_awarded int not null default 0,
  unique (card_id, period_key)
);
create index if not exists card_plays_owner_played_idx on loyalty.card_plays(owner_id, played_at);

-- Separate transaction type so neither visit analytics ('stamp_add')
-- nor win-back analytics ('gift') are polluted.
alter table loyalty.transactions drop constraint if exists transactions_type_check;
alter table loyalty.transactions add constraint transactions_type_check
  check (type in ('stamp_add','stamp_remove','redeem','issued','gift','bonus'));
```

The monthly cap is checked with
`sum(stamps_awarded) from card_plays where owner_id = $1 and played_at >= date_trunc('month', now() at time zone 'America/Bogota')`.

### 8.6 API

- `GET /public/cards/:slug/:uniqueId/game` →
  `{ state: 'available' | 'played' | 'locked' | 'disabled', nextPlayAt, lastResult? }`.
  Also folded into the public card response as `game` to save a request.
- `POST …/game/play` as in §8.3. Rate limit 10/min/IP.
- After a win, call `onCardChanged(cardId)` so a Wallet pass updates (Phase 3).
- Lives in a **new route file** `api/src/routes/publicGame.ts` (see §11.3).

### 8.7 Type ripple for `'bonus'`

`types.ts` (`Transaction['type']`), `api/src/db/types.ts`, `api/src/lib/dto.ts`
(`TransactionRow`), `LoyaltyCard` (`getTransactionIcon`/color: sparkle in
`giftAccent`) and `KioskMode.tsx` are all done in **Wave 0** (§11.3), because
`LoyaltyCard` is frozen afterwards. The game agents handle
`TransactionsPage.tsx`, `lib/cardInsights.ts` (must **not** count as a visit)
and `AnalyticsPage.tsx`. Grep for `'gift'` to find every switch.

### 8.8 Owner UI

- `CardEditor.tsx`, new accordion section **"Raspa y gana semanal"**: an
  on/off switch, a win % slider (5–50, default 15), a monthly cap input, and a
  live estimate ("Con tus ~200 clientes activos: ≈ 52 sellos extra al mes,
  limitado a 30 ≈ 3 recompensas"), computed from a new
  `GET /campaigns/:id/game-estimate` (owner-scoped count of eligible cards).
- `AnalyticsPage.tsx`, "Raspa y gana" KPIs: plays, wins, stamps awarded vs.
  cap, and **the share of players who visited within 14 days of playing**
  compared with eligible non-players. That last number tells you whether the
  game works.
- Extend `CampaignBody` (zod), `toCampaignDto`, `StoredTemplate`.

### 8.9 Tests (`api/test/game.test.ts`)

- A card with no recent visit is locked.
- Only one play per week, and a second call returns the same result.
- A win never completes a card.
- The monthly cap forces losses.
- A disabled campaign makes the game unavailable.
- Scope: a wrong slug returns 404.
- A `bonus` transaction is excluded from visit analytics.
- Week boundary in Bogota time (Sunday 23:59 vs Monday 00:00).
- Deterministic results: set `game_win_pct` to 0 or 100 in the test.

### 8.10 Measuring the game

- Holdout: for the first 6 weeks after launch, cards in a second hash bucket
  (`hash(unique_id) % 10 === 1`) see the locked "Pronto" ticket instead of a
  playable one. The API refuses plays for that bucket.
- Compare **visit within 14 days** and **days between visits** for players vs.
  the game holdout. Shown on the analytics page next to the cost (bonus stamps
  awarded).

---

## 9. Cross-cutting concerns

- **Performance:** all fx lazy-loaded; animations limited to `transform` /
  `opacity`; particle canvas uses a worker; pause loops when hidden. Test on a
  mid-range Android (e.g. Moto G-class) — target 60 fps during slam/tilt.
- **Kill switch:** `VITE_CARD_FX=off` build flag falls back to today's grid, in
  case something misbehaves on a device class in production.
- **Locale:** all new client copy in Spanish (es-CO), matching the public card.
- **Privacy:** beacons carry no PII — card id comes from the URL path, session
  id is random. Don't log user agents beyond what Fastify already does.
- **Owner preview:** after Phase 2, offer `renderStampGrid` in the
  `CardEditor` preview so owners can feel what clients get.

---

## 10. Testing

| Layer          | What                                                                                                   |
| -------------- | ------------------------------------------------------------------------------------------------------ |
| API (vitest)   | `views.test.ts` (upsert, max-merge, rate limit, text/plain body), `game.test.ts` (§8.9), wallet route with a mocked Google client, manifest/icon routes. |
| Pure logic     | `diffCard`, `stampTimeline`, period-key calc — add `vitest` to the SPA root just for `lib/card/*` (no DOM). |
| Manual devices | Checklist in `docs/TESTING.md` Layer 4: iPhone Safari, Android Chrome, low-end Android; reduced-motion on; offline QR via SW; install flow on both OSes; live stamp while card open. |
| Bundle         | PR includes `vite build` output; `card-fx` chunk ≤ 30 kB gzip, main `index` unchanged.                |

---

## 11. Execution plan for multi-agent work

The work is split into **waves**. Agents inside a wave run in parallel, each
in its own git worktree and branch. A wave starts only after the previous one
is merged and green. Parallel work stays safe for three reasons:
(1) **contracts are written first** (Wave 0), (2) **every file has exactly one
owner per wave**, and (3) **files that several agents would edit get split or
pre-wired** before anyone starts.

### 11.1 Waves

```
Wave 0  ── Foundation & contracts (1 agent, sequential) ─────────────────────┐
                                                                             ▼
Wave 1  ── A Measure-API   B Theme+fxStyle   C Tactile grid   D Data hooks   (4 parallel)
                                                                             ▼
Wave 2  ── E Moments UI    F WhatsApp+PWA    G Game backend                  (3 parallel)
                                                                             ▼
Wave 3  ── H Game frontend   I Google Wallet                                 (2 parallel)
                                                                             ▼
Wave 4  ── J Apple Wallet (only if Phase 0 data justifies it)
```

After **every** wave: an **integrator agent** merges the branches in the listed
order, runs `npm run build` (bundle budget check), `cd api && npm test`, and
the visual QA matrix (§5.0) via Playwright mobile screenshots. Then a
**reviewer agent** runs `/code-review` on the merged diff before the next wave
starts.

### 11.2 Reserved migration numbers (no agent picks its own)

| Number | File                         | Owner |
| ------ | ---------------------------- | ----- |
| 0012   | `0012_card_views.sql`        | A     |
| 0013   | `0013_campaign_fx_style.sql` | B     |
| 0014   | `0014_wallet_passes.sql`     | I     |
| 0015   | `0015_card_game.sql`         | G     |

### 11.3 Wave 0 — Foundation & contracts (1 agent, ≈1.5 days)

The point of this wave is that nobody in later waves needs to edit a shared hot
file.

1. **`LoyaltyCard.tsx` seams:** add `renderStampGrid`, `footerSlot`,
   `rewardRevealMode`, and extract layout math into `lib/card/stampLayout.ts`.
   After Wave 0, `LoyaltyCard.tsx` is **frozen**. Later agents plug into the
   slots only.
2. **Shared types** in `types.ts` (plus the `'bonus'` icon/color in
   `LoyaltyCard.tsx` and `KioskMode.tsx`, §8.7): `FxStyle`, `FxTheme`, `StampGridContext`,
   `CardViewEvent`, `GameState`, `PlayResult`, `'bonus'` in `Transaction['type']`,
   `fxStyle?` / `game*?` on `Template`. Same for `api/src/db/types.ts` (all four
   new tables and columns) and `api/src/lib/dto.ts` (`'bonus'`).
3. **Route file split:** create empty Fastify plugins
   `api/src/routes/publicViews.ts`, `publicPwa.ts`, `publicGame.ts`,
   `wallet.ts`, all registered in `server.ts` now. Agents A, F, G and I each own
   one file, so nobody touches `public.ts` or `server.ts` again.
4. **Lazy fx entry:** `components/card/index.ts` (the `card-fx` chunk boundary)
   exporting stubs: `PublicStampGrid` (renders the default grid),
   `deriveFxTheme` (returns a neutral theme), `CardFxProvider` (context with
   `theme`, `reducedMotion`, `trackInteraction` no-op).
5. **`PublicCardWrapper` extraction:** move it from `App.tsx` to
   `components/PublicCardPage.tsx` so the D/E/F agents don't edit `App.tsx`.
6. **Deps:** `motion`, `canvas-confetti`, `@types/canvas-confetti`. Add
   `vitest` to the SPA root with a `lib/card/**/*.test.ts` include.
7. **Visual QA script:** `scripts/card-visual-qa.mjs` (Playwright, 390×844)
   that screenshots every preset × fxStyle into `scratch/qa/`. Every later wave
   reuses it.

**Done when:** the build is green, the public card looks **pixel-identical** to
today (the stubs render the old grid), and all API tests pass.

### 11.3a Wave 0 as built (conventions every agent follows)

- **Composition:** `components/PublicCardPage.tsx` (route: data, holdout arm,
  beacon) → lazy `components/card/PublicCardView.tsx` (**frozen**) → stub
  components that agents own. All fx state comes from `useCardFx()`
  (`components/card/CardFxContext.tsx`); contracts live in `lib/card/types.ts`.
- **Choreography:** layers talk through `bus` (`lib/card/fxBus.ts`, typed
  `FxBusEvents`), `slotStates` (`pending` / `wrapped`) and
  `registerSlot` / `getSlotRect` for flight targets.
- **Motion:** `LazyMotion features={domAnimation} strict` wraps the card, so use
  `m.div` (never `motion.div`). No layout/drag features: do shared-element
  moves with `getBoundingClientRect` + `animate`.
- **Budget:** the `PublicCardView` chunk (it includes `LoyaltyCard`, about 17 kB)
  stays **≤ 50 kB gzip**. Wave 0 baseline: 30.5 kB.
- **Playground:** `/dev/cards` (dev only) renders the card with mock data, with
  a control panel for +stamp / +gift / +bonus / complete and game states.
  Query params are documented in `components/dev/DevCardsPage.tsx`.
- **QA:** `node scripts/card-visual-qa.mjs` (env `BASE_URL`, `OUT_DIR`,
  `CHROMIUM_PATH`) screenshots every preset × style plus photo cases at 390×844.
- **Typecheck:** `npx tsc --noEmit -p .` only has 5 pre-existing errors
  (LoginPage, StaffLoginPage) plus `api/test` noise. Add no new ones.
  `npm test` runs `lib/**/*.test.ts`; `cd api && npm test` runs the API suite.

### 11.4 Wave 1 (4 agents in parallel)

| Agent | Scope | Owns (only these files) | Consumes |
| ----- | ----- | ----------------------- | -------- |
| **A — Measure API** | §4.1, §4.2, §4.4 (metrics, funnel, fx-vs-holdout experiment card) | `0012_card_views.sql`, `routes/publicViews.ts`, new `routes/analyticsEngagement.ts` (+ register), `api/test/views.test.ts`, the "Card engagement" section in `AnalyticsPage.tsx` | `CardViewEvent` type |
| **B — Theme engine** | §5.0 | `0013_campaign_fx_style.sql`, `lib/card/fxTheme.ts` (+ tests), `lib/card/imageLuma.ts`, `api/src/schemas/campaigns.ts`, campaign DTO fields, the "Animaciones" control in `CardEditor.tsx`, Lottie recolor util | `FxTheme`, `FxStyle` |
| **C — Tactile grid** | §5.2–5.5 | `components/card/PublicStampGrid.tsx`, `PublicStampSlot.tsx`, `TiltSurface.tsx`, `ParticleLayer.tsx`, `lib/card/haptics.ts`, `lib/card/stampTimeline.ts` (+ tests) | `StampGridContext`, `FxTheme` (stub until B merges; must only read theme fields, never hard-code colors) |
| **D — Data hooks** | §4.3, §4.4 holdout gating, §6.1, §6.2 (logic only) | `lib/card/holdout.ts` (shared hash, + tests), `lib/card/usePublicCard.ts`, `useSeenState.ts`, `diffCard.ts` (+ tests), `useEngagementBeacon.ts`, `components/PublicCardPage.tsx` | `CardViewEvent`; exposes `newStampEvents` for E |

**Merge order:** A → B → D → C (C rebases onto the real `deriveFxTheme`
before merging).

### 11.5 Wave 2 (3 agents in parallel)

| Agent | Scope | Owns | Consumes |
| ----- | ----- | ---- | -------- |
| **E — Moments UI** | §5.4, §6.2 (visuals), §6.3, §6.4 | `components/card/StampSlam.tsx`, `GiftUnwrap.tsx`, `ScratchReveal.tsx` (generic: `result` + `foil` props, reused by H), `Toast.tsx`, `services/rewardService.ts` public-mode cleanup | C's grid, D's `newStampEvents`, B's theme |
| **F — Reasons to open** | §7.1, §7.2 | `routes/publicPwa.ts` (manifest + brand icon via `sharp`), `public/sw.js`, SW registration, `components/card/InstallPrompt.tsx`, WhatsApp button in `KioskMode.tsx`, `?src=whatsapp` in `WinBackDialog.tsx`, GCS bucket CORS note in `infra/README.md` | D's beacon `source` |
| **G — Game backend** | §8.2–8.7, §8.10 (API + game holdout) | `0015_card_game.sql`, `routes/publicGame.ts`, `GET /campaigns/:id/game-estimate`, `api/src/lib/period.ts`, `api/test/game.test.ts`, `'bonus'` handling in `lib/cardInsights.ts`, `TransactionsPage.tsx` | Wave 0 types |

**Merge order:** G → E → F.

### 11.6 Wave 3 (2 agents in parallel)

| Agent | Scope | Owns | Consumes |
| ----- | ----- | ---- | -------- |
| **H — Game frontend** | §8.1, §8.1a, §8.8, §8.10 (UI) | **First:** `/dev/ticket` playground for sign-off on a real phone. Then `components/card/WeeklyTicket.tsx`, `ScratchFoil.tsx`, `FlakeLayer.tsx`, `SplitFlap.tsx`, the "Raspa y gana" section in `CardEditor.tsx` and `AnalyticsPage.tsx` | E's `ScratchReveal`, G's API |
| **I — Google Wallet** | §7.3 | `0014_wallet_passes.sql`, `routes/wallet.ts`, `lib/wallet/google.ts`, `lib/cardEvents.ts` + calls in `routes/cards.ts` and `routes/publicGame.ts`, `components/card/WalletButtons.tsx`, env examples | Google issuer account (**human prerequisite**) |

### 11.7 Brief template for each agent

Every agent gets the same brief shape, so it can work without asking:

```
Goal:        <one sentence + plan sections, e.g. "§5.2–5.5">
Branch:      feat/card-<letter>-<slug>   (own worktree)
Owns:        <file list from the table — create/edit ONLY these>
Read-only:   types.ts, LoyaltyCard.tsx, server.ts, other agents' files
Contracts:   <types/endpoints consumed + produced, copied from Wave 0>
Constraints: Spanish (es-CO) copy · never hard-code colors (use FxTheme) ·
             respect reduced motion · public mode only · card-fx ≤ 30 kB gz
Done when:   build green · api tests green · new unit tests · QA screenshots
             attached · short PR summary with bundle diff
If blocked:  needs a change outside "Owns" → stop and report, don't edit it
```

### 11.8 Human prerequisites (not agent work)

- GCS bucket CORS: allow `GET` from `SPA_ORIGIN` (needed for §5.0 image sampling).
- Google Pay & Wallet Console issuer account + service account (before Wave 3 I).
- Apple Developer Program + Pass Type ID (before Wave 4).
- Real device check after each wave: an iPhone, a mid-range Android, a low-end
  Android.

### 11.9 Timeline

| Wave | Agents | Calendar time | Gate before the next wave |
| ---- | ------ | ------------- | ------------------------- |
| 0    | 1      | ~1.5 d        | Pixel-identical public card, all tests green |
| 1    | 4      | ~2–3 d        | Phase 0 + 1 live; start collecting baseline data |
| 2    | 3      | ~3 d          | Phase 2 + PWA + WhatsApp live; game API merged but **flag off** |
| 3    | 2      | ~3–5 d        | Game enabled for one campaign first; Wallet behind a flag |
| 4    | 1      | ~5 d          | Only if iOS share in `card_views` justifies it |

About **2–2.5 weeks** of calendar time to Wave 3, compared with ~5 weeks
sequentially.

**Success metrics** (from `card_views`): more opens per active card per month,
longer median visible time, a growing share of opens from PWA/Wallet/WhatsApp,
and the business metric: fewer days between visits for cards that saw a stamp
slam or played the game, compared with cards that didn't.
