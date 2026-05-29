# db/

Canonical SQL for the self-hosted Stampee fork. Replaces the old `supabase/` directory.

## Layout

- `migrations/0001..0006_*.sql` — applied in lexical order. SQL is the source of truth for the schema; TypeScript types in `api/src/db/types.ts` are generated downstream via `kysely-codegen`.
- `seed/dev.sql` — development seed (one owner, one staff, two campaigns, three customers, sample issued cards). Idempotent if the DB is freshly migrated; not safe to run twice.

## Schema

Everything lives in the `loyalty` schema so the same Postgres instance can host Strapi's `public` schema side by side. Two separate DB roles in production (`loyalty_user`, `strapi_user`) ensure no cross-schema reads.

## Applying migrations

Local dev (after `docker compose -f infra/docker-compose.dev.yml up -d postgres`):

```powershell
# from repo root
Get-ChildItem db\migrations\*.sql | Sort-Object Name | ForEach-Object {
  docker compose -f infra/docker-compose.dev.yml exec -T postgres `
    psql -U loyalty_user -d appdb -v ON_ERROR_STOP=1 -f - < $_.FullName
}
```

In production the `api/scripts/migrate.ts` runner applies these (see Phase 2 of the migration plan).

## What changed vs `supabase/migration.sql`

| Dropped | Reason |
|---|---|
| `auth.users` FK on profiles | No Supabase Auth — we maintain our own `loyalty.users` |
| All RLS policies | Replaced by API-layer authorization |
| `handle_new_user()` + trigger | Profile creation moved to `POST /auth/signup` |
| `current_staff_owner_id()` | Owner-scope resolution is request-context in the API |
| `license_keys` table + `activate_license_key()` | Pro tier dropped per migration plan decision #2 |
| `profiles.tier`, `profiles.tier_expires_at` | Same — no Pro tier |
| `create_staff_account`, `update_staff_pin`, `delete_staff_account`, `delete_own_account` | Move to API (no `auth.users` to insert into) |
| `is_slug_available`, `inspect_scanned_card`, `get_scan_entry_context`, `get_public_campaign_signup_context`, `get_public_card` | Plain queries — reimplemented in API as Kysely calls |
| Storage RLS on `storage.objects` | GCS replaces Supabase Storage; bucket auth is at the API |

| Kept | Why |
|---|---|
| `prevent_issuing_disabled_campaign_card` trigger | Pure pgPLSQL, no auth deps; API translates the raised exception to HTTP 409 |
| `register_public_campaign_signup` | Atomic multi-insert; cannot be safely re-expressed at the application layer |
| `delete_campaign_preserve_cards(campaign_id, caller_user_id)` | Atomic snapshot + delete; takes `caller_user_id` instead of `auth.uid()` |

| Added | Why |
|---|---|
| `loyalty.users` | Replaces `auth.users` |
| `loyalty.email_verification_tokens` | Email verification flow |
| `loyalty.password_reset_tokens` | Password reset flow |
| `loyalty.refresh_tokens` | JWT refresh-token rotation with family revocation |
| `citext` extension on `email`, `slug` | Drop ad-hoc `lower()` calls — case-insensitive by type |
