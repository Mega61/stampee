import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestDb, type TestDb } from './helpers/db.js';

let db: TestDb;

beforeAll(async () => {
  db = await setupTestDb();
  await db.seed();
}, 120_000);

afterAll(async () => {
  await db?.stop();
});

describe('schema: structure', () => {
  it('every expected table exists in the loyalty schema', async () => {
    const { rows } = await db.pool.query<{ table_name: string }>(`
      select table_name
      from information_schema.tables
      where table_schema = 'loyalty'
      order by table_name
    `);
    const names = rows.map((r) => r.table_name);
    expect(names).toEqual(expect.arrayContaining([
      'users',
      'profiles',
      'campaigns',
      'customers',
      'issued_cards',
      'transactions',
      'email_verification_tokens',
      'password_reset_tokens',
      'refresh_tokens',
    ]));
  });

  it('foreign keys have the right ON DELETE actions', async () => {
    const { rows } = await db.pool.query<{
      table_name: string;
      column_name: string;
      references_table: string;
      delete_rule: string;
    }>(`
      select tc.table_name, kcu.column_name,
             ccu.table_name as references_table, rc.delete_rule
      from information_schema.table_constraints tc
      join information_schema.key_column_usage kcu
        on tc.constraint_name = kcu.constraint_name
      join information_schema.constraint_column_usage ccu
        on tc.constraint_name = ccu.constraint_name
      join information_schema.referential_constraints rc
        on tc.constraint_name = rc.constraint_name
      where tc.constraint_type = 'FOREIGN KEY' and tc.table_schema = 'loyalty'
    `);

    const byKey = new Map(rows.map((r) => [`${r.table_name}.${r.column_name}`, r]));

    // issued_cards.campaign_id is the special one — set null so cards survive
    // a campaign deletion (delete_campaign_preserve_cards relies on this).
    expect(byKey.get('issued_cards.campaign_id')?.delete_rule).toBe('SET NULL');

    // Refresh-token chain — replaced_by points at the rotated successor.
    expect(byKey.get('refresh_tokens.replaced_by')?.delete_rule).toBe('SET NULL');

    // Everything in the tenant ownership chain cascades.
    for (const k of [
      'profiles.id',
      'profiles.owner_id',
      'campaigns.owner_id',
      'customers.owner_id',
      'issued_cards.customer_id',
      'issued_cards.owner_id',
      'transactions.card_id',
      'email_verification_tokens.user_id',
      'password_reset_tokens.user_id',
      'refresh_tokens.user_id',
    ]) {
      expect(byKey.get(k)?.delete_rule).toBe('CASCADE');
    }
  });

  it('the disabled-campaign trigger is wired BEFORE INSERT on issued_cards', async () => {
    const { rows } = await db.pool.query<{ count: string }>(`
      select count(*) from information_schema.triggers
      where trigger_schema = 'loyalty'
        and event_object_table = 'issued_cards'
        and trigger_name = 'issued_cards_block_disabled_campaign'
        and action_timing = 'BEFORE'
        and event_manipulation = 'INSERT'
    `);
    expect(Number(rows[0]?.count ?? 0)).toBe(1);
  });

  it('seed loads with the expected row counts', async () => {
    const counts = await Promise.all([
      db.pool.query<{ c: string }>('select count(*)::text as c from loyalty.users'),
      db.pool.query<{ c: string }>('select count(*)::text as c from loyalty.profiles'),
      db.pool.query<{ c: string }>('select count(*)::text as c from loyalty.campaigns'),
      db.pool.query<{ c: string }>('select count(*)::text as c from loyalty.customers'),
      db.pool.query<{ c: string }>('select count(*)::text as c from loyalty.issued_cards'),
      db.pool.query<{ c: string }>('select count(*)::text as c from loyalty.transactions'),
    ]);
    const [users, profiles, campaigns, customers, cards, txs] = counts.map(
      (r) => Number(r.rows[0]?.c ?? 0),
    );
    expect({ users, profiles, campaigns, customers, cards, txs })
      .toEqual({ users: 2, profiles: 2, campaigns: 2, customers: 3, cards: 3, txs: 7 });
  });
});

type SignupOutcome = {
  outcome: 'issued' | 'redirect_existing' | 'campaign_disabled_no_existing' | 'error';
  uniqueId?: string;
  error?: string;
};

