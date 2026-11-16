import { z } from 'zod';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');
const cop = z.number().int().min(1).max(100_000_000);
const design = z.record(z.unknown()).nullable().optional();

export const CreateTierBody = z.object({
  name: z.string().trim().min(1).max(60),
  amountCop: cop,
  description: z.string().trim().max(300).optional(),
  validityDays: z.number().int().min(1).max(3650).optional(),
  isEnabled: z.boolean().optional(),
  sort: z.number().int().min(-1000).max(1000).optional(),
  design,
});

export const UpdateTierBody = CreateTierBody.partial();

export const TierListQuery = z.object({
  enabled: z.enum(['1', 'true', '0', 'false']).optional(),
});

export const GiftCardRulesSchema = z
  .object({
    recipient: z.enum(['any', 'new_or_dormant']).optional(),
    giverStampOnRedeem: z.boolean().optional(),
    buyerStampOnPaid: z.boolean().optional(),
    buyerStamps: z.number().int().min(1).max(5).optional(),
    ref: z.string().trim().max(60).optional(),
  })
  .strict();

const buyer = z.object({
  name: z.string().trim().min(1).max(120),
  phone: z.string().trim().min(7).max(40),
});

export const CreateGiftCardBody = z.object({
  tierId: z.string().min(1).max(120).optional(),
  // Manual cards only (owner/admin). Sale orders always take the tier amount.
  amountCop: cop.optional(),
  buyer,
  recipientName: z.string().trim().max(40).optional().nullable(),
  message: z.string().trim().max(140).optional(),
  source: z.enum(['sale', 'manual']).default('sale'),
  funded: z.boolean().optional(),
  rules: GiftCardRulesSchema.optional(),
  ref: z.string().trim().max(60).optional(),
  minTicketCop: z.number().int().min(0).max(100_000_000).optional().nullable(),
  // Optional idempotency key for integrations.
  externalRef: z.string().trim().min(1).max(120).optional(),
});

export const GiftCardListQuery = z.object({
  status: z.enum(['pending_payment', 'active', 'redeemed', 'void', 'expired']).optional(),
  q: z.string().trim().max(120).optional(),
  source: z.enum(['sale', 'advent', 'manual']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

// paidAt: ISO datetime, or a bare date (taken as noon in Bogota).
export const ActivateGiftCardBody = z.object({
  paidAt: z.union([isoDate, z.string().datetime({ offset: true })]).optional(),
  method: z.enum(['efectivo', 'transferencia', 'otro']),
  paidAmountCop: z.number().int().min(0).max(100_000_000),
  paidRef: z.string().trim().min(1).max(120).optional().nullable(),
});

export const UpdateGiftCardBody = z.object({
  recipientName: z.string().trim().max(40).optional().nullable(),
  recipientPhone: z.string().trim().max(40).optional().nullable(),
  message: z.string().trim().max(140).optional(),
  validTo: isoDate.optional(),
});

export const VoidGiftCardBody = z.object({
  reason: z.string().trim().min(1).max(200),
});

export const RedeemGiftCardBody = z.object({
  externalRef: z.string().trim().min(1).max(120),
  amountUsedCop: z.number().int().min(0).max(100_000_000),
  customer: z
    .object({ name: z.string().trim().min(1).max(120), phone: z.string().trim().min(7).max(40) })
    .optional()
    .nullable(),
  date: isoDate.optional(),
});

export const UnredeemGiftCardBody = z.object({
  externalRef: z.string().trim().min(1).max(120),
});

export const PublicRecipientBody = z.object({
  name: z.string().trim().min(2, 'El nombre debe tener al menos 2 letras.').max(40, 'Máximo 40 caracteres.'),
  phone: z
    .string()
    .trim()
    .max(20)
    .refine((v) => v === '' || v.replace(/\D+/g, '').length >= 10, 'El WhatsApp debe tener 10 dígitos.')
    .optional()
    .transform((v) => (v ? v : null)),
});
