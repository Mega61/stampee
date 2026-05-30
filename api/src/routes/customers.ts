import type { FastifyPluginAsync } from 'fastify';
import { db } from '../db/kysely.js';
import { AppError } from '../lib/errors.js';
import { requireRole } from '../middleware/requireRole.js';
import {
  toCustomerDto,
  toIssuedCardDto,
  toTransactionDto,
  parseBody,
  type CustomerRow,
  type IssuedCardRow,
  type TransactionRow,
} from '../lib/dto.js';
import { CustomerBody, UpdateCustomerBody, ListCustomersQuery } from '../schemas/customers.js';
import { randomUUID } from 'node:crypto';

export const customerRoutes: FastifyPluginAsync = async (app) => {
  // GET /customers?include=cards,transactions
  app.get('/customers', async (req) => {
    const claims = await requireRole(req, 'owner', 'staff', 'admin');
    const query = parseBody(ListCustomersQuery, req.query);
    const include = new Set((query.include ?? '').split(',').map((s) => s.trim()).filter(Boolean));

    const customers = await db
      .selectFrom('customers')
      .selectAll()
      .where('owner_id', '=', claims.ownerScopeId)
      .orderBy('created_at', 'asc')
      .execute();

    if (!include.has('cards')) {
      return { ok: true, data: (customers as CustomerRow[]).map(toCustomerDto) };
    }

    const customerIds = customers.map((c) => c.id);
    const cards: IssuedCardRow[] = customerIds.length
      ? ((await db
          .selectFrom('issued_cards')
          .selectAll()
          .where('customer_id', 'in', customerIds)
          .execute()) as IssuedCardRow[])
      : [];

    let txByCard = new Map<string, TransactionRow[]>();
    if (include.has('transactions') && cards.length) {
      const cardIds = cards.map((c) => c.id);
      const txs = (await db
        .selectFrom('transactions')
        .selectAll()
        .where('card_id', 'in', cardIds)
        .orderBy('timestamp', 'asc')
        .execute()) as TransactionRow[];
      txByCard = txs.reduce((m, t) => {
        const list = m.get(t.card_id) ?? [];
        list.push(t);
        m.set(t.card_id, list);
        return m;
      }, new Map<string, TransactionRow[]>());
    }

    const cardsByCustomer = cards.reduce((m, c) => {
      const list = m.get(c.customer_id) ?? [];
      list.push(c);
      m.set(c.customer_id, list);
      return m;
    }, new Map<string, IssuedCardRow[]>());

    const data = (customers as CustomerRow[]).map((c) => ({
      ...toCustomerDto(c),
      cards: (cardsByCustomer.get(c.id) ?? []).map((card) => ({
        ...toIssuedCardDto(card),
        history: (txByCard.get(card.id) ?? []).map(toTransactionDto),
      })),
    }));
    return { ok: true, data };
  });

  // POST /customers — owner+staff
  app.post('/customers', async (req) => {
    const claims = await requireRole(req, 'owner', 'staff', 'admin');
    const body = parseBody(CustomerBody, req.body);
    const id = body.id ?? randomUUID();
    await db
      .insertInto('customers')
      .values({
        id,
        owner_id: claims.ownerScopeId,
        name: body.name,
        email: body.email,
        mobile: body.mobile ?? null,
        status: body.status,
      })
      .execute();
    const row = await db
      .selectFrom('customers')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
    return { ok: true, data: toCustomerDto(row as CustomerRow) };
  });

  // PATCH /customers/:id
  app.patch<{ Params: { id: string } }>('/customers/:id', async (req) => {
    const claims = await requireRole(req, 'owner', 'staff', 'admin');
    const body = parseBody(UpdateCustomerBody, req.body);

    const existing = await db
      .selectFrom('customers')
      .select('id')
      .where('id', '=', req.params.id)
      .where('owner_id', '=', claims.ownerScopeId)
      .executeTakeFirst();
    if (!existing) throw new AppError(404, 'NOT_FOUND', 'Customer not found.');

    const updates: Record<string, unknown> = {};
    if (body.name !== undefined) updates['name'] = body.name;
    if (body.email !== undefined) updates['email'] = body.email;
    if (body.mobile !== undefined) updates['mobile'] = body.mobile;
    if (body.status !== undefined) updates['status'] = body.status;
    if (Object.keys(updates).length === 0) {
      const row = await db
        .selectFrom('customers')
        .selectAll()
        .where('id', '=', req.params.id)
        .executeTakeFirstOrThrow();
      return { ok: true, data: toCustomerDto(row as CustomerRow) };
    }

    await db
      .updateTable('customers')
      .set(updates)
      .where('id', '=', req.params.id)
      .execute();

    const row = await db
      .selectFrom('customers')
      .selectAll()
      .where('id', '=', req.params.id)
      .executeTakeFirstOrThrow();
    return { ok: true, data: toCustomerDto(row as CustomerRow) };
  });
};