const callSignup = async (
  pool: typeof db.pool,
  slug: string,
  campaignId: string,
  name: string,
  email: string | null,
  mobile: string | null = null,
): Promise<SignupOutcome> => {
  const { rows } = await pool.query<{ register_public_campaign_signup: SignupOutcome }>(
    `select loyalty.register_public_campaign_signup($1::text, $2::text, $3::text, $4::text, $5::text)`,
    [slug, campaignId, name, email, mobile],
  );
  // pg parses jsonb as JS already.
  return rows[0]!.register_public_campaign_signup;
};

describe('schema: register_public_campaign_signup', () => {
  it('issues a new card on the happy path', async () => {
    const out = await callSignup(db.pool, 'demo', 'campaign-coffee', 'Eve', 'eve@example.com');
    expect(out.outcome).toBe('issued');
    expect(out.uniqueId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('redirects to the existing card on the same email', async () => {
    const first = await callSignup(db.pool, 'demo', 'campaign-coffee', 'Fred', 'fred@example.com');
    const second = await callSignup(db.pool, 'demo', 'campaign-coffee', 'Fred Again', 'fred@example.com');
    expect(first.outcome).toBe('issued');
    expect(second.outcome).toBe('redirect_existing');
    expect(second.uniqueId).toBe(first.uniqueId);
  });

  it('returns campaign_disabled_no_existing on a disabled campaign with no prior card', async () => {
    const out = await callSignup(db.pool, 'demo', 'campaign-old-promo', 'Ghost', 'ghost@example.com');
    expect(out.outcome).toBe('campaign_disabled_no_existing');
  });

  it('returns an error on a missing slug', async () => {
    const out = await callSignup(db.pool, 'not-a-business', 'campaign-coffee', 'Nobody', 'x@x.com');
    expect(out.outcome).toBe('error');
    expect(out.error).toMatch(/not found/i);
  });
});

describe('schema: delete_campaign_preserve_cards', () => {
  it('snapshots template_snapshot and nullifies campaign_id atomically', async () => {
    // pre-state: card-alice has campaign_id=campaign-coffee, template_snapshot=null
    const pre = await db.pool.query<{
      campaign_id: string | null;
      template_snapshot: unknown;
    }>(`select campaign_id, template_snapshot from loyalty.issued_cards where id = 'card-alice'`);
    expect(pre.rows[0]?.campaign_id).toBe('campaign-coffee');
    expect(pre.rows[0]?.template_snapshot).toBeNull();

    await db.pool.query(
      `select loyalty.delete_campaign_preserve_cards($1::text, $2::uuid)`,
      ['campaign-coffee', '00000000-0000-0000-0000-000000000001'],
    );

    const post = await db.pool.query<{
      campaign_id: string | null;
      snap_name: string;
    }>(`select campaign_id, template_snapshot->>'name' as snap_name
        from loyalty.issued_cards where id = 'card-alice'`);
    expect(post.rows[0]?.campaign_id).toBeNull();
    expect(post.rows[0]?.snap_name).toBe('Coffee Loyalty');

    const remaining = await db.pool.query<{ c: string }>(
      `select count(*)::text as c from loyalty.campaigns where id = 'campaign-coffee'`,
    );
    expect(Number(remaining.rows[0]?.c ?? 0)).toBe(0);
  });

  it('rejects a caller_user_id that does not own the campaign', async () => {
    // 'campaign-old-promo' belongs to owner 0...001; pass a different uuid.
    await expect(
      db.pool.query(
        `select loyalty.delete_campaign_preserve_cards($1::text, $2::uuid)`,
        ['campaign-old-promo', '99999999-9999-9999-9999-999999999999'],
      ),
    ).rejects.toThrow(/not found or not owned/i);
  });
});

describe('schema: prevent_issuing_disabled_campaign_card trigger', () => {
  it('raises CAMPAIGN_DISABLED on direct insert into issued_cards', async () => {
    // campaign-old-promo is is_enabled=false in the seed.
    await expect(
      db.pool.query(
        `insert into loyalty.issued_cards
           (id, customer_id, campaign_id, owner_id, campaign_name, stamps, status)
         values
           ('card-blocked', 'customer-alice', 'campaign-old-promo',
            '00000000-0000-0000-0000-000000000001', 'Old Promo', 0, 'Active')`,
      ),
    ).rejects.toThrow(/CAMPAIGN_DISABLED/);
  });
});
