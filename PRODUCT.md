# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
- **Clients of one beauty studio** (today: a nail studio in Sabaneta, Colombia). They open their card on a phone, usually from a link sent by WhatsApp; some have installed it as a PWA or saved it to Apple/Google Wallet. Where they open it most is unknown, so the in-app browser is the case to design for. They check their stamps, show the QR at the front desk, play the weekly scratch game and, seasonally, open gifts.
- **The studio's owner and staff** use the admin SPA (campaigns, customers, scanning) and the studio's own panel, which talks to Stampee through the API.

## Product Purpose
A self-hosted digital loyalty card for a single business. Success means clients open the card between visits and come back sooner: stamps, gifts and small rituals give them a reason to.

## Positioning
The card is the studio's own object, not a generic loyalty app. Every campaign is styled with the studio's brand, and each moment (a stamp landing, a gift unwrapped, a ticket scratched) is decided by the server and played back as an event.

## Operating Context
- Stamps are added by the studio's CRM after each paid visit. Rewards and gifts are redeemed at the front desk through the studio's panel.
- All communication with clients is on WhatsApp; there is no email.
- Times are America/Bogota.

## Capabilities and Constraints
- Public card at `/:slug/:uniqueId`, with a weekly scratch game, win-back gift stamps, wallet passes and a PWA.
- Every game or gift result is decided by the server; the browser only animates it.
- Spanish UI copy.
- The repo is public: no client data or business figures in the code.

## Brand Commitments
- Golden Beauty Studio identity "A · Pan de oro" (approved 2026-11-10): Moka #4a3426, Oro Golden #ac8231, bright gold #e7aa51, ivory #f8f4ee; Gilda Display for display, Hanken Grotesk for text. The source of truth is `brand/` in the studio workspace.
- The primary logo is the shine version. The small logo is the whole «Golden» signature, never the G alone. No drawn pictorial marks (nails, sparkles, monograms) were approved.
- Seasonal work stays on the brand base. Christmas 2026: "Golden + subtle Navidad", where Christmas lives in details (gold snow, ribbon, a star), with no red and green.

## Evidence on Hand
- Real campaign styling: the main card is light with gold ink and star stamps, 8 stamps; the win-back card is dark Moka (#241812) with bright-gold stamps, 9 stamps.
- No testimonials or client photos are available for the card. None may be invented.

## Product Principles
1. The card is a physical object made digital: it has weight, a front and a back.
2. The server decides and the client watches: never fake randomness or a near-miss.
3. Every moment is earned by a real visit; nothing completes a card without one.
4. Elegant before festive: the studio's gold, never a cartoon.

## Accessibility & Inclusion
Every animation has a reduced-motion path, and every gesture has a tap or button equivalent.
